import { getFutureKlineData } from './api/index';
import { waitBinanceBanIfNeeded, getBinanceBanRemaining } from '../market/_fetchGate';

const cache = new Map();
const TTL_MS = 60 * 1000;
let requestQueue = Promise.resolve();

const enqueue = task => {
  const run = requestQueue.then(task, task);
  requestQueue = run.catch(() => undefined);
  return run;
};

const keyOf = ({ symbol, openTime, side }) => `${symbol}:${openTime}:${side}`;

export const getPositionExtreme = async params =>
  enqueue(async () => {
    const { symbol, openTime, side, livePrice } = params;
    const key = keyOf({ symbol, openTime, side });
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.fetchedAt < TTL_MS) {
      const extreme =
        side === '多'
          ? Math.max(cached.extreme, Number(livePrice) || 0)
          : Math.min(cached.extreme, Number(livePrice) || cached.extreme);
      cached.extreme = extreme;
      return extreme;
    }
    if (!(openTime > 0)) return null;
    await waitBinanceBanIfNeeded(getBinanceBanRemaining);
    // getFutureKlineData 内部已门闩+退避
    const result = await getFutureKlineData({
      symbol,
      granularity: '1H',
      startTime: openTime,
      endTime: now,
      limit: 1000,
    });
    const candles = Array.isArray(result?.data) ? result.data : [];
    const extreme = candles.reduce((value, candle) => {
      const price = Number(side === '多' ? candle[2] : candle[3]);
      if (!(price > 0)) return value;
      return value == null ? price : side === '多' ? Math.max(value, price) : Math.min(value, price);
    }, null);
    if (extreme == null) return null;
    const next =
      side === '多'
        ? Math.max(extreme, Number(livePrice) || 0)
        : Math.min(extreme, Number(livePrice) || extreme);
    cache.set(key, { fetchedAt: now, extreme: next });
    return next;
  });

export const clearPositionExtremeCache = () => {
  cache.clear();
};
