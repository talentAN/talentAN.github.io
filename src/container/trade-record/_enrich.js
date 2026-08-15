import moment from 'moment';
import { getFutureKlineData as getBitgetKline } from '../bitget/api';
import { getFutureKlineData as getBinanceKline } from '../binance/api';
import { EXCHANGE, resolveExchange } from './_schema';

const isMissing = v => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

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

const withBestPrices = async record => {
  const exchange = resolveExchange(record);
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
    exchange,
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
};

/** 全量补最优价（远程新仓位用） */
export const enrichRecordsWithBestPrices = async list => {
  return Promise.all(
    list.map(async record => {
      if (record.type === 'summery') return record;
      return withBestPrices(record);
    })
  );
};

/**
 * 仅补缺：开仓最优价 / 开仓最优差为空（或异常占位 -100）时，按记录来源交易所拉 K 线计算
 */
export async function fillMissingBestPrices(list, opts = {}) {
  const { onProgress } = opts;
  const out = [];

  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    if (record.type === 'summery' || record.ignore) {
      out.push(record);
      continue;
    }

    const diffMissing = isMissing(record.openPriceDiff);
    const diffBogus = Number(record.openPriceDiff) === -100;
    const bestMissing = isMissing(record.openBestPrice3d);
    const needsOpen = diffMissing || diffBogus || bestMissing;

    if (!needsOpen) {
      out.push({ ...record, exchange: resolveExchange(record) });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const filled = await withBestPrices(record);
      out.push({
        ...record,
        exchange: filled.exchange,
        openBestPrice3d: bestMissing || diffBogus ? filled.openBestPrice3d : record.openBestPrice3d,
        openPriceDiff: diffMissing || diffBogus ? filled.openPriceDiff : record.openPriceDiff,
        closeBestPrice3d: isMissing(record.closeBestPrice3d)
          ? filled.closeBestPrice3d
          : record.closeBestPrice3d,
        closePriceDiff: isMissing(record.closePriceDiff)
          ? filled.closePriceDiff
          : record.closePriceDiff,
      });
      onProgress?.({
        index: i,
        total: list.length,
        symbol: record.symbol,
        openPriceDiff: filled.openPriceDiff,
      });
    } catch (e) {
      console.warn(`开仓最优差补全失败 ${record.symbol} ${record.positionId}`, e);
      out.push({ ...record, exchange: resolveExchange(record) });
      onProgress?.({ index: i, total: list.length, symbol: record.symbol, error: e });
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  return out;
}
