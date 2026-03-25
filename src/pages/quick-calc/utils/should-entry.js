import { findAllSupportResistanceLevels } from './support-resistance';
import { getFutureTicker } from '../../../container/bitget/api';
import { isBullishEntrySignal, isBearishEntrySignal } from './kline-pattern';

/**
 * 判断价格是否接近某水平位 ±2%
 */
const isNearPrice = (low, high, levels) => {
  return levels.some(level => low <= level.price * 1.02 && high >= level.price * 0.98);
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

  // 检测价格是否进入支撑位 ±2%
  const _isNearSupport =
    isNearPrice(low24h, high24h, support) || isNearPrice(lowLastDay, highLastDay, support);

  if (!_isNearSupport) {
    return {
      shouldEntry: false,
      reason: '价格未进入支撑位',
      type: 'bullish',
    };
  }

  // 检查是否出现看涨K线信号
  const bullishSignal = isBullishEntrySignal([...klineData.slice(-2), lastKline]);

  if (!bullishSignal) {
    return {
      shouldEntry: false,
      reason: '未出现看涨K线信号',
      matchKeyPoint: true,
      type: 'bullish',
    };
  }

  return {
    shouldEntry: true,
    matchKeyPoint: true,
    signal: bullishSignal,
    keyLevels: { support },
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

  // 检测价格是否进入阻力位 ±2%
  const _isNearResistance =
    isNearPrice(low24h, high24h, resistance) || isNearPrice(lowLastDay, highLastDay, resistance);

  if (!_isNearResistance) {
    return {
      shouldEntry: false,
      reason: '价格未进入阻力位',
      type: 'bearish',
    };
  }

  // 检查是否出现看跌K线信号
  const bearishSignal = isBearishEntrySignal([...klineData.slice(-2), lastKline]);

  if (!bearishSignal) {
    return {
      shouldEntry: false,
      reason: '未出现看跌K线信号',
      matchKeyPoint: true,
      type: 'bearish',
    };
  }

  return {
    shouldEntry: true,
    matchKeyPoint: true,
    signal: bearishSignal,
    keyLevels: { resistance },
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
