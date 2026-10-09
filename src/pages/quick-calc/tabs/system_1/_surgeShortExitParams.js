/** 暴涨100：小时 K 线时间单位，当前为 1 小时。 */
export const SURGE_SHORT_EXIT_HOUR_MS = 3600 * 1000;
/** 暴涨100：策略目标追踪回撤比例，单位百分比。 */
export const SURGE_SHORT_EXIT_TRAIL_CALLBACK_WANTED = 15;
/** 暴涨100：Binance 允许的追踪回撤比例上限，单位百分比。 */
export const SURGE_SHORT_EXIT_TRAIL_CALLBACK_BINANCE_MAX = 10;
/** 暴涨100：空头固定止盈区间与平仓比例。 */
export const SURGE_SHORT_EXIT_BANDS = {
  // zz > 0.8E：价格回落到开仓价 0.8 倍时，平当前仓位 20%。
  shallow: { mult: 0.8, ratio: 0.2, key: 'tp80' },
  // 0.7E < zz ≤ 0.8E：价格回落到开仓价 0.65 倍时，平当前仓位 25%。
  mid: { mult: 0.65, ratio: 0.2, key: 'tp65' },
  // 0.5E < zz ≤ 0.7E：价格回落到开仓价 0.5 倍时，平当前仓位 25%，剩余仓位可挂追踪。
  deep: { mult: 0.5, ratio: 0.25, key: 'tp50' },
};
/** 暴涨100：固定止盈、追踪委托连续提交之间的间隔，单位毫秒。 */
export const SURGE_SHORT_EXIT_PLACE_GAP_MS = 80;
