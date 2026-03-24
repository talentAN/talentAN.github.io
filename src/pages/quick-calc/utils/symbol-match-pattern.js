import { getFutureKlineData } from '../../../container/bitget/api';
import { PATTERN } from '@trade/constant';
import moment from 'moment';

// 工具方法
// 获取基础聚合数据
const parseKlineData = data => {
  // 获取基础模式检测的基础数据
  const highPrice = Math.max(...data.map(k => parseFloat(k[2])));
  const lowPrice = Math.min(...data.map(k => parseFloat(k[3])));
  const latestPrice = parseFloat(data[data.length - 1][4]); // 最新收盘价
  // 计算日均成交额
  const avgVolume = data.reduce((sum, k) => sum + parseFloat(k[6]), 0) / data.length;

  return {
    highPrice,
    lowPrice,
    latestPrice,
    avgVolume,
  };
};

const matchLongStable = ({ highPrice, lowPrice, avgVolume, latestPrice }) => {
  return highPrice <= lowPrice * 2 && avgVolume > 5000000 && latestPrice >= highPrice * 0.9;
};

// 输入币对 => 输出命中的模式
export const symbolMatchPattern = async symbol => {
  const symbolUpper = symbol.trim().toUpperCase();

  // 获取60天K线数据
  const endTime = moment().valueOf();
  const startTime = moment().subtract(60, 'days').valueOf();

  const klineData = await getFutureKlineData({
    symbol: symbolUpper,
    granularity: '1D',
    limit: 60,
    startTime,
    endTime,
  });

  if (!klineData.data || klineData.data.length === 0) {
    throw new Error('获取K线数据失败');
  }

  // 获取基础模式检测的基础数据
  const { highPrice, lowPrice, latestPrice, avgVolume } = parseKlineData(klineData.data);

  const matched = [];

  // 检测模式1: 长期极度稳定横盘
  if (matchLongStable({ highPrice, lowPrice, avgVolume, latestPrice })) {
    matched.push(PATTERN.LONG_STABLE);
  }

  return matched;
};
