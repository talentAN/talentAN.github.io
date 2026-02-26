import moment from 'moment';
import { getFutureKlineData } from '../../../container/bitget/api';

// 计算最优价格
const calculateBestPrice = async (symbol, timestamp, holdSide) => {
    try {
      const startTime = moment(timestamp).subtract(3, 'days').valueOf();
      const endTime = moment(timestamp).add(3, 'days').valueOf();
      
      const klineData = await getFutureKlineData({
        symbol,
        granularity: '1D',
        limit: 7,
        startTime,
        endTime
      });
      
      if (!klineData.data || klineData.data.length === 0) {
        return null;
      }
      
      // K线数据格式: [timestamp, open, high, low, close, volume, quoteVolume]
      const prices = klineData.data.map(item => ({
        high: parseFloat(item[2]),
        low: parseFloat(item[3])
      }));
      
      // 开空：最优开仓价 = 最高价；开多：最优开仓价 = 最低价
      if (holdSide === 'short') {
        return Math.max(...prices.map(p => p.high));
      } else {
        return Math.min(...prices.map(p => p.low));
      }
    } catch (error) {
      console.error('计算最优价格失败:', error);
      return null;
    }
  };

// 计算每条记录的最优价格和差值
export  const enrichRecordsWithBestPrices = async (list) => {
    return Promise.all(list.map(async (record) => {
      const openBestPrice = await calculateBestPrice(
        record.symbol,
        record.ctime * 1,
        record.holdSide
      );
      
      const closeBestPrice = await calculateBestPrice(
        record.symbol,
        record.utime * 1,
        record.holdSide === 'short' ? 'long' : 'short' // 平仓方向相反
      );
      
      return {
        ...record,
        openBestPrice3d: openBestPrice,
        openPriceDiff: openBestPrice ? Math.abs((parseFloat(record.openAvgPrice) - openBestPrice) / openBestPrice) * 100 : null,
        closeBestPrice3d: closeBestPrice,
        closePriceDiff: closeBestPrice ? Math.abs((parseFloat(record.closeAvgPrice) - closeBestPrice) / closeBestPrice) * 100 : null
      };
    }));
  };