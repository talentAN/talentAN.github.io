/**
 * 横盘监控日 K 缓存：
 * - 已收盘日 K：同 UTC 日内复用，不每轮 REST
 * - 当日未收盘：REST 首轮写入 O/H/L/C，之后用 Socket 最新价只向外扩张 H/L、刷新 C
 * - UTC 切日：整表失效，下一轮全量 REST
 */

import moment from 'moment';
import { getMergedTradingPairs } from '@root/src/container/market';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { filterBlacklistedPairs } from '../_symbolBlacklist';
import { fetchLookbackCandles, RANGE_LOOKBACK_DAYS } from './_rangeScan';
import { RangeMonitorFatal, getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
 * 模块级单例：停止/再开监控不清理；仅 UTC 切日或 force 才全量 REST。
 * complete=true 表示上一轮全量 REST 已跑完，可安全复用。
 * 高低比不参与失效——改高低比只重算盒子，不重拉 K。
 */
/** @type {{ dayKey: string, bySymbol: Map<string, CandleCacheEntry>, builtAt: number, pairCount: number, complete: boolean }} */
let cacheState = {
  dayKey: '',
  bySymbol: new Map(),
  builtAt: 0,
  pairCount: 0,
  complete: false,
};

const newEmptyCacheState = () => ({
  dayKey: '',
  bySymbol: new Map(),
  builtAt: 0,
  pairCount: 0,
  complete: false,
});

export const clearRangeMonitorCandleCache = () => {
  cacheState = newEmptyCacheState();
};

export const getRangeMonitorCandleCacheMeta = () => ({
  dayKey: cacheState.dayKey,
  size: cacheState.bySymbol.size,
  pairCount: cacheState.pairCount,
  builtAt: cacheState.builtAt,
  complete: cacheState.complete,
  fresh:
    cacheState.complete &&
    cacheState.dayKey === utcDayKey() &&
    cacheState.bySymbol.size > 0,
});

const isReusableToday = () => {
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

const seedFeedFromToday = (feed, symbol, today) => {
  if (!feed || typeof feed.seedDayOhlc !== 'function' || !Array.isArray(today)) return;
  const open = Number(today[1]);
  const high = Number(today[2]);
  const low = Number(today[3]);
  const close = Number(today[4]);
  if (!(close > 0) && !(high > 0)) return;
  feed.seedDayOhlc(symbol, {
    open: open > 0 ? open : close,
    high: high > 0 ? high : close,
    low: low > 0 ? low : close,
    close: close > 0 ? close : high,
  });
};

/**
 * Socket 只更新 feed 里的 last/high/low，不再改缓存日 K 的 H/L。
 * （旧逻辑把 mid 滚进今日 high 会导致 findMonitorActiveRanges 误杀几乎全部盒子）
 */
export const syncCandleCacheTodayFromFeed = () => 0;

/**
 * 算盒子用日 K：closed + REST 当日 bar；仅把 close 换成 Socket last（判现价是否已过上沿）。
 * 今日 high/low 保持 REST 种子，绝不被 bookTicker mid / 24h ticker 撑破。
 */
export const getCachedMonitorCandles = (symbol, priceFeed) => {
  const key = String(symbol || '').toUpperCase();
  const day = utcDayKey();
  if (cacheState.dayKey !== day) return null;
  const entry = cacheState.bySymbol.get(key);
  if (!entry) return null;

  const seed = entry.todaySeed || entry.today;
  if (!seed) return [...entry.closedBars];

  const today = cloneBar(seed);
  const feed = priceFeed || getSharedMiniTickerFeed();
  const q = feed.get?.(key);
  if (q && q.last > 0 && (!q.dayKey || q.dayKey === day)) {
    today[4] = String(q.last);
  }
  return [...entry.closedBars, today];
};

/** 单币 REST 补种并写入当日缓存（清理遇到缺缓存时用） */
export const fetchAndCacheMonitorCandles = async (pair, priceFeed) => {
  const feed = priceFeed || getSharedMiniTickerFeed();
  const day = utcDayKey();
  if (cacheState.dayKey && cacheState.dayKey !== day) {
    clearRangeMonitorCandleCache();
  }
  cacheState.dayKey = day;

  const candles = await fetchLookbackCandles(pair, RANGE_LOOKBACK_DAYS);
  if (!Array.isArray(candles) || !candles.length) return null;

  const { closedBars, today } = splitClosedAndToday(candles);
  const todaySeed = today || null;
  if (todaySeed) seedFeedFromToday(feed, pair.symbol, todaySeed);

  const key = String(pair.symbol).toUpperCase();
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

  if (!force && isReusableToday()) {
    const synced = syncCandleCacheTodayFromFeed(feed);
    onStatus?.(
      `日 K 缓存复用：${cacheState.bySymbol.size} 币 · UTC ${day} · Socket 同步 ${synced}${multHint}`
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

  cacheState = {
    ...newEmptyCacheState(),
    dayKey: day,
    complete: false,
  };

  const pairs = await loadMonitorPairs(onStatus);
  if (aborted()) {
    if (backup) {
      cacheState = backup;
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
  for (let i = 0; i < pairs.length; i += 1) {
    if (aborted()) {
      if (backup) {
        cacheState = backup;
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
    const pair = pairs[i];
    const key = String(pair.symbol).toUpperCase();
    const idx = i + 1;
    // 每币更新进度，并 yield 让 React 有机会上色
    if (idx === 1 || idx === total || idx % 5 === 0) {
      const pct = Math.round((idx / total) * 100);
      onStatus?.(
        `日 K REST ${idx}/${total}（${pct}%）· 已写入 ${cacheState.bySymbol.size} · ${key}`
      );
      await sleep(0);
    }
    let candles;
    try {
      candles = await fetchLookbackCandles(pair, RANGE_LOOKBACK_DAYS);
    } catch (e) {
      if (backup) cacheState = backup;
      if (e instanceof RangeMonitorFatal) throw e;
      throw new RangeMonitorFatal(`${key} 拉 K 失败`, e?.message || String(e));
    }
    if (!Array.isArray(candles) || !candles.length) {
      empty += 1;
      continue;
    }
    const { closedBars, today } = splitClosedAndToday(candles);
    const todaySeed = today || null;
    if (todaySeed) seedFeedFromToday(feed, key, todaySeed);
    cacheState.bySymbol.set(key, {
      pair: { exchange: pair.exchange, symbol: key },
      closedBars,
      todaySeed,
      today: todaySeed,
    });
    loaded += 1;
  }

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
  return [...cacheState.bySymbol.values()].map(e => e.pair);
};