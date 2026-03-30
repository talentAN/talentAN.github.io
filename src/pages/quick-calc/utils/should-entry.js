import { findAllSupportResistanceLevels } from './support-resistance';
import { getFutureTicker } from '../../../container/bitget/api';
import { isBullishEntrySignal, isBearishEntrySignal } from './kline-pattern';

/**
 * 获取所有触发的水平位（可能有多个）±2%
 */
const getTriggeredLevels = (low, high, levels) => {
  if (!levels) return [];
  return levels.filter(level => low <= level.price * 1.02 && high >= level.price * 0.98);
};

/**
 * 对触发的关键位进行去重
 * 同一方法的多个关键位，只保留强度最高的那个
 * 不同方法的关键位都保留
 */
const deduplicateTriggeredLevels = levels => {
  const groupedByMethod = {};

  // 按方法分组
  levels.forEach(level => {
    const methods = level.methods || [];
    methods.forEach(method => {
      if (!groupedByMethod[method]) {
        groupedByMethod[method] = [];
      }
      groupedByMethod[method].push(level);
    });
  });

  // 每个方法组中只保留强度最高的
  const dedupedLevels = [];
  Object.keys(groupedByMethod).forEach(method => {
    const methodLevels = groupedByMethod[method];
    // 按强度排序，强度高的在前
    const strongest = methodLevels.sort((a, b) => b.strength - a.strength)[0];
    if (
      strongest &&
      !dedupedLevels.some(l => l.price === strongest.price && l.strength === strongest.strength)
    ) {
      dedupedLevels.push(strongest);
    }
  });

  return dedupedLevels;
};

/**
 * 检查 Bullish 入场条件
 * 条件：价格接近支撑位 + 出现看涨K线信号
 */
export const checkBullishEntry = async (symbol, klineData) => {
  const { support } = findAllSupportResistanceLevels(klineData);

  // 获取实时价格数据
  const ticker = await getFutureTicker(symbol);
  const { high24h, low24h } = ticker;
  const lastKline = klineData[klineData.length - 1];
  const [, , highLastDay, lowLastDay] = lastKline;

  // 获取所有触发的支撑位（可能有多个不同价格）
  let triggeredLevels = getTriggeredLevels(low24h, high24h, support);
  if (triggeredLevels.length === 0) {
    triggeredLevels = getTriggeredLevels(lowLastDay, highLastDay, support);
  }

  if (triggeredLevels.length === 0) {
    return {
      shouldEntry: false,
      reason: '价格未进入支撑位',
      type: 'bullish',
    };
  }

  // 同类型的关键位去重（同一识别方法只保留强度最高的）
  triggeredLevels = deduplicateTriggeredLevels(triggeredLevels);

  // 检查是否出现看涨K线信号
  const bullishSignal = isBullishEntrySignal([...klineData.slice(-2), lastKline]);

  if (!bullishSignal) {
    return {
      shouldEntry: false,
      reason: '未出现看涨K线信号',
      matchKeyPoint: true,
      type: 'bullish',
      triggeredLevels, // 记录所有触发的支撑位
    };
  }

  return {
    shouldEntry: true,
    matchKeyPoint: true,
    signal: bullishSignal,
    triggeredLevels, // 返回所有触发的支撑位
    type: 'bullish',
  };
};

/**
 * 检查 Bearish 入场条件
 * 条件：价格接近阻力位 + 出现看跌K线信号
 */
export const checkBearishEntry = async (symbol, klineData) => {
  const { resistance } = findAllSupportResistanceLevels(klineData);

  // 获取实时价格数据
  const ticker = await getFutureTicker(symbol);
  const { high24h, low24h } = ticker;
  const lastKline = klineData[klineData.length - 1];
  const [, , highLastDay, lowLastDay] = lastKline;

  // 检测价格是否进入阻力位 ±2%，并获取触发的具体阻力位
  let triggeredLevels = getTriggeredLevels(low24h, high24h, resistance);
  if (triggeredLevels.length === 0) {
    triggeredLevels = getTriggeredLevels(lowLastDay, highLastDay, resistance);
  }

  if (triggeredLevels.length === 0) {
    return {
      shouldEntry: false,
      reason: '价格未进入阻力位',
      type: 'bearish',
    };
  }

  // 同类型的关键位去重（同一识别方法只保留强度最高的）
  triggeredLevels = deduplicateTriggeredLevels(triggeredLevels);

  // 检查是否出现看跌K线信号
  const bearishSignal = isBearishEntrySignal([...klineData.slice(-2), lastKline]);

  if (!bearishSignal) {
    return {
      shouldEntry: false,
      reason: '未出现看跌K线信号',
      matchKeyPoint: true,
      type: 'bearish',
      triggeredLevels, // 记录所有触发的阻力位
    };
  }

  return {
    shouldEntry: true,
    matchKeyPoint: true,
    signal: bearishSignal,
    triggeredLevels, // 返回所有触发的阻力位
    type: 'bearish',
  };
};

/**
 * 综合判断是否应该入场（同时检查做多和做空条件）
 */
export const shouldEntry = async (symbol, klineData) => {
  const bullishResult = await checkBullishEntry(symbol, klineData);
  const bearishResult = await checkBearishEntry(symbol, klineData);

  // 任何一方满足条件即可入场
  if (bullishResult.shouldEntry || bearishResult.shouldEntry) {
    return {
      shouldEntry: true,
      bullish: bullishResult,
      bearish: bearishResult,
    };
  }

  return {
    shouldEntry: false,
    bullish: bullishResult,
    bearish: bearishResult,
  };
};
