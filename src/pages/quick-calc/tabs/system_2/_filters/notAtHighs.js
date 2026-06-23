/**
 * 条件2：当前价格未在历史高位
 *
 * 当前收盘价 < 过去 100 日最高价 × 70%
 */

const HIGH = 2,
  CLOSE = 4;
const LOOKBACK = 100;
export const HIGH_THRESHOLD_PCT = 70; // 低于历史高点的百分比阈值

/**
 * 始终返回量化指标（数据不足 100 根时取全部数据，至少需要 2 根）
 * { currentPrice, high100, highRatio, lookback }
 * highRatio = currentPrice / high100 × 100（%）
 */
export function getHighsMetrics(candles) {
  if (candles.length < 2) return null;
  const lookback = Math.min(candles.length, LOOKBACK);
  const slice = candles.slice(-lookback);
  const high100 = Math.max(...slice.map(c => parseFloat(c[HIGH])));
  const currentPrice = parseFloat(candles[candles.length - 1][CLOSE]);
  return {
    currentPrice,
    high100,
    highRatio: +((currentPrice / high100) * 100).toFixed(1),
    lookback,
  };
}

/** 纯布尔筛选函数 */
export function notAtHighs(candles) {
  const m = getHighsMetrics(candles);
  return m !== null && m.highRatio < HIGH_THRESHOLD_PCT;
}
