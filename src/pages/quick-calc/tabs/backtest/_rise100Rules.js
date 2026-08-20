import { isBreakoutHistoricalHigh } from '@root/src/utils/kline-pattern';

export const FOLLOW_UP_DAYS = 14;
export const EXTENDED_WINDOWS = [30, 60, 90];
export const MIN_LISTING_DAYS = 30;
const LISTING_MS = MIN_LISTING_DAYS * 24 * 60 * 60 * 1000;

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isoDate = timestamp => new Date(Number(timestamp)).toISOString().slice(0, 10);

const windowStats = (sorted, index, days, threshold) => {
  const follow = sorted.slice(index + 1, index + 1 + days);
  const highs = follow.map(c => finite(c[2])).filter(v => v != null);
  const lows = follow.map(c => finite(c[3])).filter(v => v != null);
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const complete = follow.length === days;
  return {
    followDays: follow.length,
    high,
    low,
    highVsThreshold: high != null ? (high / threshold - 1) * 100 : null,
    lowVsThreshold: low != null ? (low / threshold - 1) * 100 : null,
    status: complete ? (low < threshold ? 'success' : 'failed') : 'pending',
  };
};

/**
 * 标记日：日内最高价严格超过开盘价的 2 倍；上架未满 30 天、或当日最高价为历史新高，均不算。
 * 成功：之后 14 根日 K 的最低价严格低于标记日开盘价的 2 倍。
 * 最新不足 14 根的样本标为 pending，不进入成功率分母。
 * later30 / later60 / later90：同一口径在更长窗口上的结果。
 */
export const findRise100Markers = (candles, pair) => {
  const sorted = [...(candles || [])]
    .filter(c => Array.isArray(c) && c.length >= 5)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const markers = [];

  for (let index = 0; index < sorted.length; index++) {
    const candle = sorted[index];
    const open = finite(candle[1]);
    const high = finite(candle[2]);
    if (!(open > 0) || high == null || high <= open * 2) continue;

    const listedAt = Number(sorted[0][0]);
    if (!Number.isFinite(listedAt) || Number(candle[0]) - listedAt < LISTING_MS) continue;

    const ath = isBreakoutHistoricalHigh(candle[0], sorted);
    if (ath.isBreakout) continue;

    const threshold = open * 2;
    const twoWeek = windowStats(sorted, index, FOLLOW_UP_DAYS, threshold);
    const later = {};
    EXTENDED_WINDOWS.forEach(days => {
      later[`later${days}`] = windowStats(sorted, index, days, threshold);
    });

    markers.push({
      // 标记日当天 + 之后 90 根，供阶梯开仓回测复用，避免二次拉取
      followCandles: sorted.slice(index, index + 1 + Math.max(...EXTENDED_WINDOWS)),
      key: `${pair.exchange}:${pair.symbol}:${candle[0]}`,
      symbol: pair.symbol,
      exchange: pair.exchange,
      markerDate: isoDate(candle[0]),
      markerOpen: open,
      markerHigh: high,
      markerRise: (high / open - 1) * 100,
      threshold,
      twoWeekHigh: twoWeek.high,
      twoWeekLow: twoWeek.low,
      highVsThreshold: twoWeek.highVsThreshold,
      lowVsThreshold: twoWeek.lowVsThreshold,
      followDays: twoWeek.followDays,
      status: twoWeek.status,
      ...later,
    });
  }

  return markers;
};

const RISE_BUCKET = 50;

// 标记日最高价相对开盘的涨幅分档，size 为区间宽度（默认 50：100-150、150-200）
export const bucketMarkerRise = (rows, size = RISE_BUCKET) => {
  const step = Number(size) > 0 ? Number(size) : RISE_BUCKET;
  const rises = (rows || []).map(row => row.markerRise).filter(value => Number.isFinite(value));
  const total = rises.length;
  if (!total) return [];

  const counts = new Map();
  rises.forEach(rise => {
    const start = Math.floor(rise / step) * step;
    counts.set(start, (counts.get(start) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      start,
      end: start + step,
      label: `${start}-${start + step}`,
      count,
      pct: (count / total) * 100,
    }));
};

// 成功样本里，后 14 日最低价比成功线（开盘×2）低多少，按 size 个点一档
export const bucketSuccessDrop = (rows, size = 10) => {
  const step = Number(size) > 0 ? Number(size) : 10;
  const drops = (rows || [])
    .filter(row => row.status === 'success' && Number.isFinite(row.lowVsThreshold))
    .map(row => -row.lowVsThreshold);
  const total = drops.length;
  if (!total) return [];

  const counts = new Map();
  drops.forEach(drop => {
    const start = Math.floor(drop / step) * step;
    counts.set(start, (counts.get(start) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, count]) => ({
      start,
      end: start + step,
      label: `${start}-${start + step}`,
      count,
      pct: (count / total) * 100,
    }));
};

export const summarizeMarkers = rows => {
  const completed = rows.filter(row => row.status !== 'pending');
  const success = completed.filter(row => row.status === 'success').length;
  let maxHighVsThreshold = null;
  let maxHighVsThresholdKey = null;
  completed.forEach(row => {
    if (!Number.isFinite(row.highVsThreshold)) return;
    if (maxHighVsThreshold == null || row.highVsThreshold > maxHighVsThreshold) {
      maxHighVsThreshold = row.highVsThreshold;
      maxHighVsThresholdKey = row.key;
    }
  });
  return {
    total: rows.length,
    completed: completed.length,
    pending: rows.length - completed.length,
    success,
    failed: completed.length - success,
    successRate: completed.length ? (success / completed.length) * 100 : null,
    maxHighVsThreshold,
    maxHighVsThresholdKey,
    riseBuckets: bucketMarkerRise(rows),
  };
};
