/**
 * 条件4：3个低点之间的间隔至少 5 天
 *
 * L2 与 L1 之间的 K 线根数 ≥ 5，L3 与 L2 之间的 K 线根数 ≥ 5。
 * 依赖条件1（getHigherLowsResult）的结果；若条件1未通过则本条件也为 false。
 */

import { getHigherLowsResult } from './higherLows';

export const MIN_GAP_DAYS = 5;

/** 纯布尔筛选函数 */
export function minLowGap(candles) {
  const r = getHigherLowsResult(candles);
  if (!r) return false;
  return r.l2.idx - r.l1.idx >= MIN_GAP_DAYS && r.l3.idx - r.l2.idx >= MIN_GAP_DAYS;
}
