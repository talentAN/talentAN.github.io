import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import {
  LOW_VOL_RANGE_BLAST_V01,
  findActiveLowVolRanges,
} from '../backtest/_lowVolRangeBlastRules';
import { waitBinanceBanIfNeeded } from '../_marketFetchGate';
import { OPEN_NOTIONAL_MULT } from './_breakoutOrder';

export const RANGE_LOOKBACK_DAYS = 200;
export const RANGE_RECENT_DAYS = 3;
/** 监控默认口径：高低比 ≤ 1.60 */
export const RANGE_MONITOR_MAX_MULT = 1.6;
/** @deprecated 监控开仓改用 MONITOR_OPEN_NOTIONAL_MULT / MONITOR_MAX_MIN_OPEN_USDT */
export const RANGE_MONITOR_MAX_OPEN_USDT = OPEN_NOTIONAL_MULT * 5;
/** 监控开仓：名义 = 最小开仓 × 该倍数 */
export const MONITOR_OPEN_NOTIONAL_MULT = 1.3;
/** 监控开仓：交易所最小开仓名义须严格小于该值（U） */
export const MONITOR_MAX_MIN_OPEN_USDT = 20;
/**
 * 近带：yy = (上沿-现价)/上沿*100；开仓要求 yy ≤ 该值；离开撤单 yy > 该值+1。
 */
export const RANGE_MONITOR_NEAR_BAND_PCT = 5;
/** 测试期：缺参/异常立刻终止全流程并弹窗；跑通后再改 false */
export const RANGE_MONITOR_STRICT = true;

export const normalizeNearBandPct = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return RANGE_MONITOR_NEAR_BAND_PCT;
  return Math.min(100, Math.round(n * 100) / 100);
};

/**
 * yy：(区间上沿 − 最新价) / 区间上沿 × 100。
 * 现价已过上沿时为负。缺参返回 null。
 */
export const calcDistBelowRangeHighPct = (lastPrice, rangeHigh) => {
  const last = Number(lastPrice);
  const high = Number(rangeHigh);
  if (!(last > 0) || !(high > 0)) return null;
  return ((high - last) / high) * 100;
};

/** 开仓近带：yy ≤ nearBandPct（且通常要求尚未过上沿） */
export const isPriceNearRangeHigh = (lastPrice, rangeHigh, nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT) => {
  const yy = calcDistBelowRangeHighPct(lastPrice, rangeHigh);
  if (yy == null) return false;
  return yy <= normalizeNearBandPct(nearBandPct);
};

/** Bitget candles：start+end 跨度不得超过 90 天 */
const BITGET_MAX_SPAN_MS = 90 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 拉取近 lookbackDays 根日 K（经全局门闩，与暴涨监控共享限频）。
 */
export const fetchLookbackCandles = async (pair, lookbackDays = RANGE_LOOKBACK_DAYS) => {
  const endTime = moment.utc().valueOf();
  const startTime = moment.utc().subtract(lookbackDays, 'days').startOf('day').valueOf();

  if (pair.exchange !== 'bitget') {
    await waitBinanceBanIfNeeded(getBinanceBanRemaining);
    // Binance：api 内门闩+退避；勿再套一层
    const res = await getFutureKlineData(
      {
        symbol: pair.symbol,
        granularity: '1Dutc',
        limit: lookbackDays + 5,
        startTime,
        endTime,
      },
      pair.exchange
    );
    return (Array.isArray(res?.data) ? res.data : []).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
  }

  const byTs = new Map();
  let chunkEnd = endTime;
  while (chunkEnd > startTime) {
    const chunkStart = Math.max(startTime, chunkEnd - BITGET_MAX_SPAN_MS + 1);
    // Bitget：经 market 层门闩
    const res = await getFutureKlineData(
      {
        symbol: pair.symbol,
        granularity: '1Dutc',
        limit: 100,
        startTime: chunkStart,
        endTime: chunkEnd,
      },
      'bitget'
    );
    const chunk = Array.isArray(res?.data) ? res.data : [];
    chunk.forEach(c => byTs.set(Number(c[0]), c));
    if (!chunk.length || chunkStart <= startTime) break;
    chunkEnd = chunkStart - 1;
    await sleep(60);
  }
  return [...byTs.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
};

export const monitorRangeRules = (maxRangeMult = RANGE_MONITOR_MAX_MULT) => ({
  ...LOW_VOL_RANGE_BLAST_V01,
  maxRangeMult,
});

/**
 * 按监控口径找仍在盒内的横盘命中（默认高低比 ≤ 1.60）。
 *
 * 监控候选：盒子终点必须是 UTC 昨天（上一根已收盘日 K），不是「近三日」窗口。
 * 几何算完后还须再滤走出区间（上破/下破），否则会去挂上沿+1tick 条件单，BN -2021。
 */
/** 未做走出区间过滤的监控候选（横盘几何 + 终点=昨天） */
export const findMonitorCandidateRanges = (candles, pair, maxRangeMult = RANGE_MONITOR_MAX_MULT) =>
  findActiveLowVolRanges(candles, pair, monitorRangeRules(maxRangeMult), {
    requireEndYesterday: true,
  });

/**
 * 候选盒子是否已因日 K / 最新价上破而不再挂突破单。
 * freshToday：首次破上沿落在「今日 UTC 日 K」或仅靠现价刚破（历史日已破则为 false，提示可忽略）。
 * @returns {null|{ reason: string, lastHigh: number|null, lastClose: number|null, freshToday: boolean, firstBreakTs: number|null }}
 */
export const getMonitorBreakAboveHigh = (candles, hit, liveLast = null) => {
  const rh = Number(hit?.rangeHigh);
  if (!(rh > 0)) {
    return { reason: '上沿无效', lastHigh: null, lastClose: null, freshToday: false, firstBreakTs: null };
  }

  const sorted = [...(candles || [])].sort((a, b) => Number(a[0]) - Number(b[0]));
  const lastBar = sorted[sorted.length - 1];
  const lastHigh = lastBar != null ? Number(lastBar[2]) : null;
  const lastClose = lastBar != null ? Number(lastBar[4]) : null;
  const lastTs = lastBar != null ? Number(lastBar[0]) : null;
  const rangeToTs = Number(hit.rangeToTs);
  const todayStart = moment.utc().startOf('day').valueOf();
  const isTodayTs = ts => Number.isFinite(ts) && ts >= todayStart;

  // 盒子结束后第一根 high > 上沿 的日 K（含今日未收盘）
  if (Number.isFinite(rangeToTs)) {
    for (let i = 0; i < sorted.length; i += 1) {
      const ts = Number(sorted[i][0]);
      if (!(ts > rangeToTs)) continue;
      const h = Number(sorted[i][2]);
      if (Number.isFinite(h) && h > rh) {
        const freshToday = isTodayTs(ts);
        return {
          reason: freshToday ? '今日日K已上破' : '盒子结束后日K已上破',
          lastHigh,
          lastClose,
          freshToday,
          firstBreakTs: ts,
        };
      }
    }
  }

  if (Number.isFinite(lastHigh) && lastHigh > rh) {
    const freshToday = isTodayTs(lastTs);
    return {
      reason: freshToday ? '当日日K最高已破上沿' : '历史日K最高已破上沿',
      lastHigh,
      lastClose,
      freshToday,
      firstBreakTs: lastTs,
    };
  }
  if (Number.isFinite(lastClose) && lastClose > rh) {
    const freshToday = isTodayTs(lastTs);
    return {
      reason: freshToday ? '当日收盘/现价写入已破上沿' : '历史收盘已破上沿',
      lastHigh,
      lastClose,
      freshToday,
      firstBreakTs: lastTs,
    };
  }
  const live = Number(liveLast);
  if (live > rh) {
    return {
      reason: '现价已过上沿',
      lastHigh,
      lastClose,
      freshToday: true,
      firstBreakTs: todayStart,
    };
  }
  return null;
};

/**
 * 是否已走出横盘盒（与回测标记日一致：上破上沿或下破下沿）。
 * 「在区间」必须两边都未破；挂突破单预检仍只用 getMonitorBreakAboveHigh（下破不影响 -2021）。
 */
export const getMonitorLeftRange = (candles, hit, liveLast = null) => {
  const above = getMonitorBreakAboveHigh(candles, hit, liveLast);
  if (above) return { ...above, side: 'above' };

  const rl = Number(hit?.rangeLow);
  if (!(rl > 0)) return null;

  const sorted = [...(candles || [])].sort((a, b) => Number(a[0]) - Number(b[0]));
  const lastBar = sorted[sorted.length - 1];
  const lastLow = lastBar != null ? Number(lastBar[3]) : null;
  const lastClose = lastBar != null ? Number(lastBar[4]) : null;
  const lastTs = lastBar != null ? Number(lastBar[0]) : null;
  const rangeToTs = Number(hit.rangeToTs);
  const todayStart = moment.utc().startOf('day').valueOf();
  const isTodayTs = ts => Number.isFinite(ts) && ts >= todayStart;

  if (Number.isFinite(rangeToTs)) {
    for (let i = 0; i < sorted.length; i += 1) {
      const ts = Number(sorted[i][0]);
      if (!(ts > rangeToTs)) continue;
      const low = Number(sorted[i][3]);
      if (Number.isFinite(low) && low < rl) {
        const freshToday = isTodayTs(ts);
        return {
          reason: freshToday ? '今日日K已下破' : '盒子结束后日K已下破',
          lastHigh: lastBar != null ? Number(lastBar[2]) : null,
          lastClose,
          freshToday,
          firstBreakTs: ts,
          side: 'below',
        };
      }
    }
  }

  if (Number.isFinite(lastLow) && lastLow < rl) {
    return {
      reason: isTodayTs(lastTs) ? '当日日K最低已破下沿' : '历史日K最低已破下沿',
      lastHigh: lastBar != null ? Number(lastBar[2]) : null,
      lastClose,
      freshToday: isTodayTs(lastTs),
      firstBreakTs: lastTs,
      side: 'below',
    };
  }
  if (Number.isFinite(lastClose) && lastClose < rl) {
    return {
      reason: isTodayTs(lastTs) ? '当日收盘/现价写入已破下沿' : '历史收盘已破下沿',
      lastHigh: lastBar != null ? Number(lastBar[2]) : null,
      lastClose,
      freshToday: isTodayTs(lastTs),
      firstBreakTs: lastTs,
      side: 'below',
    };
  }
  const live = Number(liveLast);
  if (live > 0 && live < rl) {
    return {
      reason: '现价已破下沿',
      lastHigh: lastBar != null ? Number(lastBar[2]) : null,
      lastClose,
      freshToday: true,
      firstBreakTs: todayStart,
      side: 'below',
    };
  }
  return null;
};

export const findMonitorActiveRanges = (
  candles,
  pair,
  maxRangeMult = RANGE_MONITOR_MAX_MULT,
  liveLast = null
) => {
  const hits = findMonitorCandidateRanges(candles, pair, maxRangeMult);
  if (!hits.length) return [];

  const sorted = [...(candles || [])].sort((a, b) => Number(a[0]) - Number(b[0]));
  const lastBar = sorted[sorted.length - 1];
  const lastHigh = lastBar != null ? Number(lastBar[2]) : null;
  const lastClose = lastBar != null ? Number(lastBar[4]) : null;
  const live = Number(liveLast);

  return hits
    // 在区间 = 未上破且未下破（与回测走出区间一致）；仅上破过滤会把大量「已砸穿下沿」仍算进去
    .filter(hit => !getMonitorLeftRange(candles, hit, live > 0 ? live : null))
    .map(hit => ({
      ...hit,
      lastHigh: Number.isFinite(lastHigh) ? lastHigh : hit.lastHigh,
      lastClose: Number.isFinite(lastClose) ? lastClose : hit.lastClose,
    }));
};
