/**
 * 条件3：近期成交量偏低
 *
 * 最近 15 日平均成交额 ≤ 过去 100 日平均成交额
 */

const QUOTE_VOL = 6;
const RECENT_WINDOW = 15;
const LONG_WINDOW = 100;

/**
 * 始终返回量化指标（数据不足时取全部，至少需要 2 根）
 * { vol15, vol100, volRatio, recentWindow, longWindow }
 * volRatio = vol15 / vol100 × 100（%），< 100 说明近期量低于长期均量
 */
export function getVolumeMetrics(candles) {
  if (candles.length < 2) return null;
  const recentWindow = Math.min(candles.length, RECENT_WINDOW);
  const longWindow = Math.min(candles.length, LONG_WINDOW);
  const recent = candles.slice(-recentWindow);
  const long = candles.slice(-longWindow);
  const vol15 = recent.reduce((s, c) => s + (parseFloat(c[QUOTE_VOL]) || 0), 0) / recent.length;
  const vol100 = long.reduce((s, c) => s + (parseFloat(c[QUOTE_VOL]) || 0), 0) / long.length;
  return {
    vol15: Math.round(vol15),
    vol100: Math.round(vol100),
    volRatio: vol100 > 0 ? +((vol15 / vol100) * 100).toFixed(1) : null,
    recentWindow,
    longWindow,
  };
}

/** 纯布尔筛选函数 */
export function lowVolume(candles) {
  const m = getVolumeMetrics(candles);
  return m !== null && m.vol15 <= m.vol100;
}
