/**
 * 暴涨监控日 K 缓存（Binance）：
 * - 当日 open/restHigh：统一 dayTruth（与横盘共用）
 * - surgeDay：冷建 complete 态 + 写穿镜像（兼容旧读路径）
 * - 冷建：优先复用 today；其次横盘 todaySeed；否则 REST limit=1
 * - 暖扫：today.open + max(restHigh, Socket H/last)
 * - Bitget-only 不进本缓存
 */

import { getFutureKlineData, getTradeUrl } from '@root/src/container/market';
import {
  getSharedKLineMirror,
  createEmptySurgeDayBucket,
} from '@root/src/container/market/klineMirror';
import {
  getTodayTruth,
  upsertTodayFromCandle,
  clearTodayTruth,
  rotateTodayTruthIfNeeded,
} from '@root/src/container/market/dayTruth';
import {
  waitBinanceBanIfNeeded,
  getBinanceBanRemaining,
} from '../_marketFetchGate';
import { getSharedMiniTickerFeed } from '../low_vol_range_blast/_rangeMonitorPriceFeed';

/** 日K粒度：UTC 日线 */
const GRANULARITY = '1Dutc';
/** 冷建每批并行币数（门闩仍限并发，主要控制进度上报粒度） */
const COLD_PARALLEL = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 读统一镜像里的暴涨日K桶 */
const surgeBucket = () => getSharedKLineMirror().surgeDay;
/** 整桶替换暴涨日K（冷建重建用） */
const setSurgeBucket = next => getSharedKLineMirror().replaceSurgeDay(next);

/** UTC 日键，与 todayKey / 批次 id 同形态 */
export const surgeUtcDayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

/**
 * @typedef {{
 *   exchange: string,
 *   symbol: string,
 *   open: number,
 *   high: number,
 *   last: number,
 *   candleTs: number,
 *   dayKey: string,
 * }} SurgeDayEntry
 */

/** 清空暴涨日K桶；若 today 已跨日一并清当日真相 */
export const clearSurgeDayCache = () => {
  setSurgeBucket(createEmptySurgeDayBucket());
  const day = surgeUtcDayKey();
  const today = getSharedKLineMirror().todayDay;
  if (today?.dayKey && today.dayKey !== day) clearTodayTruth();
};

/** 日K桶元信息：是否当日 complete、币数、builtAt */
export const getSurgeDayCacheMeta = () => {
  const cacheState = surgeBucket();
  return {
    dayKey: cacheState.dayKey,
    size: cacheState.bySymbol.size,
    complete: cacheState.complete,
    builtAt: cacheState.builtAt,
    fresh:
      cacheState.complete && cacheState.dayKey === surgeUtcDayKey() && cacheState.bySymbol.size > 0,
  };
};

const fetchDayCandle = symbol => fetchSurgeDayCandle(symbol);

/** REST 日 K → 唯一当日真相（并写穿 surgeDay / range todaySeed / feed） */
const writeEntryFromCandle = (pair, candle, feed) => {
  const symbol = String(pair?.symbol || '').toUpperCase();
  if (!symbol) return null;
  rotateTodayTruthIfNeeded();
  return upsertTodayFromCandle(symbol, candle, {
    feed,
    exchange: pair?.exchange || 'binance',
  });
};

/** REST 日 K 写入当日真相（冷建 / 过期补K 共用） */
export const writeSurgeDayFromCandle = (pair, candle, feed) =>
  writeEntryFromCandle(pair, candle, feed);

/**
 * Socket 滚高：只动 surge 镜像 high/last，不改 today.open / restHigh。
 * （live high 以 getSurgeInfoFromCache 读 feed 为准；此处保持镜像不掉队）
 */
export const touchSurgeDayFromFeed = (symbol, priceFeed) => {
  const key = String(symbol || '').toUpperCase();
  const day = surgeUtcDayKey();
  const truth = getTodayTruth(key);
  if (!truth) return null;
  const cacheState = surgeBucket();
  let entry = cacheState.bySymbol.get(key);
  if (!entry || entry.dayKey !== day) {
    entry = {
      exchange: 'binance',
      symbol: key,
      open: truth.open,
      high: truth.restHigh,
      last: truth.restClose || truth.restHigh,
      candleTs: truth.candleTs,
      dayKey: day,
    };
    cacheState.bySymbol.set(key, entry);
  }
  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(key);
  if (!q || (q.dayKey && q.dayKey !== day)) return entry;
  const feedHigh = Number(q.high) || 0;
  const feedLast = Number(q.last) || 0;
  const high = Math.max(truth.restHigh || 0, entry.high || 0, feedHigh, feedLast, entry.last || 0);
  const last = feedLast > 0 ? feedLast : entry.last || high;
  if (high > entry.high) entry.high = high;
  if (last > 0) entry.last = last;
  return entry;
};

/** 单币 REST 拉当日日 K（走门闩） */
export const fetchSurgeDayCandle = async symbol => {
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);
  const res = await getFutureKlineData({ symbol, granularity: GRANULARITY, limit: 1 }, 'binance');
  const candles = Array.isArray(res?.data) ? res.data : [];
  return candles[0] || null;
};

/**
 * 确保 Binance 当日 open/high 缓存可用。同 UTC 日且 complete 则复用。
 */
export const ensureSurgeDayCache = async ({ pairs, aborted, onStatus, priceFeed } = {}) => {
  const day = surgeUtcDayKey();
  const feed = priceFeed || getSharedMiniTickerFeed();
  const binancePairs = (pairs || []).filter(p => p?.exchange === 'binance' && p?.symbol);

  let cacheState = surgeBucket();
  if (cacheState.complete && cacheState.dayKey === day && cacheState.bySymbol.size > 0) {
    // 热重载：surge 镜像在但 today 空 → 从镜像回填真相
    rotateTodayTruthIfNeeded();
    let backfilled = 0;
    cacheState.bySymbol.forEach((row, key) => {
      if (getTodayTruth(key)) return;
      if (!(row?.open > 0)) return;
      if (
        upsertTodayFromCandle(
          key,
          [
            row.candleTs || Date.now(),
            row.open,
            row.high || row.open,
            row.open,
            row.last || row.high || row.open,
          ],
          { feed, exchange: row.exchange || 'binance' }
        )
      ) {
        backfilled += 1;
      }
    });
    onStatus?.(
      `暴涨日 K 复用：${cacheState.bySymbol.size} 币 · UTC ${day} · Socket 暖扫${backfilled ? ` · 回填当日 ${backfilled}` : ''}`
    );
    return { fromCache: true, size: cacheState.bySymbol.size, dayKey: day };
  }

  const backup =
    cacheState.complete && cacheState.dayKey === day && cacheState.bySymbol.size > 0
      ? {
          dayKey: cacheState.dayKey,
          bySymbol: cacheState.bySymbol,
          complete: true,
          builtAt: cacheState.builtAt,
        }
      : null;

  cacheState = setSurgeBucket({
    dayKey: day,
    bySymbol: new Map(),
    complete: false,
    builtAt: 0,
  });

  const total = binancePairs.length;
  rotateTodayTruthIfNeeded();
  // 优先复用当日真相；其次横盘 todaySeed；否则 REST limit=1
  const rangeState = getSharedKLineMirror().rangeLookback;
  const canSeedFromRange =
    rangeState?.complete && rangeState.dayKey === day && (rangeState.bySymbol?.size || 0) > 0;
  const todaySize = getSharedKLineMirror().todayDay?.bySymbol?.size || 0;

  onStatus?.(
    total
      ? todaySize > 0 || canSeedFromRange
        ? `暴涨日 K 冷建：0/${total}…（可复用当日真相${todaySize ? ` ${todaySize}` : ''}${canSeedFromRange ? '/横盘' : ''}）`
        : `暴涨日 K 冷建：0/${total}…`
      : '暴涨日 K 冷建：无 Binance 币对'
  );

  let loaded = 0;
  let seeded = 0;
  let fetched = 0;
  for (let i = 0; i < total; i += COLD_PARALLEL) {
    if (aborted?.()) {
      if (backup) {
        cacheState = setSurgeBucket(backup);
        onStatus?.(`暴涨日 K 中断：回滚复用 ${cacheState.bySymbol.size} 币`);
        return { fromCache: true, aborted: true, size: cacheState.bySymbol.size, dayKey: day };
      }
      clearSurgeDayCache();
      return { fromCache: false, aborted: true, size: 0, dayKey: day };
    }

    const chunk = binancePairs.slice(i, i + COLD_PARALLEL);
    const done = Math.min(i + chunk.length, total);
    onStatus?.(`暴涨日 K 冷建 ${done}/${total}（${Math.round((done / total) * 100)}%）`);

    await Promise.all(
      chunk.map(async pair => {
        const key = String(pair.symbol).toUpperCase();
        try {
          const existing = getTodayTruth(key);
          if (existing) {
            // 已在 today：再 upsert 一次只写穿 surge 镜像，不打 REST
            if (
              writeEntryFromCandle(
                pair,
                [
                  existing.candleTs,
                  existing.open,
                  existing.restHigh,
                  existing.restLow || existing.open,
                  existing.restClose || existing.restHigh,
                ],
                feed
              )
            ) {
              loaded += 1;
              seeded += 1;
              return;
            }
          }
          if (canSeedFromRange) {
            const rangeEntry = rangeState.bySymbol.get(key);
            const seed = rangeEntry?.todaySeed || rangeEntry?.today;
            if (seed && writeEntryFromCandle(pair, seed, feed)) {
              loaded += 1;
              seeded += 1;
              return;
            }
          }
          const candle = await fetchDayCandle(key);
          if (candle) {
            writeEntryFromCandle(pair, candle, feed);
            loaded += 1;
            fetched += 1;
          }
        } catch (e) {
          console.warn('[SurgeDayCache] cold', key, e);
        }
      })
    );
    // 冷建只等真实 ban；不要叠 3s 背景让路（横盘冷建也没有）。门闩 gap/软顶已限速。
    const banLeft = getBinanceBanRemaining();
    if (banLeft > 0) await sleep(Math.min(banLeft + 200, 5000));
    else await sleep(0);
  }

  cacheState = surgeBucket();
  cacheState.complete = true;
  cacheState.builtAt = Date.now();
  onStatus?.(
    `暴涨日 K 就绪：${loaded}/${total}（种${seeded}/拉${fetched}）· UTC ${day} · 同日暖扫走 Socket`
  );
  return { fromCache: false, size: loaded, dayKey: day, total, seeded, fetched };
};

/** 暖扫：当日真相 open + max(restHigh, Socket H/last) */
export const getSurgeInfoFromCache = (pair, priceFeed) => {
  if (!pair || pair.exchange !== 'binance') return null;
  const day = surgeUtcDayKey();
  const symbol = String(pair.symbol || '').toUpperCase();
  const truth = getTodayTruth(symbol);
  // 兼容：today 尚未写穿时回落 surgeDay 镜像
  const entry = truth || surgeBucket().bySymbol.get(symbol);
  if (!entry || entry.dayKey !== day || !(entry.open > 0)) return null;

  const open = entry.open;
  const restHigh = truth?.restHigh ?? entry.high ?? 0;
  const restClose = truth?.restClose ?? entry.last ?? 0;
  const candleTs = truth?.candleTs ?? entry.candleTs;

  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(symbol);
  const feedHigh = q && (!q.dayKey || q.dayKey === day) ? Number(q.high) || 0 : 0;
  const feedLast = q && (!q.dayKey || q.dayKey === day) ? Number(q.last) || 0 : 0;
  const high = Math.max(restHigh || 0, feedHigh, feedLast, restClose || 0);
  const last = feedLast > 0 ? feedLast : restClose || high;
  if (!(high > 0)) return null;

  // 镜像 high/last 跟随 live，open 仍以 truth 为准
  const mirror = surgeBucket().bySymbol.get(symbol);
  if (mirror && mirror.dayKey === day) {
    if (high > (mirror.high || 0)) mirror.high = high;
    if (last > 0) mirror.last = last;
  }

  return {
    exchange: 'binance',
    symbol,
    open,
    high,
    ratio: high / open,
    last,
    candleTs,
    link: getTradeUrl(symbol, 'binance'),
    via: feedLast > 0 || feedHigh > 0 ? 'cache+socket' : 'cache',
  };
};
