/**
 * 条件1：连续3个更高低点
 *
 * 低点定义：某日 K 线最低价 < 其前2天和后2天的最低价（严格小于）
 * 三个低点 L1 < L2 < L3（低价依次抬升）
 * L3（最近）距最后一根 K 线 ≤ 10 天
 * L1（最远）是其前 20 根 K 线中的最低价
 */

const LOW = 3;
const SWING_WINDOW = 2; // 前后各看 N 根

/** 找所有 swing low 的索引 */
function findSwingLows(candles) {
  const result = [];
  for (let i = SWING_WINDOW; i < candles.length - SWING_WINDOW; i++) {
    const cur = parseFloat(candles[i][LOW]);
    let ok = true;
    for (let j = i - SWING_WINDOW; j <= i + SWING_WINDOW; j++) {
      if (j === i) continue;
      if (parseFloat(candles[j][LOW]) <= cur) {
        ok = false;
        break;
      }
    }
    if (ok) result.push(i);
  }
  return result;
}

/**
 * 返回满足条件的 { l1, l2, l3 } 或 null
 * 每个低点：{ idx, lowPrice, date }
 *
 * 注意：L1/L2/L3 不要求在 swing low 列表里相邻，允许中间有其他低点存在。
 * 算法：先确定 L3（最近 ≤10 天的 swing low），再向前搜索满足 low < L3 的 L2，
 *       再向前搜索满足 low < L2 且满足前20天最低价条件的 L1。
 */
export function getHigherLowsResult(candles) {
  const idxs = findSwingLows(candles);
  if (idxs.length < 3) return null;

  // Step 1：找最近的 L3（距最后一根 K 线 ≤ 10 天的 swing low）
  let l3Pos = -1;
  for (let k = idxs.length - 1; k >= 0; k--) {
    if (candles.length - 1 - idxs[k] <= 10) {
      l3Pos = k;
      break;
    }
  }
  if (l3Pos < 2) return null; // 前面至少还要有2个 swing low

  const i3 = idxs[l3Pos],
    low3 = parseFloat(candles[i3][LOW]);

  // Step 2：向前搜索 L2（low2 < low3，且在 L3 之前）
  for (let j = l3Pos - 1; j >= 1; j--) {
    const i2 = idxs[j],
      low2 = parseFloat(candles[i2][LOW]);
    if (low2 >= low3) continue; // 需要 L2 < L3

    // Step 3：向前搜索 L1（low1 < low2，且满足前20天最低价条件）
    for (let m = j - 1; m >= 0; m--) {
      const i1 = idxs[m],
        low1 = parseFloat(candles[i1][LOW]);
      if (low1 >= low2) continue; // 需要 L1 < L2

      // L1 是其前 20 根 K 线的最低价（前20根中无更低价格）
      const preStart = Math.max(0, i1 - 20);
      const preCandles = candles.slice(preStart, i1);
      if (!preCandles.length) continue;
      const preMin = Math.min(...preCandles.map(c => parseFloat(c[LOW])));
      if (preMin < low1) continue; // 前20天存在更低价，L1 不是真正的底部

      return {
        l1: {
          idx: i1,
          lowPrice: low1,
          date: new Date(Number(candles[i1][0])).toISOString().slice(0, 10),
        },
        l2: {
          idx: i2,
          lowPrice: low2,
          date: new Date(Number(candles[i2][0])).toISOString().slice(0, 10),
        },
        l3: {
          idx: i3,
          lowPrice: low3,
          date: new Date(Number(candles[i3][0])).toISOString().slice(0, 10),
        },
      };
    }
  }

  return null;
}

/** 纯布尔筛选函数 */
export function higherLows(candles) {
  return getHigherLowsResult(candles) !== null;
}
