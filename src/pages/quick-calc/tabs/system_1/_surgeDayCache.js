/**
 * 暴涨监控日 K 缓存（Binance）：
 * - 存储：统一 KLineMirror.surgeDay（与横盘分桶，互不覆盖）
 * - 冷建：UTC 日内 REST limit=1 拉一次 open/high，写入缓存并 seed bookTicker
 * - 暖扫：只读缓存 + Socket 滚高；缺缓存跳过，不进扫轮 REST
 * - 背景补 H：慢队列 REST 补漏 + 把 high 往上修，不计入一轮耗时
 * - Bitget-only 不进本缓存
 */

import { getFutureKlineData, getTradeUrl } from '@root/src/container/market';
import {
  getSharedKLineMirror,
  createEmptySurgeDayBucket,
} from '@root/src/container/market/klineMirror';
import {
  waitBinanceBanIfNeeded,
  getBinanceBanRemaining,
  shouldThrottleBinanceBackground,
} from '../_marketFetchGate';
import { isBinanceAccountMirrorRestInflight } from '@root/src/container/binance/accountMirror';
import { getSharedMiniTickerFeed } from '../low_vol_range_blast/_rangeMonitorPriceFeed';

/** 日K粒度：UTC 日线 */
const GRANULARITY = '1Dutc';
/** 冷建每批并行币数（门闩仍限并发，主要控制进度上报粒度） */
const COLD_PARALLEL = 2;
/** 背景补H（旧慢队列）轮询间隔；事件引擎过期补K是主路径 */
const RECONCILE_GAP_MS = 350;
/** 限流/账户 REST 忙时，背景补H 主动休眠多久 */
const RECONCILE_THROTTLE_SLEEP_MS = 3000;

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

/**
 * 旧「全表慢速补H」状态机（可停；主路径已是事件引擎过期补K）。
 * stop=停；cursor=下一币下标；cycle=转完一圈次数。
 */
let reconcileState = {
  stop: true,
  promise: null,
  cursor: 0,
  pairs: [],
  cycle: 0,
  lastKey: '',
  lastAt: null,
  onProgress: null,
};

const emitReconcileProgress = () => {
  const total = reconcileState.pairs.length;
  const idx = total ? ((reconcileState.cursor - 1) % total) + 1 : 0;
  const info = {
    running: !reconcileState.stop && Boolean(reconcileState.promise),
    cycle: reconcileState.cycle,
    index: idx,
    total,
    lastKey: reconcileState.lastKey,
    lastAt: reconcileState.lastAt,
  };
  try {
    reconcileState.onProgress?.(info);
  } catch (_) {
    /* ignore */
  }
  return info;
};

/** 背景补H 进度快照（running/cycle/index/total） */
export const getSurgeReconcileProgress = () => {
  const total = reconcileState.pairs.length;
  const idx = total ? ((reconcileState.cursor - 1) % total) + 1 : 0;
  return {
    running: !reconcileState.stop && Boolean(reconcileState.promise),
    cycle: reconcileState.cycle,
    index: idx,
    total,
    lastKey: reconcileState.lastKey,
    lastAt: reconcileState.lastAt,
  };
};

/** 清空暴涨日K桶 */
export const clearSurgeDayCache = () => {
  setSurgeBucket(createEmptySurgeDayBucket());
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
      cacheState.complete &&
      cacheState.dayKey === surgeUtcDayKey() &&
      cacheState.bySymbol.size > 0,
  };
};

const fetchDayCandle = symbol => fetchSurgeDayCandle(symbol);

const writeEntryFromCandle = (pair, candle, feed) => {
  const symbol = String(pair.symbol || '').toUpperCase();
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const last = parseFloat(candle[4]);
  if (!(open > 0) || !(high > 0)) return null;

  const dayKey = surgeUtcDayKey();
  const cacheState = surgeBucket();
  const prev = cacheState.bySymbol.get(symbol);
  const mergedHigh = Math.max(high, prev?.high || 0, last || 0);
  const mergedLast = last > 0 ? last : prev?.last || high;

  const entry = {
    exchange: 'binance',
    symbol,
    open: prev?.dayKey === dayKey && prev.open > 0 ? prev.open : open,
    high: mergedHigh,
    last: mergedLast,
    candleTs: Number(candle[0]) || prev?.candleTs || Date.now(),
    dayKey,
  };
  cacheState.bySymbol.set(symbol, entry);

  feed?.seedDayOhlc?.(symbol, {
    open: entry.open,
    high: entry.high,
    low: entry.open,
    close: entry.last,
  });
  return entry;
};

/** REST 日 K 写入暴涨桶（冷建 / 过期补数共用） */
export const writeSurgeDayFromCandle = (pair, candle, feed) =>
  writeEntryFromCandle(pair, candle, feed);

/** Socket 滚高：用 feed 更新桶内 high/last（保留 open） */
export const touchSurgeDayFromFeed = (symbol, priceFeed) => {
  const key = String(symbol || '').toUpperCase();
  const day = surgeUtcDayKey();
  const cacheState = surgeBucket();
  const entry = cacheState.bySymbol.get(key);
  if (!entry || entry.dayKey !== day || !(entry.open > 0)) return null;
  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(key);
  if (!q || (q.dayKey && q.dayKey !== day)) return entry;
  const feedHigh = Number(q.high) || 0;
  const feedLast = Number(q.last) || 0;
  const high = Math.max(entry.high || 0, feedHigh, feedLast, entry.last || 0);
  const last = feedLast > 0 ? feedLast : entry.last || high;
  if (high > entry.high) entry.high = high;
  if (last > 0) entry.last = last;
  return entry;
};

/** 单币 REST 拉当日日 K（走门闩） */
export const fetchSurgeDayCandle = async symbol => {
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);
  const res = await getFutureKlineData(
    { symbol, granularity: GRANULARITY, limit: 1 },
    'binance'
  );
  const candles = Array.isArray(res?.data) ? res.data : [];
  return candles[0] || null;
};

/**
 * 确保 Binance 当日 open/high 缓存可用。同 UTC 日且 complete 则复用。
 */
export const ensureSurgeDayCache = async ({
  pairs,
  aborted,
  onStatus,
  priceFeed,
} = {}) => {
  const day = surgeUtcDayKey();
  const feed = priceFeed || getSharedMiniTickerFeed();
  const binancePairs = (pairs || []).filter(
    p => p?.exchange === 'binance' && p?.symbol
  );

  let cacheState = surgeBucket();
  if (
    cacheState.complete &&
    cacheState.dayKey === day &&
    cacheState.bySymbol.size > 0
  ) {
    onStatus?.(
      `暴涨日 K 复用：${cacheState.bySymbol.size} 币 · UTC ${day} · Socket 暖扫`
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
  // 横盘同日已冷建完时，todaySeed 可直接喂暴涨桶，少打一整轮 limit=1
  const rangeState = getSharedKLineMirror().rangeLookback;
  const canSeedFromRange =
    rangeState?.complete &&
    rangeState.dayKey === day &&
    (rangeState.bySymbol?.size || 0) > 0;

  onStatus?.(
    total
      ? canSeedFromRange
        ? `暴涨日 K 冷建：0/${total}…（可复用横盘当日种子）`
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
    onStatus?.(
      `暴涨日 K 冷建 ${done}/${total}（${Math.round((done / total) * 100)}%）· 种${seeded}/拉${fetched}`
    );

    await Promise.all(
      chunk.map(async pair => {
        const key = String(pair.symbol).toUpperCase();
        try {
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

/** 暖扫：缓存 open + max(缓存H, Socket H/last) */
export const getSurgeInfoFromCache = (pair, priceFeed) => {
  if (!pair || pair.exchange !== 'binance') return null;
  const day = surgeUtcDayKey();
  const symbol = String(pair.symbol || '').toUpperCase();
  const entry = surgeBucket().bySymbol.get(symbol);
  if (!entry || entry.dayKey !== day || !(entry.open > 0)) return null;

  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(symbol);
  const feedHigh = q && (!q.dayKey || q.dayKey === day) ? Number(q.high) || 0 : 0;
  const feedLast = q && (!q.dayKey || q.dayKey === day) ? Number(q.last) || 0 : 0;
  const high = Math.max(entry.high || 0, feedHigh, feedLast, entry.last || 0);
  const last = feedLast > 0 ? feedLast : entry.last || high;
  if (!(high > 0)) return null;

  if (high > entry.high) {
    entry.high = high;
  }
  if (last > 0) entry.last = last;

  return {
    exchange: 'binance',
    symbol,
    open: entry.open,
    high,
    ratio: high / entry.open,
    last,
    candleTs: entry.candleTs,
    link: getTradeUrl(symbol, 'binance'),
    via: feedLast > 0 || feedHigh > 0 ? 'cache+socket' : 'cache',
  };
};

/** Bitget / 缺缓存：REST 单次日 K（与旧逻辑一致） */
export const fetchSurgeInfoRest = async (pair, { seedFeed = false } = {}) => {
  const { symbol, exchange } = pair || {};
  if (!symbol || !exchange) return null;
  if (exchange === 'binance') await waitBinanceBanIfNeeded(getBinanceBanRemaining);
  const res = await getFutureKlineData(
    { symbol, granularity: GRANULARITY, limit: 1 },
    exchange
  );
  const candles = Array.isArray(res?.data) ? res.data : [];
  if (!candles.length) return null;
  const candle = candles[0];
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const last = parseFloat(candle[4]);
  if (!(open > 0) || !(high > 0)) return null;

  if (exchange === 'binance' && seedFeed) {
    writeEntryFromCandle(pair, candle, getSharedMiniTickerFeed());
  }

  return {
    exchange,
    symbol,
    open,
    high,
    ratio: high / open,
    last: last || high,
    candleTs: Number(candle[0]),
    link: getTradeUrl(symbol, exchange),
    via: 'rest',
  };
};

/**
 * 背景慢队列：轮转 Binance 币对 REST 补当日 H（max 合并）。
 * 与扫轮并行，不 await 进扫轮。
 * - 冷建完成后一直转圈；UTC 切日由 ensureSurgeDayCache 重建后再继续
 * - 限流 / 权重高 / req/min 近顶时主动暂停；正常约数十秒～数分钟一圈
 */
export const startSurgeHighReconcile = ({
  pairs,
  aborted,
  priceFeed,
  onProgress,
} = {}) => {
  if (Array.isArray(pairs)) {
    setSurgeReconcilePairs(pairs);
  }
  if (typeof onProgress === 'function') {
    reconcileState.onProgress = onProgress;
  }
  reconcileState.stop = false;
  if (reconcileState.promise) {
    emitReconcileProgress();
    return reconcileState.promise;
  }

  const feed = priceFeed || getSharedMiniTickerFeed();
  reconcileState.promise = (async () => {
    while (!reconcileState.stop && !aborted?.()) {
      const list = reconcileState.pairs;
      if (!list.length) {
        emitReconcileProgress();
        await sleep(1000);
        continue;
      }
      const cacheState = surgeBucket();
      if (cacheState.dayKey !== surgeUtcDayKey()) {
        // 等扫轮冷建切日缓存，避免用旧 open 写新日
        emitReconcileProgress();
        await sleep(1000);
        continue;
      }
      if (!cacheState.complete) {
        emitReconcileProgress();
        await sleep(500);
        continue;
      }

      // 限流 / 预算紧 / 账户 REST 打底中：背景补 H 主动让路（勿与 openOrders 双飞）
      if (shouldThrottleBinanceBackground() || isBinanceAccountMirrorRestInflight()) {
        emitReconcileProgress();
        const banLeft = getBinanceBanRemaining();
        await sleep(banLeft > 0 ? Math.min(banLeft + 200, 5000) : RECONCILE_THROTTLE_SLEEP_MS);
        continue;
      }

      const idx = reconcileState.cursor % list.length;
      const pair = list[idx];
      const key = String(pair.symbol).toUpperCase();
      reconcileState.cursor = idx + 1;

      try {
        const candle = await fetchDayCandle(key);
        if (candle && !reconcileState.stop && !aborted?.()) {
          writeEntryFromCandle(pair, candle, feed);
          reconcileState.lastKey = key;
          reconcileState.lastAt = Date.now();
        }
      } catch (e) {
        console.warn('[SurgeDayCache] reconcile', key, e);
      }

      if (reconcileState.cursor % list.length === 0) {
        reconcileState.cycle += 1;
      }
      emitReconcileProgress();
      await sleep(RECONCILE_GAP_MS);
    }
  })().finally(() => {
    reconcileState.promise = null;
    emitReconcileProgress();
  });

  emitReconcileProgress();
  return reconcileState.promise;
};

export const stopSurgeHighReconcile = () => {
  reconcileState.stop = true;
  reconcileState.onProgress = null;
  emitReconcileProgress();
};

export const setSurgeReconcilePairs = pairs => {
  const next = (pairs || []).filter(p => p?.exchange === 'binance' && p?.symbol);
  const prevLen = reconcileState.pairs.length;
  reconcileState.pairs = next;
  // 列表长度变化时避免 cursor 越界；不因每轮 setPairs 清零进度
  if (!next.length) {
    reconcileState.cursor = 0;
  } else if (reconcileState.cursor > next.length || prevLen !== next.length) {
    reconcileState.cursor = reconcileState.cursor % next.length;
  }
};
