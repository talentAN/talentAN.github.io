/**
 * 横盘盒子内存评估：日 K 缓存 + 现价 → 是否在区间 / yy / 是否近带 / 是否已破。
 * Socket 不改盒子几何，只提供 last 算 yy 与破上沿。
 */
import {
  findMonitorActiveRanges,
  findMonitorCandidateRanges,
  getMonitorBreakAboveHigh,
  calcDistBelowRangeHighPct,
  normalizeNearBandPct,
  RANGE_MONITOR_MAX_MULT,
  RANGE_MONITOR_NEAR_BAND_PCT,
} from './_rangeScan';
import { getCachedMonitorCandles } from './_rangeMonitorCandleCache';
import { getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';

const normalizeMaxRangeMult = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return RANGE_MONITOR_MAX_MULT;
  return Math.round(n * 100) / 100;
};

/**
 * @returns {{
 *   ok: boolean,
 *   miss?: boolean,
 *   inRange: boolean,
 *   rangeHigh: number|null,
 *   yy: number|null,
 *   nearBand: boolean,
 *   leaveBand: boolean,
 *   broke: boolean,
 *   hit: object|null,
 *   last: number,
 * }}
 */
export const evalRangeBox = (
  symbol,
  {
    maxRangeMult = RANGE_MONITOR_MAX_MULT,
    nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
    priceFeed,
    pair,
  } = {}
) => {
  const key = String(symbol || '').toUpperCase();
  const feed = priceFeed || getSharedMiniTickerFeed();
  const pairObj = pair || { exchange: 'binance', symbol: key };
  const mult = normalizeMaxRangeMult(maxRangeMult);
  const bandPct = normalizeNearBandPct(nearBandPct);
  const leavePct = bandPct + 1;

  const candles = getCachedMonitorCandles(key, feed);
  if (!Array.isArray(candles) || !candles.length) {
    return {
      ok: false,
      miss: true,
      hasBox: false,
      inRange: false,
      rangeHigh: null,
      yy: null,
      nearBand: false,
      leaveBand: false,
      broke: false,
      hit: null,
      last: 0,
    };
  }

  const last = Number(feed.get?.(key)?.last) || 0;
  const live = last > 0 ? last : null;
  // active：未上破且未下破（与回测「走出区间」一致）；须带现价，避免只靠日 K 漏判
  const active = findMonitorActiveRanges(candles, pairObj, mult, live);
  const candidates = findMonitorCandidateRanges(candles, pairObj, mult);
  // 开仓/展示：优先仍在盒内的 active；清理另看 hasBox（候选几何）
  const hit =
    (active.length
      ? [...active].sort((a, b) => (b.days || 0) - (a.days || 0))[0]
      : null) ||
    (candidates.length
      ? [...candidates].sort((a, b) => (b.days || 0) - (a.days || 0))[0]
      : null);

  const rangeHigh = hit?.rangeHigh > 0 ? Number(hit.rangeHigh) : null;
  const yy =
    rangeHigh > 0 && last > 0 ? calcDistBelowRangeHighPct(last, rangeHigh) : null;
  // broke：仅上破（挂单 -2021 预检口径）；下破不算「破上沿」
  const broke = hit
    ? Boolean(getMonitorBreakAboveHigh(candles, hit, live))
    : false;
  /** 仍有横盘几何盒子（不论现价是否已过上沿）——仅清理开多用，不能当作出场依据 */
  const hasBox = Boolean(
    (candidates.length
      ? [...candidates].sort((a, b) => (b.days || 0) - (a.days || 0))[0]
      : null)?.rangeHigh > 0
  );
  /**
   * 仍在盒内（未上破、未下破）——开仓近带：inRange && yy≤band。
   * 清理开多不能用 !inRange：现价刚过上沿时突破单应等待成交。
   */
  const inRange = active.length > 0;
  const nearBand = inRange && yy != null && yy <= bandPct;
  /** 现价明显低于上沿才算离开近带；yy≤0（已贴/过上沿）一律不算 leave */
  const leaveBand = hasBox && yy != null && yy > leavePct;

  return {
    ok: true,
    miss: false,
    hasBox,
    inRange,
    rangeHigh,
    yy,
    nearBand,
    leaveBand,
    broke,
    hit,
    last,
    bandPct,
    leavePct,
    mult,
  };
};

export { normalizeMaxRangeMult };
