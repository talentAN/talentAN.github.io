/**
 * K线形态确认模块 —— 三、确认K线的精确定义
 *
 * 以下所有定义基于**日线K线收盘后**判断
 * K线格式: {open, high, low, close} 或 [open, high, low, close]
 * 记号: O=开盘价、H=最高价、L=最低价、C=收盘价
 */

// ============ 辅助函数 ============

/**
 * 标准化K线数据
 */
function normalizeKline(kline) {
  if (Array.isArray(kline)) {
    return { O: kline[1], H: kline[2], L: kline[3], C: kline[4] };
  }
  return { O: kline.open, H: kline.high, L: kline.low, C: kline.close };
}

/**
 * 计算实体长度 |C - O|
 */
function getBodyLength(kline) {
  const { O, C } = normalizeKline(kline);
  return Math.abs(C - O);
}

/**
 * 计算总振幅 H - L
 */
function getTotalAmplitude(kline) {
  const { H, L } = normalizeKline(kline);
  return H - L;
}

/**
 * 计算下影线 min(O,C) - L
 */
function getLowerShadow(kline) {
  const { O, C, L } = normalizeKline(kline);
  return Math.min(O, C) - L;
}

/**
 * 计算上影线 H - max(O,C)
 */
function getUpperShadow(kline) {
  const { O, C, H } = normalizeKline(kline);
  return H - Math.max(O, C);
}

/**
 * 判断是否为阳线 C > O
 */
function isBullish(kline) {
  const { O, C } = normalizeKline(kline);
  return C > O;
}

/**
 * 判断是否为阴线 C < O
 */
function isBearish(kline) {
  const { O, C } = normalizeKline(kline);
  return C < O;
}

/**
 * 判断是否为十字星 |C-O| < 总振幅的5%
 */
function isCrossStar(kline) {
  const bodyLength = getBodyLength(kline);
  const amplitude = getTotalAmplitude(kline);
  return bodyLength < amplitude * 0.05;
}

/**
 * 判断是否为小实体 实体 < 参考实体的30%
 */
function isSmallBody(kline, referenceBodyLength) {
  return getBodyLength(kline) < referenceBodyLength * 0.3;
}

// ============ 做多确认K线形态 ============

/**
 * ① 锤子线
 * 条件（全部满足）：
 *   1. C > O（收阳线）或 C ≈ O（十字星，|C-O| < 总振幅的5%）
 *   2. 下影线长度 ≥ 实体长度的 2 倍
 *   3. 上影线 ≤ 实体长度
 */
function isHammer(kline) {
  const bodyLength = getBodyLength(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);

  // 条件1: 收阳线或十字
  const isBullishOrCross = isBullish(kline) || isCrossStar(kline);
  if (!isBullishOrCross) return false;

  // 条件2: 下影线 >= 实体长度的2倍
  const hasLongLowerShadow = lowerShadow >= bodyLength * 2;
  if (!hasLongLowerShadow) return false;

  // 条件3: 上影线 <= 实体长度
  return upperShadow <= bodyLength;
}

/**
 * ② 看涨吞没
 * 条件（全部满足）：
 *   1. 前一根K线是阴线：前C < 前O
 *   2. 当前K线是阳线：C > O
 *   3. 当前K线的实体完全覆盖前一根的实体：C > 前O 且 O < 前C
 *   4. 当前K线实体长度 > 前一根实体长度
 */
function isBullishEngulfing(prevKline, currKline) {
  const prev = normalizeKline(prevKline);
  const curr = normalizeKline(currKline);

  // 条件1: 前一根是阴线
  if (!isBearish(prevKline)) return false;

  // 条件2: 当前是阳线
  if (!isBullish(currKline)) return false;

  // 条件3: 当前实体完全覆盖前一根
  const bodyCovers = curr.C > prev.O && curr.O < prev.C;
  if (!bodyCovers) return false;

  // 条件4: 当前实体长度 > 前一根实体长度
  const currBodyLength = getBodyLength(currKline);
  const prevBodyLength = getBodyLength(prevKline);
  return currBodyLength > prevBodyLength;
}

/**
 * ③ 早晨之星
 * 条件（需要看最近3根K线，按时间顺序为 K1、K2、K3）：
 *   1. K1 是阴线：K1.C < K1.O
 *   2. K2 是小实体：|K2.C - K2.O| < K1 实体长度的 30%
 *   3. K2 的实体位于 K1 实体下方：max(K2.O, K2.C) < K1.C
 *   4. K3 是阳线：K3.C > K3.O
 *   5. K3 收盘价至少进入 K1 实体的 50% 以上：K3.C > (K1.O + K1.C) / 2
 */
function isMorningStar(k1, k2, k3) {
  const kl1 = normalizeKline(k1);
  const kl2 = normalizeKline(k2);
  const kl3 = normalizeKline(k3);

  // 条件1: K1是阴线
  if (!isBearish(k1)) return false;

  // 条件2: K2是小实体（< K1实体的30%）
  const k1BodyLength = getBodyLength(k1);
  if (!isSmallBody(k2, k1BodyLength)) return false;

  // 条件3: K2实体位于K1实体下方
  const k2TopOfBody = Math.max(kl2.O, kl2.C);
  if (k2TopOfBody >= kl1.C) return false;

  // 条件4: K3是阳线
  if (!isBullish(k3)) return false;

  // 条件5: K3收盘价至少进入K1实体的50%以上
  const k1BodyMidpoint = (kl1.O + kl1.C) / 2;
  return kl3.C > k1BodyMidpoint;
}

// ============ 做空确认K线形态 ============

/**
 * ① 射击之星（锤子线的镜像）
 * 条件（全部满足）：
 *   1. C < O（收阴线）或 |C-O| < 总振幅的5%（十字星）
 *   2. 上影线 ≥ 实体的 2 倍：(H - max(O,C)) ≥ 2 × |C - O|
 *   3. 下影线 ≤ 实体：(min(O,C) - L) ≤ |C - O|
 */
function isShootingStar(kline) {
  const bodyLength = getBodyLength(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);

  // 条件1: 收阴线或十字
  const isBearishOrCross = isBearish(kline) || isCrossStar(kline);
  if (!isBearishOrCross) return false;

  // 条件2: 上影线 >= 实体长度的2倍
  const hasLongUpperShadow = upperShadow >= bodyLength * 2;
  if (!hasLongUpperShadow) return false;

  // 条件3: 下影线 <= 实体长度
  return lowerShadow <= bodyLength;
}

/**
 * ② 看跌吞没
 * 条件（全部满足）：
 *   1. 前一根是阳线：前C > 前O
 *   2. 当前是阴线：C < O
 *   3. O > 前C 且 C < 前O（当前实体完全覆盖前一根）
 *   4. |C - O| > |前C - 前O|
 */
function isBearishEngulfing(prevKline, currKline) {
  const prev = normalizeKline(prevKline);
  const curr = normalizeKline(currKline);

  // 条件1: 前一根是阳线
  if (!isBullish(prevKline)) return false;

  // 条件2: 当前是阴线
  if (!isBearish(currKline)) return false;

  // 条件3: 当前实体完全覆盖前一根
  const bodyCovers = curr.O > prev.C && curr.C < prev.O;
  if (!bodyCovers) return false;

  // 条件4: 当前实体长度 > 前一根实体长度
  const currBodyLength = getBodyLength(currKline);
  const prevBodyLength = getBodyLength(prevKline);
  return currBodyLength > prevBodyLength;
}

/**
 * ③ 黄昏之星（早晨之星的镜像）
 * K1阳线 → K2小实体(在K1上方) → K3阴线(收盘深入K1实体50%以下)
 */
function isEveningStar(k1, k2, k3) {
  const kl1 = normalizeKline(k1);
  const kl2 = normalizeKline(k2);
  const kl3 = normalizeKline(k3);

  // 条件1: K1是阳线
  if (!isBullish(k1)) return false;

  // 条件2: K2是小实体（< K1实体的30%）
  const k1BodyLength = getBodyLength(k1);
  if (!isSmallBody(k2, k1BodyLength)) return false;

  // 条件3: K2实体位于K1实体上方
  const k2BottomOfBody = Math.min(kl2.O, kl2.C);
  if (k2BottomOfBody <= kl1.C) return false;

  // 条件4: K3是阴线
  if (!isBearish(k3)) return false;

  // 条件5: K3收盘价深入K1实体50%以下
  const k1BodyMidpoint = (kl1.O + kl1.C) / 2;
  return kl3.C < k1BodyMidpoint;
}

// ============ 综合判断函数 ============

/**
 * 判断单根K线是否为做多确认K线
 */
function isBullishConfirm(kline) {
  if (isHammer(kline)) {
    return { pattern: '锤子线', confidence: 1, type: 'hammer' };
  }
  return null;
}

/**
 * 判断是否为做多确认形态（单根或多根K线）
 * @param {Array} klines - K线数据数组
 * @param {number} depth - 使用多少根K线判断（1/2/3）
 */
function isBullishEntrySignal(klines, depth = 3) {
  if (!klines || klines.length === 0) return null;

  // 三根K线判断（优先级最高，信号最强）
  if (depth >= 3 && klines.length >= 3) {
    const lastThree = klines.slice(-3);
    if (isMorningStar(lastThree[0], lastThree[1], lastThree[2])) {
      return { pattern: '早晨之星', confidence: 0.95, type: 'morningStar' };
    }
  }

  // 两根K线判断
  if (depth >= 2 && klines.length >= 2) {
    const lastTwo = klines.slice(-2);
    if (isBullishEngulfing(lastTwo[0], lastTwo[1])) {
      return { pattern: '看涨吞没', confidence: 0.9, type: 'bullishEngulfing' };
    }
  }

  // 单根K线判断（最后的后备）
  return isBullishConfirm(klines[klines.length - 1]);
}

/**
 * 判断是否为做空确认形态（单根或多根K线）
 * @param {Array} klines - K线数据数组
 * @param {number} depth - 使用多少根K线判断（1/2/3）
 */
function isBearishEntrySignal(klines, depth = 3) {
  if (!klines || klines.length === 0) return null;

  // 三根K线判断
  if (depth >= 3 && klines.length >= 3) {
    const lastThree = klines.slice(-3);
    if (isEveningStar(lastThree[0], lastThree[1], lastThree[2])) {
      return { pattern: '黄昏之星', confidence: 0.95, type: 'eveningStar' };
    }
  }

  // 两根K线判断
  if (depth >= 2 && klines.length >= 2) {
    const lastTwo = klines.slice(-2);
    if (isBearishEngulfing(lastTwo[0], lastTwo[1])) {
      return { pattern: '看跌吞没', confidence: 0.9, type: 'bearishEngulfing' };
    }
  }

  // 单根K线判断
  if (isShootingStar(klines[klines.length - 1])) {
    return { pattern: '射击之星', confidence: 1, type: 'shootingStar' };
  }

  return null;
}

/**
 * 获取完整的进场信号分析
 */
function getEntrySignals(klines) {
  return {
    bullish: isBullishEntrySignal(klines, 3),
    bearish: isBearishEntrySignal(klines, 3),
  };
}

// ============ 导出所有工具函数（用于测试） ============

const KlinePatternUtils = {
  normalizeKline,
  getBodyLength,
  getTotalAmplitude,
  getLowerShadow,
  getUpperShadow,
  isBullish,
  isBearish,
  isCrossStar,
  isSmallBody,
  isHammer,
  isBullishEngulfing,
  isMorningStar,
  isShootingStar,
  isBearishEngulfing,
  isEveningStar,
  isBullishConfirm,
  getEntrySignals,
};

// export default KlinePatternUtils; // 注释掉不必要的 ES6 export

// ============ CommonJS 导出（用于 Node.js 脚本） ============
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeKline,
    getBodyLength,
    getTotalAmplitude,
    getLowerShadow,
    getUpperShadow,
    isBullish,
    isBearish,
    isCrossStar,
    isSmallBody,
    isHammer,
    isBullishEngulfing,
    isMorningStar,
    isShootingStar,
    isBearishEngulfing,
    isEveningStar,
    isBullishConfirm,
    isBullishEntrySignal,
    isBearishEntrySignal,
    getEntrySignals,
    KlinePatternUtils,
  };
}
