/**
 * 暴涨 + 横盘共用日 K 冷建：
 * - 宇宙：Binance − 黑名单（并集；含横盘会再滤掉的股票类）
 * - 每币 lookback≈200 根 1Dutc → REST 队 DAY_K_COLD（最高优）
 * - 写入：rangeLookback + todayDay（穿 surgeDay 镜像）
 * - 两侧 complete 后派发 MONITORS_DAYK_COLD_READY，再由各自引擎接 Socket
 */

import moment from 'moment';
import { getMergedTradingPairs } from '@root/src/container/market';
import {
  getSharedKLineMirror,
  createEmptyRangeLookbackBucket,
  createEmptySurgeDayBucket,
} from '@root/src/container/market/klineMirror';
import {
  upsertTodayFromCandle,
  todayTruthToBar,
  getTodayTruth,
  rotateTodayTruthIfNeeded,
  clearTodayTruth,
} from '@root/src/container/market/dayTruth';
import { filterBlacklistedPairs } from './_symbolBlacklist';
import { loadStockSymbolSet } from './backtest/_tradFiSymbols';
import {
  fetchLookbackCandles,
  RANGE_LOOKBACK_DAYS,
} from './low_vol_range_blast/_rangeScan';
import { getSharedMiniTickerFeed } from './low_vol_range_blast/_rangeMonitorPriceFeed';
import { utcDayKey } from './low_vol_range_blast/_rangeMonitorCandleCache';
import { loadSharedMonitorRunning } from './_sharedMonitorControl';
import {
  enqueueBinanceRestJob,
  BINANCE_REST_PRIORITY,
} from './_binanceRestQueue';

/** 双侧日 K 冷建完成（fromCache 或 REST 刚跑完） */
export const MONITORS_DAYK_COLD_READY = 'qc:monitors-dayk-cold-ready';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** 同窗入队数；REST 泵仍串行，仅减少 chunk 间空档 */
const COLD_PARALLEL = 2;

/** 单币 lookback 日 K → REST 队最高优 DAY_K_COLD */
const fetchColdLookbackViaRest = (pair, lookbackDays = RANGE_LOOKBACK_DAYS) => {
  const key = String(pair?.symbol || '').toUpperCase();
  return enqueueBinanceRestJob(
    `DAY_K_COLD:${key}`,
    () => fetchLookbackCandles(pair, lookbackDays),
    { priority: BINANCE_REST_PRIORITY.DAY_K_COLD }
  );
};

const rangeBucket = () => getSharedKLineMirror().rangeLookback;
const setRangeBucket = next => getSharedKLineMirror().replaceRangeLookback(next);
const surgeBucket = () => getSharedKLineMirror().surgeDay;
const setSurgeBucket = next => getSharedKLineMirror().replaceSurgeDay(next);

const utcDayStartMs = (ts = Date.now()) => moment.utc(ts).startOf('day').valueOf();
const cloneBar = bar => (Array.isArray(bar) ? [...bar] : null);

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

const commitTodayBar = (symbol, todayBar, feed, exchange = 'binance') => {
  if (!Array.isArray(todayBar) || todayBar.length < 5) return null;
  const key = String(symbol || '').toUpperCase();
  rotateTodayTruthIfNeeded();
  const truth = upsertTodayFromCandle(key, todayBar, { feed, exchange });
  return todayTruthToBar(truth) || cloneBar(todayBar);
};

/** 横盘 + 暴涨当日桶均完整可复用 */
export const isSharedDayKColdReusable = () => {
  const day = utcDayKey();
  const range = rangeBucket();
  const surge = surgeBucket();
  if (
    !range.complete ||
    range.dayKey !== day ||
    !(range.bySymbol.size > 0) ||
    !surge.complete ||
    surge.dayKey !== day ||
    !(surge.bySymbol.size > 0)
  ) {
    return false;
  }
  const first = range.bySymbol.values().next().value;
  if (first && first.todaySeed == null && first.today != null) return false;
  return true;
};

/** 横盘已 complete 但暴涨未：只从 today/range 回填 surge，不打 REST */
const sealSurgeFromExisting = feed => {
  const day = utcDayKey();
  rotateTodayTruthIfNeeded();
  const range = rangeBucket();
  let surge = surgeBucket();
  if (!surge || surge.dayKey !== day) {
    surge = setSurgeBucket({
      ...createEmptySurgeDayBucket(),
      dayKey: day,
      complete: false,
      builtAt: 0,
    });
  }
  let n = 0;
  range.bySymbol.forEach((row, key) => {
    if (getTodayTruth(key)) {
      const t = getTodayTruth(key);
      upsertTodayFromCandle(
        key,
        [
          t.candleTs,
          t.open,
          t.restHigh,
          t.restLow || t.open,
          t.restClose || t.restHigh,
        ],
        { feed, exchange: row?.pair?.exchange || 'binance' }
      );
      n += 1;
      return;
    }
    const seed = row?.todaySeed || row?.today;
    if (seed && commitTodayBar(key, seed, feed, row?.pair?.exchange || 'binance')) {
      n += 1;
    }
  });
  surge = surgeBucket();
  surge.dayKey = day;
  surge.complete = true;
  surge.builtAt = Date.now();
  return n;
};

const finalizeSurgeComplete = day => {
  const surge = surgeBucket();
  surge.dayKey = day;
  surge.complete = true;
  surge.builtAt = Date.now();
};

export const dispatchMonitorsDayKColdReady = detail => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(MONITORS_DAYK_COLD_READY, { detail: detail || {} })
    );
  } catch (_) {
    /* ignore */
  }
};

/** @param {(s: string) => void} fn */
export const subscribeMonitorsDayKColdReady = fn => {
  if (typeof window === 'undefined') return () => {};
  const handler = e => {
    try {
      fn(e?.detail || {});
    } catch (_) {
      /* ignore */
    }
  };
  window.addEventListener(MONITORS_DAYK_COLD_READY, handler);
  return () => window.removeEventListener(MONITORS_DAYK_COLD_READY, handler);
};

/**
 * @typedef {{
 *   promise: Promise<object>,
 *   statusListeners: Set<(s: string) => void>,
 * }} ColdFlight
 */

/** @type {ColdFlight|null} */
let coldFlight = null;

const emitFlightStatus = (flight, msg) => {
  flight.statusListeners.forEach(fn => {
    try {
      fn(msg);
    } catch (_) {
      /* ignore */
    }
  });
};

const loadUnionPairs = async onStatus => {
  onStatus?.('共用冷建：拉取币对列表…');
  let pairs = [];
  try {
    pairs = await getMergedTradingPairs();
  } catch (e) {
    throw new Error(`币对列表拉取失败：${e?.message || e}`);
  }
  pairs = filterBlacklistedPairs(pairs).filter(p => p.exchange === 'binance');
  if (!pairs.length) throw new Error('过滤后无 Binance 币对');
  onStatus?.(
    `共用冷建：待拉 ${pairs.length} 币 · ${RANGE_LOOKBACK_DAYS} 日 K（暴涨∪横盘）`
  );
  return pairs;
};

const runSharedColdBuild = async ({ aborted, onStatus, priceFeed, force }) => {
  const feed = priceFeed || getSharedMiniTickerFeed();
  const day = utcDayKey();

  if (!force && isSharedDayKColdReusable()) {
    onStatus?.(
      `共用日 K 复用：横盘 ${rangeBucket().bySymbol.size} · 暴涨 ${surgeBucket().bySymbol.size} · UTC ${day}`
    );
    const detail = {
      fromCache: true,
      dayKey: day,
      size: rangeBucket().bySymbol.size,
      surgeSize: surgeBucket().bySymbol.size,
      complete: true,
      aborted: false,
    };
    dispatchMonitorsDayKColdReady(detail);
    return detail;
  }

  // 仅横盘可复用：补盖暴涨 complete，免二次全表 REST
  const range = rangeBucket();
  if (
    !force &&
    range.complete &&
    range.dayKey === day &&
    range.bySymbol.size > 0 &&
    !(surgeBucket().complete && surgeBucket().dayKey === day)
  ) {
    onStatus?.('共用冷建：横盘已就绪，回填暴涨日 K…');
    const seeded = sealSurgeFromExisting(feed);
    onStatus?.(
      `共用冷建：暴涨已回填 ${seeded} 币 · UTC ${day} · 无需再拉 REST`
    );
    const detail = {
      fromCache: true,
      seededSurge: true,
      dayKey: day,
      size: range.bySymbol.size,
      surgeSize: surgeBucket().bySymbol.size,
      complete: true,
      aborted: false,
    };
    dispatchMonitorsDayKColdReady(detail);
    return detail;
  }

  const backupRange =
    range.complete && range.dayKey === day && range.bySymbol.size > 0
      ? {
          dayKey: range.dayKey,
          bySymbol: range.bySymbol,
          builtAt: range.builtAt,
          pairCount: range.pairCount,
          complete: true,
        }
      : null;
  const surge = surgeBucket();
  const backupSurge =
    surge.complete && surge.dayKey === day && surge.bySymbol.size > 0
      ? {
          dayKey: surge.dayKey,
          bySymbol: surge.bySymbol,
          complete: true,
          builtAt: surge.builtAt,
        }
      : null;

  onStatus?.(
    backupRange
      ? `共用冷建：强制刷新 ${RANGE_LOOKBACK_DAYS} 日 K（UTC ${day}）…`
      : `共用冷建：首次/跨日拉 ${RANGE_LOOKBACK_DAYS} 日 K（UTC ${day}）…`
  );

  setRangeBucket({
    ...createEmptyRangeLookbackBucket(),
    dayKey: day,
    complete: false,
  });
  setSurgeBucket({
    ...createEmptySurgeDayBucket(),
    dayKey: day,
    complete: false,
    builtAt: 0,
  });
  // 全量 REST 前清空当日真相，避免与半旧 open 混写
  clearTodayTruth();
  rotateTodayTruthIfNeeded();

  const pairs = await loadUnionPairs(onStatus);
  if (aborted?.()) {
    if (backupRange) setRangeBucket(backupRange);
    if (backupSurge) setSurgeBucket(backupSurge);
    return { fromCache: true, aborted: true, complete: false, dayKey: day };
  }

  let loaded = 0;
  let empty = 0;
  const total = pairs.length;

  for (let i = 0; i < pairs.length; i += COLD_PARALLEL) {
    if (aborted?.()) {
      if (backupRange) setRangeBucket(backupRange);
      if (backupSurge) setSurgeBucket(backupSurge);
      else {
        setRangeBucket(createEmptyRangeLookbackBucket());
        setSurgeBucket(createEmptySurgeDayBucket());
      }
      return { fromCache: Boolean(backupRange), aborted: true, complete: false, dayKey: day };
    }

    const chunk = pairs.slice(i, i + COLD_PARALLEL);
    const done = Math.min(i + chunk.length, total);
    const pct = Math.round((done / total) * 100);
    onStatus?.(`共用冷建 REST ${done}/${total}（${pct}%）`);

    const results = await Promise.all(
      chunk.map(async pair => {
        const key = String(pair.symbol).toUpperCase();
        try {
          const candles = await fetchColdLookbackViaRest(pair, RANGE_LOOKBACK_DAYS);
          return { pair, key, candles, error: null };
        } catch (e) {
          return { pair, key, candles: null, error: e };
        }
      })
    );

    for (const { pair, key, candles, error } of results) {
      if (error) {
        if (backupRange) setRangeBucket(backupRange);
        if (backupSurge) setSurgeBucket(backupSurge);
        throw new Error(`${key} 拉 K 失败：${error?.message || error}`);
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

  const cacheState = rangeBucket();
  cacheState.builtAt = Date.now();
  cacheState.pairCount = pairs.length;
  cacheState.dayKey = day;
  cacheState.complete = true;
  finalizeSurgeComplete(day);

  onStatus?.(
    `共用冷建就绪：${cacheState.bySymbol.size}/${total}（空 K ${empty}）· 暴涨/横盘均可复用 · UTC ${day}`
  );

  const detail = {
    fromCache: false,
    dayKey: day,
    size: cacheState.bySymbol.size,
    surgeSize: surgeBucket().bySymbol.size,
    pairCount: total,
    empty,
    pairs,
    complete: true,
    aborted: false,
  };
  dispatchMonitorsDayKColdReady(detail);
  return detail;
};

/**
 * 单飞共用冷建。多调用方共享同一 Promise，onStatus 会扇出。
 */
/**
 * 单飞共用冷建。
 * @param aborted 已忽略：中止只看 loadSharedMonitorRunning()，避免单侧 cleanup 拆掉双侧冷建
 */
export const ensureSharedDayKColdBuild = ({
  aborted: _aborted,
  onStatus,
  priceFeed,
  force = false,
} = {}) => {
  if (coldFlight) {
    if (typeof onStatus === 'function') coldFlight.statusListeners.add(onStatus);
    return coldFlight.promise;
  }

  const statusListeners = new Set();
  if (typeof onStatus === 'function') statusListeners.add(onStatus);
  const flight = { statusListeners, promise: null };
  coldFlight = flight;

  flight.promise = runSharedColdBuild({
    aborted: () => !loadSharedMonitorRunning(),
    onStatus: msg => emitFlightStatus(flight, msg),
    priceFeed,
    force,
  }).finally(() => {
    if (coldFlight === flight) coldFlight = null;
  });

  return flight.promise;
};

/** 冷建完成后的横盘引擎币对（再滤股票） */
export const listSharedColdPairsForRange = async () => {
  if (!rangeBucket().complete || rangeBucket().dayKey !== utcDayKey()) return [];
  let stockSymbols = new Set();
  try {
    stockSymbols = await loadStockSymbolSet();
  } catch (_) {
    stockSymbols = new Set();
  }
  return [...rangeBucket().bySymbol.values()]
    .map(e => e.pair)
    .filter(p => p?.symbol && !stockSymbols.has(String(p.symbol).toUpperCase()));
};

/** 冷建完成后的暴涨引擎币对（全量缓存币） */
export const listSharedColdPairsForSurge = () => {
  if (!(rangeBucket().complete || surgeBucket().complete)) return [];
  const fromRange = [...rangeBucket().bySymbol.values()].map(e => e.pair);
  if (fromRange.length) return fromRange;
  return [...surgeBucket().bySymbol.values()].map(row => ({
    exchange: row.exchange || 'binance',
    symbol: row.symbol,
  }));
};
