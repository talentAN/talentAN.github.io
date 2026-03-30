import { getFutureKlineData } from '../../api';
import { PATTERN } from '@root/src/consts';
import moment from 'moment';

// 工具方法
// 获取基础聚合数据
export const parseKlineData = data => {
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

export const matchLongStable = ({ highPrice, lowPrice, avgVolume, latestPrice }) => {
  return highPrice <= lowPrice * 2 && avgVolume > 5000000 && latestPrice >= highPrice * 0.9;
};

export const matchRiseToFall = data => {
  // 入参，近90日的K线数据
  // - 选取前80日的最高价格A，作为阻力点或高点；
  // - 最近3天，任意一天的价格超过 A*0.95
  // - 最近3天，任意一天的成交量，超过前30天日均成交量的2倍以上；

  if (!data || data.length < 90) return false;

  // 前80日的最高价格A
  const first80Days = data.slice(0, 80);
  const resistancePrice = Math.max(...first80Days.map(k => parseFloat(k[2])));

  // 最近3天的数据
  const last3Days = data.slice(-3);

  // 检查最近3天是否有价格超过 A*0.95
  const hasPriceBreakout = last3Days.some(k => parseFloat(k[2]) >= resistancePrice * 0.95);
  if (!hasPriceBreakout) return false;

  // 前30天的日均成交量
  const prev30Days = data.slice(-33, -3);
  const avgVolume30Days =
    prev30Days.reduce((sum, k) => sum + parseFloat(k[6]), 0) / prev30Days.length;

  // 检查最近3天是否有成交量超过前30天日均的2倍
  const hasVolumeSpike = last3Days.some(k => parseFloat(k[6]) >= avgVolume30Days * 2);

  return hasPriceBreakout && hasVolumeSpike;
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
