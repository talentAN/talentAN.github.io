// K 线形态判断纯函数：日线收盘后判断，K 线为 [ts,o,h,l,c,...] 或 {open,high,low,close}

// 把值转成有限数字，否则返回 null
const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// 把日期/时间戳统一成 YYYY-MM-DD（UTC）
const toIsoDate = value => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return new Date(asNumber).toISOString().slice(0, 10);
    return null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? new Date(asNumber).toISOString().slice(0, 10) : null;
};

// 取出一根 K 线的开盘时间戳
const candleTs = candle => {
  if (Array.isArray(candle)) return Number(candle[0]);
  return Number(candle.ts ?? candle.timestamp ?? candle.openTime ?? candle.time);
};

// 把 K 线标准化成 {O,H,L,C}
export const normalizeKline = kline => {
  if (Array.isArray(kline)) {
    return { O: Number(kline[1]), H: Number(kline[2]), L: Number(kline[3]), C: Number(kline[4]) };
  }
  return {
    O: Number(kline.open ?? kline.O),
    H: Number(kline.high ?? kline.H),
    L: Number(kline.low ?? kline.L),
    C: Number(kline.close ?? kline.C),
  };
};

// 实体长度 |收盘-开盘|
export const getBodyLength = kline => {
  const { O, C } = normalizeKline(kline);
  return Math.abs(C - O);
};

// 全天振幅 最高-最低
export const getTotalAmplitude = kline => {
  const { H, L } = normalizeKline(kline);
  return H - L;
};

// 下影线长度 min(开,收)-最低
export const getLowerShadow = kline => {
  const { O, C, L } = normalizeKline(kline);
  return Math.min(O, C) - L;
};

// 上影线长度 最高-max(开,收)
export const getUpperShadow = kline => {
  const { O, C, H } = normalizeKline(kline);
  return H - Math.max(O, C);
};

// 是否阳线（收盘>开盘）
export const isBullish = kline => {
  const { O, C } = normalizeKline(kline);
  return C > O;
};

// 是否阴线（收盘<开盘）
export const isBearish = kline => {
  const { O, C } = normalizeKline(kline);
  return C < O;
};

// 是否十字星（实体 < 振幅的 5%）
export const isCrossStar = kline => {
  const bodyLength = getBodyLength(kline);
  const amplitude = getTotalAmplitude(kline);
  return amplitude > 0 && bodyLength < amplitude * 0.05;
};

// 是否小实体（实体 < 参考实体的 30%）
export const isSmallBody = (kline, referenceBodyLength) =>
  getBodyLength(kline) < referenceBodyLength * 0.3;

// 锤子线：收阳或十字，下影≥实体2倍，上影≤实体
export const isHammer = kline => {
  const bodyLength = getBodyLength(kline);
  const lowerShadow = getLowerShadow(kline);
  const upperShadow = getUpperShadow(kline);
  if (!(isBullish(kline) || isCrossStar(kline))) return false;
  if (lowerShadow < bodyLength * 2) return false;
  return upperShadow <= bodyLength;
};

// 看涨吞没：前阴后阳，当前实体完全覆盖前一根且更长
export const isBullishEngulfing = (prevKline, currKline) => {
  const prev = normalizeKline(prevKline);
  const curr = normalizeKline(currKline);
  if (!isBearish(prevKline) || !isBullish(currKline)) return false;
  if (!(curr.C > prev.O && curr.O < prev.C)) return false;
  return getBodyLength(currKline) > getBodyLength(prevKline);
};

// 早晨之星：阴线 → 下方小实体 → 阳线收盘进入前阴实体一半以上
export const isMorningStar = (k1, k2, k3) => {
  const kl1 = normalizeKline(k1);
  const kl2 = normalizeKline(k2);
  const kl3 = normalizeKline(k3);
  if (!isBearish(k1)) return false;
  const k1BodyLength = getBodyLength(k1);
  if (!isSmallBody(k2, k1BodyLength)) return false;
  if (Math.max(kl2.O, kl2.C) >= kl1.C) return false;
  if (!isBullish(k3)) return false;
  return kl3.C > (kl1.O + kl1.C) / 2;
};

// 射击之星：收阴或十字，上影≥实体2倍，下影≤实体
export const isShootingStar = kline => {
  const bodyLength = getBodyLength(kline);
  const upperShadow = getUpperShadow(kline);
  const lowerShadow = getLowerShadow(kline);
  if (!(isBearish(kline) || isCrossStar(kline))) return false;
  if (upperShadow < bodyLength * 2) return false;
  return lowerShadow <= bodyLength;
};

// 看跌吞没：前阳后阴，当前实体完全覆盖前一根且更长
export const isBearishEngulfing = (prevKline, currKline) => {
  const prev = normalizeKline(prevKline);
  const curr = normalizeKline(currKline);
  if (!isBullish(prevKline) || !isBearish(currKline)) return false;
  if (!(curr.O > prev.C && curr.C < prev.O)) return false;
  return getBodyLength(currKline) > getBodyLength(prevKline);
};

// 黄昏之星：阳线 → 上方小实体 → 阴线收盘深入前阳实体一半以下
export const isEveningStar = (k1, k2, k3) => {
  const kl1 = normalizeKline(k1);
  const kl2 = normalizeKline(k2);
  const kl3 = normalizeKline(k3);
  if (!isBullish(k1)) return false;
  const k1BodyLength = getBodyLength(k1);
  if (!isSmallBody(k2, k1BodyLength)) return false;
  if (Math.min(kl2.O, kl2.C) <= kl1.C) return false;
  if (!isBearish(k3)) return false;
  return kl3.C < (kl1.O + kl1.C) / 2;
};

// 单根 K 是否构成做多确认（目前只认锤子线）
export const isBullishConfirm = kline => {
  if (isHammer(kline)) return { pattern: '锤子线', confidence: 1, type: 'hammer' };
  return null;
};

// 从最近 1～3 根 K 里找做多确认形态（晨星 / 看涨吞没 / 锤子）
export const isBullishEntrySignal = (klines, depth = 3) => {
  if (!klines || klines.length === 0) return null;
  if (depth >= 3 && klines.length >= 3) {
    const lastThree = klines.slice(-3);
    if (isMorningStar(lastThree[0], lastThree[1], lastThree[2])) {
      return { pattern: '早晨之星', confidence: 0.95, type: 'morningStar' };
    }
  }
  if (depth >= 2 && klines.length >= 2) {
    const lastTwo = klines.slice(-2);
    if (isBullishEngulfing(lastTwo[0], lastTwo[1])) {
      return { pattern: '看涨吞没', confidence: 0.9, type: 'bullishEngulfing' };
    }
  }
  return isBullishConfirm(klines[klines.length - 1]);
};

// 从最近 1～3 根 K 里找做空确认形态（黄昏之星 / 看跌吞没 / 射击之星）
export const isBearishEntrySignal = (klines, depth = 3) => {
  if (!klines || klines.length === 0) return null;
  if (depth >= 3 && klines.length >= 3) {
    const lastThree = klines.slice(-3);
    if (isEveningStar(lastThree[0], lastThree[1], lastThree[2])) {
      return { pattern: '黄昏之星', confidence: 0.95, type: 'eveningStar' };
    }
  }
  if (depth >= 2 && klines.length >= 2) {
    const lastTwo = klines.slice(-2);
    if (isBearishEngulfing(lastTwo[0], lastTwo[1])) {
      return { pattern: '看跌吞没', confidence: 0.9, type: 'bearishEngulfing' };
    }
  }
  if (isShootingStar(klines[klines.length - 1])) {
    return { pattern: '射击之星', confidence: 1, type: 'shootingStar' };
  }
  return null;
};

// 同时返回最近 K 线的做多、做空确认信号
export const getEntrySignals = klines => ({
  bullish: isBullishEntrySignal(klines, 3),
  bearish: isBearishEntrySignal(klines, 3),
});

// 指定日最高价是否严格高于该日之前全部 K 线的历史最高价
export const isBreakoutHistoricalHigh = (date, candles) => {
  const empty = { found: false, isBreakout: false, dateHigh: null, prevAth: null, prevAthDate: null };
  const target = toIsoDate(date);
  if (!target) return empty;

  const sorted = [...(candles || [])]
    .filter(c => c != null && Number.isFinite(candleTs(c)))
    .sort((a, b) => candleTs(a) - candleTs(b));

  const index = sorted.findIndex(c => toIsoDate(candleTs(c)) === target);
  if (index < 0) return empty;

  const dateHigh = finite(normalizeKline(sorted[index]).H);
  if (dateHigh == null || index === 0) {
    return { found: true, isBreakout: false, dateHigh, prevAth: null, prevAthDate: null };
  }

  let prevAth = null;
  let prevAthDate = null;
  for (let i = 0; i < index; i++) {
    const high = finite(normalizeKline(sorted[i]).H);
    if (high == null) continue;
    if (prevAth == null || high > prevAth) {
      prevAth = high;
      prevAthDate = toIsoDate(candleTs(sorted[i]));
    }
  }

  return {
    found: true,
    isBreakout: prevAth != null && dateHigh > prevAth,
    dateHigh,
    prevAth,
    prevAthDate,
  };
};

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
  isBullishEntrySignal,
  isBearishEntrySignal,
  getEntrySignals,
  isBreakoutHistoricalHigh,
};

export default KlinePatternUtils;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KlinePatternUtils;
}
