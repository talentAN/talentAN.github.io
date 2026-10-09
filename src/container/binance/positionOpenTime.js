import { getUserTrades } from './api/query';

const LOOKBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_MS = 100 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
let requestQueue = Promise.resolve();

const enqueue = task => {
  const run = requestQueue.then(task, task);
  requestQueue = run.catch(() => undefined);
  return run;
};

const sideForPosition = positionSide =>
  String(positionSide || '').toUpperCase() === 'SHORT' ? 'SELL' : 'BUY';

const isOpeningTrade = (trade, positionSide) => {
  const side = String(trade.side || '').toUpperCase();
  const ps = String(trade.positionSide || '').toUpperCase();
  const normalizedPositionSide = String(positionSide || 'BOTH').toUpperCase();
  const expectedSide = sideForPosition(normalizedPositionSide);
  if (side !== expectedSide) return false;
  if (normalizedPositionSide !== 'BOTH' && ps !== normalizedPositionSide) return false;
  // Binance userTrades 的 buyer 表示账户是否为买方：多仓开仓是买入，空仓开仓是卖出。
  return normalizedPositionSide === 'SHORT' ? trade.buyer === false : trade.buyer !== false;
};

const findLatestOpeningTime = (trades, positionSide) => {
  const opening = trades
    .filter(trade => isOpeningTrade(trade, positionSide))
    .sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
  return Number(opening[0]?.time) || null;
};

export const getPositionOpenTime = async ({ symbol, positionSide = 'BOTH' }) => enqueue(async () => {
  const key = `${symbol}:${positionSide}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.openTime;

  const now = Date.now();
  let openTime = null;
  for (let end = now; end > now - MAX_LOOKBACK_MS && !openTime; end -= LOOKBACK_WINDOW_MS) {
    const start = Math.max(now - MAX_LOOKBACK_MS, end - LOOKBACK_WINDOW_MS + 1);
    const result = await getUserTrades({ symbol, startTime: start, endTime: end, limit: 1000 });
    const trades = Array.isArray(result?.response) ? result.response : [];
    openTime = findLatestOpeningTime(trades, positionSide);
    if (start <= now - MAX_LOOKBACK_MS) break;
  }
  cache.set(key, { checkedAt: Date.now(), openTime });
  return openTime;
});

export const clearPositionOpenTime = ({ symbol, positionSide = 'BOTH' }) =>
  cache.delete(`${symbol}:${positionSide}`);
