/**
 * 横盘监控日 K 缓存：
 * - 已收盘 lookback：KLineMirror.rangeLookback（横盘私有）
 * - 当日 OHLC：统一 dayTruth（与暴涨共用）；本桶 todaySeed 为写穿投影
 * - 读盒子：closedBars + today（仅 close 换 Socket last，high 保持 REST）
 * - UTC 切日：整表失效，下一轮全量 REST
 */

import moment from 'moment';
import { getMergedTradingPairs } from '@root/src/container/market';
import {
  getSharedKLineMirror,
  createEmptyRangeLookbackBucket,
} from '@root/src/container/market/klineMirror';
import {
  getTodayTruth,
  upsertTodayFromCandle,
  todayTruthToBar,
  clearTodayTruth,
  rotateTodayTruthIfNeeded,
} from '@root/src/container/market/dayTruth';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { filterBlacklistedPairs } from '../_symbolBlacklist';
import { fetchLookbackCandles, RANGE_LOOKBACK_DAYS } from './_rangeScan';
import { RangeMonitorFatal, getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 横盘日 K 桶：落在统一 KLineMirror.rangeLookback，语义与原模块级 cacheState 相同 */
const rangeBucket = () => getSharedKLineMirror().rangeLookback;
const setRangeBucket = next => getSharedKLineMirror().replaceRangeLookback(next);

export const utcDayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

const utcDayStartMs = (ts = Date.now()) => moment.utc(ts).startOf('day').valueOf();

const cloneBar = bar => (Array.isArray(bar) ? [...bar] : null);

/**
 * @typedef {{
 *   pair: { exchange: string, symbol: string },
 *   closedBars: any[],
 *   todaySeed: any|null,
 *   today: any|null,
 * }} CandleCacheEntry
 */

/**
 * 统一仓储中的横盘桶：停止/再开监控不清理；仅 UTC 切日或 force 才全量 REST。
 * complete=true 表示上一轮全量 REST 已跑完，可安全复用。
 * 高低比不参与失效——改高低比只重算盒子，不重拉 K。
 */
const newEmptyCacheState = createEmptyRangeLookbackBucket;

export const clearRangeMonitorCandleCache = () => {
  setRangeBucket(newEmptyCacheState());
  const day = utcDayKey();
  const today = getSharedKLineMirror().todayDay;
  if (today?.dayKey && today.dayKey !== day) clearTodayTruth();
};

export const getRangeMonitorCandleCacheMeta = () => {
  const cacheState = rangeBucket();
  return {
    dayKey: cacheState.dayKey,
    size: cacheState.bySymbol.size,
    pairCount: cacheState.pairCount,
    builtAt: cacheState.builtAt,
    complete: cacheState.complete,
    fresh: cacheState.complete && cacheState.dayKey === utcDayKey() && cacheState.bySymbol.size > 0,
  };
};

const isReusableToday = () => {
  const cacheState = rangeBucket();
  if (
    !cacheState.complete ||
    cacheState.dayKey !== utcDayKey() ||
    !(cacheState.bySymbol.size > 0)
  ) {
    return false;
  }
  // 旧版缓存曾把 Socket high 写进 today 且无 todaySeed → 必须重建，否则命中为 0
  const first = cacheState.bySymbol.values().next().value;
  if (first && first.todaySeed == null && first.today != null) return false;
  return true;
};

const splitClosedAndToday = candles => {
  const sorted = [...(candles || [])].sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!sorted.length) return { closedBars: [], today: null };
  const dayStart = utcDayStartMs();
  const last = sorted[sorted.length - 1];
  const lastTs = Number(last[0]);
  if (Number.isFinite(lastTs) && lastTs >= dayStart) {
    return { closedBars: sorted.slice(0, -1).map(cloneBar), today: cloneBar(last) };
  }
  return { closedBars: sorted.map(cloneBar), today: null };
};

const synthesizeTodayFromQuote = (quote, openTime) => {
  const last = Number(quote?.last);
  const high = Number(quote?.high);
  const low = Number(quote?.low);
  if (!(last > 0)) return null;
  const h = high > 0 ? Math.max(high, last) : last;
  const l = low > 0 ? Math.min(low, last) : last;
  const o = last;
  const ts = openTime > 0 ? openTime : utcDayStartMs();
  return [ts, String(o), String(h), String(l), String(last), '0', '0'];
};

/** 用 quote 扩张当日 H/L，刷新 C */
export const applyQuoteToTodayBar = (todayBar, quote) => {
  const last = Number(quote?.last);
  if (!(last > 0)) return todayBar;
  if (!Array.isArray(todayBar) || todayBar.length < 5) {
    return synthesizeTodayFromQuote(quote, utcDayStartMs());
  }
  const open = Number(todayBar[1]);
  const high = Number(todayBar[2]);
  const low = Number(todayBar[3]);
  const nextHigh = Math.max(Number.isFinite(high) && high > 0 ? high : last, last);
  const nextLow = Math.min(Number.isFinite(low) && low > 0 ? low : last, last);
  const nextOpen = Number.isFinite(open) && open > 0 ? open : last;
  const out = [...todayBar];
  out[1] = String(nextOpen);
  out[2] = String(nextHigh);
  out[3] = String(nextLow);
  out[4] = String(last);
  return out;
};

/**
 * Socket 只更新 feed 里的 last/high/low，不再改缓存日 K 的 H/L。
 * （旧逻辑把 mid 滚进今日 high 会导致 findMonitorActiveRanges 误杀几乎全部盒子）
 */
export const syncCandleCacheTodayFromFeed = () => 0;

/** lookback 末根 / 既有 seed → 写入唯一当日真相，并拿回投影 bar */
const commitTodayBar = (symbol, todayBar, feed, exchange = 'binance') => {
  if (!Array.isArray(todayBar) || todayBar.length < 5) return null;
  const key = String(symbol || '').toUpperCase();
  rotateTodayTruthIfNeeded();
  const truth = upsertTodayFromCandle(key, todayBar, { feed, exchange });
  return todayTruthToBar(truth) || cloneBar(todayBar);
};

/**
 * 算盒子用日 K：closed + 当日真相 bar；仅把 close 换成 Socket last。
 * 今日 high/low 保持 REST 真相，绝不被 bookTicker mid / 24h ticker 撑破。
 */
export const getCachedMonitorCandles = (symbol, priceFeed) => {
  const key = String(symbol || '').toUpperCase();
  const day = utcDayKey();
  const cacheState = rangeBucket();
  if (cacheState.dayKey !== day) return null;
  const entry = cacheState.bySymbol.get(key);
  if (!entry) return null;

  const truth = getTodayTruth(key);
  const seed = (truth && todayTruthToBar(truth)) || entry.todaySeed || entry.today || null;
  if (!seed) return [...entry.closedBars];

  const today = cloneBar(seed);
  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(key);
  if (q && q.last > 0 && (!q.dayKey || q.dayKey === day)) {
    today[4] = String(q.last);
  }
  return [...entry.closedBars, today];
};

/** 单币 REST 补种：lookback 写 range；今日 bar 写 dayTruth */
export const fetchAndCacheMonitorCandles = async (pair, priceFeed) => {
  const feed = priceFeed || getSharedMiniTickerFeed();
  const day = utcDayKey();
  let cacheState = rangeBucket();
  if (cacheState.dayKey && cacheState.dayKey !== day) {
    clearRangeMonitorCandleCache();
    cacheState = rangeBucket();
  }
  cacheState.dayKey = day;

  const candles = await fetchLookbackCandles(pair, RANGE_LOOKBACK_DAYS);
  if (!Array.isArray(candles) || !candles.length) return null;

  const { closedBars, today } = splitClosedAndToday(candles);
  const key = String(pair.symbol).toUpperCase();
  const todaySeed = today
    ? commitTodayBar(key, today, feed, pair.exchange)
    : getTodayTruth(key)
      ? todayTruthToBar(getTodayTruth(key))
      : null;

  cacheState.bySymbol.set(key, {
    pair: { exchange: pair.exchange, symbol: key },
    closedBars,
    todaySeed,
    today: todaySeed,
  });

  return getCachedMonitorCandles(key, feed);
};

const loadMonitorPairs = async onStatus => {
  onStatus?.('日 K 建缓存：拉取币对列表…');
  let pairs = [];
  try {
    pairs = await getMergedTradingPairs();
  } catch (e) {
    throw new RangeMonitorFatal('币对列表拉取失败', e?.message || String(e));
  }
  if (!pairs.length) {
    throw new RangeMonitorFatal('币对列表为空', 'getMergedTradingPairs');
  }
  onStatus?.(`日 K 建缓存：币对 ${pairs.length} · 过滤股票/黑名单…`);
  let stockSymbols = new Set();
  try {
    stockSymbols = await loadStockSymbolSet();
  } catch (e) {
    throw new RangeMonitorFatal('股票列表失败', e?.message || String(e));
  }
  pairs = pairs.filter(p => !stockSymbols.has(String(p.symbol).toUpperCase()));
  pairs = filterBlacklistedPairs(pairs);
  pairs = pairs.filter(p => p.exchange === 'binance');
  if (!pairs.length) {
    throw new RangeMonitorFatal('过滤后无 Binance 币对', 'stock/blacklist');
  }
  onStatus?.(`日 K 建缓存：待拉 K ${pairs.length} 个 Binance 币对`);
  return pairs;
};

/**
 * 确保当日全市场日 K 缓存可用。
 * - 同 UTC 日且 complete：复用，只 Socket 同步今日 H/L（停止再开也不重拉）
 * - 高低比变化：不重拉 K，调用方用同一缓存重算盒子即可
 * - 否则 / force：全量 REST；若中途 abort 且此前有完整当日缓存，回滚复用旧份
 */
export const ensureRangeMonitorCandleCache = async ({
  signal,
  onStatus,
  priceFeed,
  force = false,
  maxRangeMult,
} = {}) => {
  const aborted = () => signal?.aborted;
  const feed = priceFeed || getSharedMiniTickerFeed();
  const day = utcDayKey();
  const multHint =
    maxRangeMult != null && Number.isFinite(Number(maxRangeMult))
      ? ` · 高低比≤${Number(maxRangeMult).toFixed(2)}（只重算盒子）`
      : '';

  let cacheState = rangeBucket();
  if (!force && isReusableToday()) {
    // 热重载 / 旧会话：range 有 todaySeed 但 today 桶空 → 回填唯一真相
    rotateTodayTruthIfNeeded();
    let backfilled = 0;
    cacheState.bySymbol.forEach((row, key) => {
      if (getTodayTruth(key)) return;
      const seed = row?.todaySeed || row?.today;
      if (seed && commitTodayBar(key, seed, feed, row?.pair?.exchange)) backfilled += 1;
    });
    const synced = syncCandleCacheTodayFromFeed(feed);
    cacheState = rangeBucket();
    onStatus?.(
      `日 K 缓存复用：${cacheState.bySymbol.size} 币 · UTC ${day} · Socket 同步 ${synced}${backfilled ? ` · 回填当日 ${backfilled}` : ''}${multHint}`
    );
    return {
      fromCache: true,
      dayKey: day,
      size: cacheState.bySymbol.size,
      pairs: null,
      synced,
      complete: true,
    };
  }

  // 重建前快照：abort 时恢复，避免「半截重建」毁掉已可复用的完整缓存
  cacheState = rangeBucket();
  const backup =
    cacheState.complete && cacheState.dayKey === day && cacheState.bySymbol.size > 0
      ? {
          dayKey: cacheState.dayKey,
          bySymbol: cacheState.bySymbol,
          builtAt: cacheState.builtAt,
          pairCount: cacheState.pairCount,
          complete: true,
        }
      : null;

  onStatus?.(
    backup
      ? `日 K 强制刷新：准备全量 REST（UTC ${day}）…`
      : `日 K 首次/跨日：准备全量 REST（UTC ${day}）…`
  );

  cacheState = setRangeBucket({
    ...newEmptyCacheState(),
    dayKey: day,
    complete: false,
  });

  const pairs = await loadMonitorPairs(onStatus);
  if (aborted()) {
    if (backup) {
      cacheState = setRangeBucket(backup);
      onStatus?.(`日 K REST 中断：已回滚复用 ${cacheState.bySymbol.size} 币 · UTC ${day}`);
      return {
        fromCache: true,
        aborted: true,
        rolledBack: true,
        size: cacheState.bySymbol.size,
        dayKey: day,
        complete: true,
      };
    }
    clearRangeMonitorCandleCache();
    return { fromCache: false, aborted: true, size: 0, dayKey: day, complete: false };
  }

  let loaded = 0;
  let empty = 0;
  const total = pairs.length;
  /** 与行情门闩 MAX_CONCURRENT=2 对齐 */
  const COLD_PARALLEL = 2;
  for (let i = 0; i < pairs.length; i += COLD_PARALLEL) {
    cacheState = rangeBucket();
    if (aborted()) {
      if (backup) {
        cacheState = setRangeBucket(backup);
        onStatus?.(`日 K REST 中断：已回滚复用 ${cacheState.bySymbol.size} 币 · UTC ${day}`);
        return {
          fromCache: true,
          aborted: true,
          rolledBack: true,
          size: cacheState.bySymbol.size,
          dayKey: day,
          complete: true,
        };
      }
      // 半截缓存不可复用
      clearRangeMonitorCandleCache();
      return { fromCache: false, aborted: true, size: 0, dayKey: day, complete: false };
    }
    const chunk = pairs.slice(i, i + COLD_PARALLEL);
    const done = Math.min(i + chunk.length, total);
    const pct = Math.round((done / total) * 100);
    onStatus?.(`日 K REST ${done}/${total}（${pct}%）`);

    const results = await Promise.all(
      chunk.map(async pair => {
        const key = String(pair.symbol).toUpperCase();
        try {
          const candles = await fetchLookbackCandles(pair, RANGE_LOOKBACK_DAYS);
          return { pair, key, candles, error: null };
        } catch (e) {
          return { pair, key, candles: null, error: e };
        }
      })
    );

    for (const { pair, key, candles, error } of results) {
      if (error) {
        if (backup) setRangeBucket(backup);
        if (error instanceof RangeMonitorFatal) throw error;
        throw new RangeMonitorFatal(`${key} 拉 K 失败`, error?.message || String(error));
      }
      if (!Array.isArray(candles) || !candles.length) {
        empty += 1;
        continue;
      }
      const { closedBars, today } = splitClosedAndToday(candles);
      const todaySeed = today ? commitTodayBar(key, today, feed, pair.exchange) : null;
      rangeBucket().bySymbol.set(key, {
        pair: { exchange: pair.exchange, symbol: key },
        closedBars,
        todaySeed,
        today: todaySeed,
      });
      loaded += 1;
    }
    await sleep(0);
  }

  cacheState = rangeBucket();
  cacheState.builtAt = Date.now();
  cacheState.pairCount = pairs.length;
  cacheState.complete = true;
  syncCandleCacheTodayFromFeed(feed);

  onStatus?.(
    `日 K 缓存就绪：${cacheState.bySymbol.size}/${pairs.length}（空 K ${empty}）· UTC ${day} · 同日再开将复用`
  );

  return {
    fromCache: false,
    dayKey: day,
    size: cacheState.bySymbol.size,
    pairCount: pairs.length,
    empty,
    pairs,
    aborted: false,
    complete: true,
  };
};

/** 仅完整当日缓存可列出（供开仓扫描） */
export const listCachedMonitorPairs = () => {
  if (!isReusableToday()) return [];
  return [...rangeBucket().bySymbol.values()].map(e => e.pair);
};
