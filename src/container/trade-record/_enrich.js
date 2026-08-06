import moment from 'moment';
import { getFutureKlineData as getBitgetKline } from '../bitget/api';
import { getFutureKlineData as getBinanceKline } from '../binance/api';
import { EXCHANGE } from './_schema';

const calculateBestPrice = async (symbol, timestamp, holdSide, exchange) => {
  try {
    const startTime = moment(timestamp).subtract(3, 'days').valueOf();
    const endTime = moment(timestamp).add(3, 'days').valueOf();
    const fetcher = exchange === EXCHANGE.BINANCE ? getBinanceKline : getBitgetKline;
    const klineData = await fetcher({
      symbol,
      granularity: '1D',
      limit: 7,
      startTime,
      endTime,
    });

    if (!klineData.data || klineData.data.length === 0) {
      return null;
    }

    const prices = klineData.data.map(item => ({
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
    }));

    if (holdSide === 'short') {
      return Math.max(...prices.map(p => p.high));
    }
    return Math.min(...prices.map(p => p.low));
  } catch (error) {
    console.error('计算最优价格失败:', error);
    return null;
  }
};

export const enrichRecordsWithBestPrices = async list => {
  return Promise.all(
    list.map(async record => {
      if (record.type === 'summery') return record;

      const exchange = record.exchange || EXCHANGE.BITGET;
      const openBestPrice = await calculateBestPrice(
        record.symbol,
        record.ctime * 1,
        record.holdSide,
        exchange
      );
      const closeBestPrice = await calculateBestPrice(
        record.symbol,
        record.utime * 1,
        record.holdSide === 'short' ? 'long' : 'short',
        exchange
      );

      return {
        ...record,
        openBestPrice3d: openBestPrice,
        openPriceDiff: openBestPrice
          ? Math.abs(
              (parseFloat(record.openAvgPrice) - openBestPrice) / parseFloat(record.openAvgPrice)
            ) * 100
          : null,
        closeBestPrice3d: closeBestPrice,
        closePriceDiff: closeBestPrice
          ? Math.abs(
              (parseFloat(record.closeAvgPrice) - closeBestPrice) / parseFloat(record.openAvgPrice)
            ) * 100
          : null,
      };
    })
  );
};
