import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import { getPositionMode as getBinancePositionMode } from '@root/src/container/binance/api/query';
import {
  getBinanceAccountSnapshot,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import {
  placeFutureClosePositionAlgo,
  placeFutureQtyStopAlgo,
  placeFutureQtyTakeProfitAlgo,
  placeFutureTrailingStopAlgo,
  cancelFutureAlgoOrder,
  cancelFutureOrder,
} from '@root/src/container/binance/api/order';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { isBlacklistedSymbol } from '../_symbolBlacklist';
import { isLiveOrderEnabled, quantizeQuantity } from '../system_1/_autoOrderModel';
import { waitBinanceBanIfNeeded, withMarketFetchGate } from '../_marketFetchGate';
import {
  findMonitorActiveRanges,
  findMonitorCandidateRanges,
  getMonitorBreakAboveHigh,
  calcDistBelowRangeHighPct,
  normalizeNearBandPct,
  RANGE_MONITOR_MAX_MULT,
  RANGE_MONITOR_NEAR_BAND_PCT,
  RANGE_MONITOR_STRICT,
  MONITOR_OPEN_NOTIONAL_MULT,
  MONITOR_MAX_MIN_OPEN_USDT,
} from './_rangeScan';
import { utcDayKey } from './_rangeMonitorCandleCache';
import {
  ensureRangeMonitorCandleCache,
  getCachedMonitorCandles,
  fetchAndCacheMonitorCandles,
  listCachedMonitorPairs,
  syncCandleCacheTodayFromFeed,
} from './_rangeMonitorCandleCache';
import {
  cancelLongOpenOrders,
  fetchLiveOrderStatusMaps,
  listLiveLongOpenOrders,
  placeBreakoutTriggerOrder,
  getRecentBreakoutOrder,
  resolveMinOpenNotionalUsdt,
} from './_breakoutOrder';
import { getContracts as getBinanceContracts } from '@root/src/container/binance/api';
import { getPositionOpenTime } from '@root/src/container/binance/positionOpenTime';
import { RangeMonitorFatal, getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';
import {
  RANGE_MONITOR_SCAN_ENABLED,
  RANGE_MONITOR_SL_ARM_MULT,
  RANGE_MONITOR_TRAIL_ARM_MULT,
  RANGE_MONITOR_TP_MULTS,
  RANGE_MONITOR_TP_CLOSE_PCT,
  RANGE_MONITOR_TRAIL_CALLBACK_PCT,
  RANGE_MONITOR_MAX_ORDERS,
  RANGE_MONITOR_ROUND_IDLE_MS,
  RANGE_MONITOR_SCAN_GAP_MS,
  RANGE_MONITOR_CACHED_SCAN_YIELD_EVERY,
  RANGE_MONITOR_PLACE_GAP_MS,
  RANGE_MONITOR_XX_KLINE_RETRY,
  RANGE_MONITOR_XX_HOUR_MS,
  RANGE_MONITOR_XX_KLINE_CACHE_TTL_MS,
  RANGE_MONITOR_XX_HOUR_LIMIT,
  RANGE_MONITOR_STORAGE_KEYS,
} from './_rangeMonitorParams';

export {
  RangeMonitorFatal,
  getSharedMiniTickerFeed,
  BinanceMiniTickerFeed,
  BinanceBookTickerFeed,
} from './_rangeMonitorPriceFeed';

/** 横盘监控只做 Binance */
const MONITOR_EXCHANGES = ['binance'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pairIdOf = ({ exchange, symbol }) => `${exchange}:${symbol}`;
const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));
const finite = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 已缓存日 K 扫描时直接让出事件循环，不再复制参数名。 */
export { RANGE_MONITOR_ROUND_IDLE_MS };

/** 已破上沿提示：同币同 UTC 日只推一次，避免每轮刷屏 */
const brokeTipSeen = new Set();
let brokeTipDay = '';
const shouldTipBrokeOnce = symbol => {
  const day = utcDayKey();
  if (day !== brokeTipDay) {
    brokeTipDay = day;
    brokeTipSeen.clear();
  }
  const key = String(symbol || '').toUpperCase();
  if (!key || brokeTipSeen.has(key)) return false;
  brokeTipSeen.add(key);
  return true;
};

const pickErr = result =>
  result?.error ||
  result?.response?.msg ||
  result?.response?.message ||
  result?.response?.data?.[0]?.msg ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

const normalizeMaxRangeMult = value => {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1) return n;
  return RANGE_MONITOR_MAX_MULT;
};

const requirePositive = (value, label) => {
  const n = Number(value);
  if (!(n > 0)) {
    throw new RangeMonitorFatal(`参数无效：${label}`, `期望正数，实际=${value}`);
  }
  return n;
};

const isWouldImmediatelyTrigger = result => {
  const resp = result?.result?.response ?? result?.response;
  const code = Number(resp?.code);
  const msg = String(resp?.msg || result?.detail || '');
  return code === -2021 || /immediately trigger/i.test(msg);
};

const isMaxStopOrderLimit = result => {
  const resp = result?.result?.response ?? result?.response;
  const code = Number(resp?.code);
  const msg = String(resp?.msg || result?.detail || '');
  return code === -4045 || /max stop order limit/i.test(msg);
};

/** 账户级 / 上限类 → 中止本轮后续开仓 */
const isAccountLevelOpenFail = result => {
  if (isMaxStopOrderLimit(result)) return true;
  const resp = result?.result?.response ?? result?.response;
  const code = Number(resp?.code);
  const msg = String(resp?.msg || result?.detail || '');
  if (code === -2015 || code === -1022 || code === -2014) return true;
  if (/api.?key|permission|unauthorized|invalid.?signature|banned|too many requests|-1015/i.test(msg)) {
    return true;
  }
  return false;
};

const resolveMonitorCandles = async (pair, priceFeed) => {
  const feed = priceFeed || getSharedMiniTickerFeed();
  let candles = getCachedMonitorCandles(pair.symbol, feed);
  if (Array.isArray(candles) && candles.length) return candles;
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);
  candles = await fetchAndCacheMonitorCandles(pair, feed);
  return candles;
};

const isStillInMonitorRange = async (pair, maxRangeMult, priceFeed) => {
  const candles = await resolveMonitorCandles(pair, priceFeed);
  if (!Array.isArray(candles) || !candles.length) {
    throw new RangeMonitorFatal(`${pair.symbol} 历史 K 线为空`, '清理/扫描无法重算高低比');
  }
  const hits = findMonitorActiveRanges(candles, pair, maxRangeMult);
  return { inRange: hits.length > 0, hits, candles };
};

/** 判断 Binance 条件单是否为多仓 SELL 止损单（排除止盈、追踪和空仓方向）。 */
const isBinanceStopAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const type = String(o?.type || o?.orderType || '').toUpperCase();
  if (!type.includes('STOP') || type.includes('TAKE_PROFIT') || type.includes('TRAILING')) return false;
  return String(o?.positionSide || '').toUpperCase() !== (positionSide === 'SHORT' ? 'LONG' : 'SHORT');
};

/** 判断止损单触发价是否等于开仓价，用于识别成本价全仓止损。 */
const isBreakevenStopAlgo = (o, entry, tickSize, positionSide = 'LONG') =>
  isBinanceStopAlgo(o, positionSide) && pricesMatchTier(algoTriggerPrice(o), entry, tickSize);

/** 逐笔撤销指定币对的成本价止损条件单，缺少订单 ID 的记录直接跳过。 */
const cancelBreakevenStops = async (symbol, orders) => {
  for (const order of orders) {
    const algoId = order.algoId ?? order.orderId;
    const clientAlgoId = order.clientAlgoId || order.clientOrderId;
    if (algoId == null && !clientAlgoId) continue;
    await cancelFutureAlgoOrder({
      symbol,
      ...(algoId != null ? { algoId } : {}),
      ...(clientAlgoId ? { clientAlgoId } : {}),
    });
    await sleep(80);
  }
};

const isBinanceTakeProfitAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const blob = `${o?.type || ''} ${o?.orderType || ''} ${o?.origType || ''} ${o?.algoType || ''}`.toUpperCase();
  return blob.includes('TAKE_PROFIT') && !blob.includes('TRAILING');
};

const isBinanceTrailingAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const blob = `${o?.type || ''} ${o?.orderType || ''} ${o?.origType || ''} ${o?.algoType || ''}`.toUpperCase();
  return blob.includes('TRAILING');
};

/** 从条件单记录中提取触发价、止损价或追踪激活价。 */
const algoTriggerPrice = o =>
  finite(o?.triggerPrice) ?? finite(o?.stopPrice) ?? finite(o?.activatePrice) ?? null;

let binanceContractsPromise = null;
let binanceRulesCache = new Map();
let binancePositionModePromise = null;
const getBinancePositionModeCached = () => {
  if (!binancePositionModePromise) binancePositionModePromise = getBinancePositionMode();
  return binancePositionModePromise;
};
const getBinanceRules = async symbol => {
  if (binanceRulesCache.has(symbol)) return binanceRulesCache.get(symbol);
  const rulesPromise = (async () => {
    if (!binanceContractsPromise) binanceContractsPromise = getBinanceContracts();
    const contracts = await binanceContractsPromise;
    if (!Array.isArray(contracts) || !contracts.length) {
      throw new RangeMonitorFatal('币安合约配置列表为空', 'getContracts');
    }
    const contract = contracts.find(c => c.symbol === symbol);
  if (!contract) {
    throw new RangeMonitorFatal(`${symbol} 不在合约配置中`, '无法取 tick/step');
  }
  const filters = Array.isArray(contract.filters) ? contract.filters : [];
  const findFilter = (...types) => filters.find(f => types.includes(f.filterType));
  const priceFilter = findFilter('PRICE_FILTER');
  const lotFilter = findFilter('LOT_SIZE');
  const marketLotFilter = findFilter('MARKET_LOT_SIZE') || lotFilter;
  const tickSize = Number(priceFilter?.tickSize);
  const stepSize = Number(lotFilter?.stepSize) || Number(marketLotFilter?.stepSize);
  if (!(tickSize > 0)) {
    throw new RangeMonitorFatal(`${symbol} tickSize 无效`, String(priceFilter?.tickSize));
  }
  if (!(stepSize > 0)) {
    throw new RangeMonitorFatal(`${symbol} stepSize 无效`, String(lotFilter?.stepSize));
  }
    return {
      pricePrecision: contract.pricePrecision ?? 8,
      quantityPrecision: contract.quantityPrecision ?? 8,
      tickSize,
      stepSize,
      minQty: Number(lotFilter?.minQty) || Number(marketLotFilter?.minQty) || null,
    };
  })();
  binanceRulesCache.set(symbol, rulesPromise);
  return rulesPromise;
};

const floorToTick = (price, rules) =>
  roundNum(Math.floor(price / rules.tickSize + 1e-10) * rules.tickSize, rules.pricePrecision);

const ceilToTick = (price, rules) =>
  roundNum(Math.ceil(price / rules.tickSize - 1e-10) * rules.tickSize, rules.pricePrecision);

const pricesMatchTier = (trigger, target, tickSize) => {
  const a = Number(trigger);
  const b = Number(target);
  if (!(a > 0) || !(b > 0)) return false;
  const tol = Math.max(tickSize || 0, b * 1e-6, 1e-8);
  return Math.abs(a - b) <= tol * 2;
};

/** 持仓算 xx 拉小时 K：空数组/网络抖常见，有限重试 */
const XX_KLINE_RETRY = RANGE_MONITOR_XX_KLINE_RETRY;
const XX_HOUR_MS = RANGE_MONITOR_XX_HOUR_MS;
const XX_KLINE_CACHE_TTL_MS = RANGE_MONITOR_XX_KLINE_CACHE_TTL_MS;
/** 单次小时 K 上限；更长持仓向前翻页 */
const XX_HOUR_LIMIT = RANGE_MONITOR_XX_HOUR_LIMIT;
/** 按币对+持仓生命周期缓存开仓后的小时 K，避免 2s 轮询重复拉历史数据。 */
const xxKlineCache = new Map();

const TP_ORDER_CACHE_KEY = RANGE_MONITOR_STORAGE_KEYS.tpOrderTiers;
const readTpOrderCache = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(TP_ORDER_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
};
const writeTpOrderCache = cache => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TP_ORDER_CACHE_KEY, JSON.stringify(cache));
  } catch (_) {
    /* ignore storage quota/private mode errors */
  }
};
const tpPlaceInFlight = new Set();

const tpCacheKey = pos =>
  `${pos.exchange}:${String(pos.symbol).toUpperCase()}:${String(pos.positionSide || 'BOTH').toUpperCase()}`;
const tpCacheHas = (cache, pos, tierKey) => Array.isArray(cache[tpCacheKey(pos)]) && cache[tpCacheKey(pos)].includes(tierKey);
const tpCacheAdd = (cache, pos, tierKey) => {
  const key = tpCacheKey(pos);
  const tiers = Array.isArray(cache[key]) ? cache[key] : [];
  if (!tiers.includes(tierKey)) cache[key] = [...tiers, tierKey];
};

const clearTpCacheTier = (cache, pos, tierKey) => {
  const key = tpCacheKey(pos);
  const tiers = Array.isArray(cache[key]) ? cache[key].filter(item => item !== tierKey) : [];
  if (tiers.length) cache[key] = tiers;
  else delete cache[key];
};


const maxHighFromCandles = (candles, direction = 'LONG') => {
  let extreme = null;
  (candles || []).forEach(c => {
    const price = Number(direction === 'SHORT' ? c[3] : c[2]);
    if (price > 0 && (extreme == null || (direction === 'SHORT' ? price < extreme : price > extreme))) extreme = price;
  });
  return extreme;
};

/** 开仓后 → 现在的 1h K（含未收盘当前小时，若交易所返回） */
const fetchHourlyCandlesSinceOpen = async (symbol, exchange, openTimeMs, endTimeMs) => {
  const byTs = new Map();
  let chunkEnd = endTimeMs;
  const spanMs = XX_HOUR_LIMIT * XX_HOUR_MS;
  while (chunkEnd > openTimeMs) {
    const chunkStart = Math.max(openTimeMs, chunkEnd - spanMs + 1);
    await waitBinanceBanIfNeeded(getBinanceBanRemaining);
    const res = await withMarketFetchGate(() =>
      getFutureKlineData(
        {
          symbol,
          granularity: '1H',
          startTime: chunkStart,
          endTime: chunkEnd,
          limit: XX_HOUR_LIMIT,
        },
        exchange
      )
    );
    const chunk = Array.isArray(res?.data) ? res.data : [];
    chunk.forEach(c => {
      const ts = Number(c[0]);
      // 只要开仓之后的根（根开盘时间 ≥ 开仓时刻）；开仓当小时若开盘更早则整根不计入，靠 liveLast 补
      if (Number.isFinite(ts) && ts >= openTimeMs) byTs.set(ts, c);
    });
    if (!chunk.length || chunkStart <= openTimeMs) break;
    chunkEnd = chunkStart - 1;
    await sleep(60);
  }
  return [...byTs.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
};

/**
 * 开仓以来最高价 xx = max(开仓后→现在的小时 K 最高 a, 最新价 b)
 * - 当日开仓：同样拉「开仓后→现在」小时 K，不再用全日 Socket 高（会掺开仓前）
 * - openTime 使用账户镜像本地固定的首次持仓时间，不使用 Binance positionRisk.updateTime
 */
const directionalExtreme = (current, price, direction) => {
  if (!(price > 0)) return current;
  if (!(current > 0)) return price;
  return direction === 'SHORT' ? Math.min(current, price) : Math.max(current, price);
};

const fetchHighSinceOpenXx = async ({ symbol, exchange, openTimeMs, liveLast, direction = 'LONG' }) => {
  requirePositive(openTimeMs, `${symbol} 持仓首次获取时间 updateTime`);
  const live = Number(liveLast);
  const cacheKey = `${exchange}:${String(symbol).toUpperCase()}:${openTimeMs}`;
  const cached = xxKlineCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < XX_KLINE_CACHE_TTL_MS) {
    const extreme = directionalExtreme(cached.extreme || cached.high, live, direction);
    return { xx: extreme, a: cached.extreme || cached.high || null, b: live > 0 ? live : null, bars: cached.bars, cached: true };
  }

  if (getBinanceBanRemaining() > 0) {
    if (cached?.high > 0) {
      const extreme = directionalExtreme(cached.extreme || cached.high, live, direction);
      return {
        xx: extreme,
        a: cached.extreme || cached.high,
        b: live > 0 ? live : null,
        bars: cached.bars,
        cached: true,
        rateLimited: true,
      };
    }
    return {
      xx: null,
      a: null,
      b: live > 0 ? live : null,
      skipped: true,
      rateLimited: true,
      detail: `Binance 限频冷却中，剩余 ${Math.ceil(getBinanceBanRemaining() / 1000)}s`,
    };
  }

  if (!(now >= openTimeMs)) {
    if (live > 0) return { xx: live, a: null, b: live };
    return { xx: null, a: null, b: null, skipped: true, detail: '持仓首次获取时间晚于当前' };
  }

  let lastDetail = '';
  for (let attempt = 1; attempt <= XX_KLINE_RETRY; attempt += 1) {
    let candles = [];
    try {
      candles = await fetchHourlyCandlesSinceOpen(symbol, exchange, openTimeMs, now);
    } catch (e) {
      lastDetail = e?.message || String(e);
      candles = [];
    }

    const a = maxHighFromCandles(candles, direction);
    const extreme = directionalExtreme(a, live, direction);
    const xx = extreme;
    if (xx > 0) {
      xxKlineCache.set(cacheKey, { fetchedAt: Date.now(), extreme, high: extreme, bars: candles.length });
      return { xx, a: extreme, b: live > 0 ? live : null, bars: candles.length };
    }

    lastDetail = candles.length
      ? `有小时 K 但最高无效 attempt=${attempt}/${XX_KLINE_RETRY}`
      : `空小时 K attempt=${attempt}/${XX_KLINE_RETRY}`;

    if (attempt < XX_KLINE_RETRY) await sleep(500 * attempt);
  }

  if (live > 0) {
    xxKlineCache.set(cacheKey, { fetchedAt: Date.now(), extreme: live, high: live, bars: 0 });
    return { xx: live, a: null, b: live, bars: 0, note: `小时K暂空，xx=最新价 · ${lastDetail}` };
  }

  return { xx: null, a: null, b: null, skipped: true, detail: `open=${openTimeMs} end=${now} · ${lastDetail}` };
};

const listAllLongPositions = async (snapshotOverride = null) => {
  const snap = snapshotOverride || (await getBinanceAccountSnapshot());
  if (!snap?.ok) {
    throw new RangeMonitorFatal('拉取多头持仓失败', snap?.error || 'account mirror');
  }
  const rows = Array.isArray(snap.positions) ? snap.positions : null;
  if (!rows) {
    throw new RangeMonitorFatal('持仓响应非数组', typeof snap.positions);
  }
  const positions = [];
  for (const p of rows) {
    const amt = Number(p?.positionAmt || 0);
    const ps = String(p?.positionSide || '').toUpperCase();
    if (ps === 'SHORT' && !(amt < 0)) continue;
    if (ps !== 'SHORT' && !(amt > 0)) continue;
    const positionSide = ps === 'LONG' || ps === 'SHORT' ? ps : 'BOTH';
    const openTime = await getPositionOpenTime({ symbol: p.symbol, positionSide });
    positions.push({
      exchange: 'binance',
      symbol: p.symbol,
      qty: Math.abs(amt),
      entryPrice: finite(p.entryPrice),
      markPrice: finite(p.markPrice),
      positionSide,
      side: ps === 'SHORT' ? 'SHORT' : 'LONG',
      openTime: Number(openTime) || Number(p.updateTime) || null,
    });
  }
  return positions;
};

const listOpenAlgoOrders = async () => {
  const snap = await getBinanceAccountSnapshot({ forceRest: true, ensureStarted: true });
  if (!snap?.ok) {
    throw new RangeMonitorFatal('拉取条件单失败', snap?.error || 'account mirror');
  }
  const rows = Array.isArray(snap.algoOrders) ? snap.algoOrders : null;
  if (!rows) {
    throw new RangeMonitorFatal('条件单响应非数组', typeof snap.algoOrders);
  }
  return rows;
};

const groupAlgosBySymbol = algos => {
  const map = new Map();
  algos.forEach(o => {
    if (!o?.symbol) return;
    const sym = String(o.symbol).toUpperCase();
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(o);
  });
  return map;
};

const isExitOrderForPosition = order => {
  const side = String(order?.side || '').toUpperCase();
  const type = `${order?.type || ''} ${order?.orderType || ''} ${order?.origType || ''} ${order?.algoType || ''}`.toUpperCase();
  const reduceOnly = order?.reduceOnly === true || String(order?.reduceOnly).toLowerCase() === 'true';
  const closePosition = order?.closePosition === true || String(order?.closePosition).toLowerCase() === 'true';
  return reduceOnly || closePosition || type.includes('STOP') || type.includes('TAKE_PROFIT') || type.includes('TRAILING');
};

const positionKey = (symbol, side) => `${String(symbol || '').toUpperCase()}:${String(side || 'BOTH').toUpperCase()}`;


const positionDirection = pos => String(pos?.positionSide || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
const exitOrderSide = pos => positionDirection(pos) === 'SHORT' ? 'BUY' : 'SELL';
const isShortPosition = pos => positionDirection(pos) === 'SHORT';
const directionalPrice = (pos, longPrice, shortPrice) => isShortPosition(pos) ? shortPrice : longPrice;


const placeBreakevenStop = async pos => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const clientOid = `rmsl${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32);
  const mode = await getBinancePositionModeCached();
  if (!mode?.ok && mode?.response == null) {
    throw new RangeMonitorFatal('查询持仓模式失败', pickErr(mode) || 'positionSide/dual');
  }
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const positionSide = hedgeMode ? pos.positionSide || 'LONG' : undefined;
  const rules = await getBinanceRules(pos.symbol);
  const triggerPrice = floorToTick(entry, rules);

  const result = await placeFutureClosePositionAlgo({
    symbol: pos.symbol,
    side: exitOrderSide(pos),
    triggerPrice,
    orderType: 'STOP_MARKET',
    positionSide,
    clientAlgoId: clientOid,
  });
  if (result?.ok) return { ok: true, triggerPrice, result };

  const quantity = quantizeQuantity(pos.qty, rules.stepSize, rules.quantityPrecision);
  if (!(quantity > 0)) {
    throw new RangeMonitorFatal(`${pos.symbol} 止损数量无效`, String(quantity));
  }
  const fallback = await placeFutureQtyStopAlgo({
    symbol: pos.symbol,
    side: exitOrderSide(pos),
    quantity,
    triggerPrice,
    positionSide,
    clientAlgoId: `${clientOid}f`.slice(0, 32),
  });
  return {
    ok: Boolean(fallback?.ok),
    detail: fallback?.ok ? null : pickErr(result) || pickErr(fallback) || '止损提交失败',
    triggerPrice,
    result: fallback?.ok ? fallback : result,
  };
};

const isQtyTooSmall = (quantity, rules) =>
  !(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty);

/**
 * 挂单档止盈：默认平仓 10%；若精度/最小量导致 10% 不可用，改挂该档全仓止盈。
 */
const placeOneTakeProfit = async (pos, mult) => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const qty = requirePositive(pos.qty, `${pos.symbol} 持仓数量`);
  const rules = await getBinanceRules(pos.symbol);
  const mode = await getBinancePositionModeCached();
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const positionSide = hedgeMode ? pos.positionSide || 'LONG' : undefined;

  let closePct = RANGE_MONITOR_TP_CLOSE_PCT;
  let quantity = quantizeQuantity(qty * closePct, rules.stepSize, rules.quantityPrecision);
  let usedFull = false;
  if (isQtyTooSmall(quantity, rules)) {
    // 10% 过小（如 qty=14、step=1 → 1 仍低于 min）→ 该档全量止盈
    closePct = 1;
    quantity = quantizeQuantity(qty, rules.stepSize, rules.quantityPrecision);
    usedFull = true;
  }
  if (isQtyTooSmall(quantity, rules)) {
    throw new RangeMonitorFatal(
      `${pos.symbol} 止盈数量过小（含全量）`,
      `持仓 qty=${qty} → 下单 ${quantity}；minQty=${rules.minQty} step=${rules.stepSize}`
    );
  }
  const trigger = floorToTick(directionalPrice(pos, entry * mult, entry / mult), rules);
  if (!(trigger > 0)) {
    throw new RangeMonitorFatal(`${pos.symbol} 止盈触发价无效`, String(trigger));
  }

  const result = await placeFutureQtyTakeProfitAlgo({
    symbol: pos.symbol,
    side: exitOrderSide(pos),
    quantity,
    triggerPrice: trigger,
    positionSide,
    clientAlgoId: `rmtp${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
  });
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok
      ? null
      : pickErr(result) || '止盈提交失败',
    triggerPrice: trigger,
    quantity,
    mult,
    closePct,
    usedFull,
    result,
  };
};

const placeTrail = async (pos, lastPrice) => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const qty = requirePositive(pos.qty, `${pos.symbol} 持仓数量`);
  const last = requirePositive(lastPrice, `${pos.symbol} 最新价`);
  const rules = await getBinanceRules(pos.symbol);
  const mode = await getBinancePositionModeCached();
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const positionSide = hedgeMode ? pos.positionSide || 'LONG' : undefined;

  let activatePrice = ceilToTick(entry * RANGE_MONITOR_TRAIL_ARM_MULT, rules);
  if (activatePrice <= last) {
    activatePrice = ceilToTick(last * 1.001, rules);
  }
  const trailQty = quantizeQuantity(qty, rules.stepSize, rules.quantityPrecision);
  if (!(trailQty > 0)) {
    throw new RangeMonitorFatal(`${pos.symbol} 追踪数量无效`, String(trailQty));
  }

  const result = await placeFutureTrailingStopAlgo({
    symbol: pos.symbol,
    side: exitOrderSide(pos),
    quantity: trailQty,
    activatePrice,
    callbackRate: RANGE_MONITOR_TRAIL_CALLBACK_PCT,
    positionSide,
    clientAlgoId: `rmtr${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
  });
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '追踪提交失败',
    activatePrice,
    callbackRate: RANGE_MONITOR_TRAIL_CALLBACK_PCT,
    quantity: trailQty,
    result,
  };
};

/**
 * ① 清理：高低比不满足 或 yy > 设置+1 → 撤开多
 */
export const runRangeMonitorCleanup = async ({
  signal,
  onStatus,
  onLog,
  maxRangeMult = RANGE_MONITOR_MAX_MULT,
  nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
  priceFeed,
  binanceSnapshot,
} = {}) => {
  const aborted = () => signal?.aborted;
  const mult = normalizeMaxRangeMult(maxRangeMult);
  const bandPct = normalizeNearBandPct(nearBandPct);
  const leavePct = bandPct + 1;
  const log = entry => onLog?.(entry);
  const feed = priceFeed || getSharedMiniTickerFeed();

  if (!isLiveOrderEnabled()) {
    throw new RangeMonitorFatal('交易未解锁', 'isLiveOrderEnabled=false');
  }
  if (!feed) {
    throw new RangeMonitorFatal('行情流未注入', 'priceFeed');
  }

  onStatus?.(`清理：拉取开多委托（高低比≤${mult.toFixed(2)} · 离开近带 yy>${leavePct}%）…`);
  const { orders, error } = await listLiveLongOpenOrders({ exchanges: MONITOR_EXCHANGES, binanceSnapshot });
  if (aborted()) return { cancelled: 0, kept: 0, failed: 0, aborted: true };
  if (error) {
    throw new RangeMonitorFatal('拉取开多委托失败', error);
  }

  if (!orders.length) {
    onStatus?.('清理：无多头开仓委托');
    return { cancelled: 0, kept: 0, failed: 0, checked: 0 };
  }

  const byPair = new Map();
  orders.forEach(o => {
    const id = pairIdOf(o);
    if (!byPair.has(id)) byPair.set(id, []);
    byPair.get(id).push(o);
  });

  let stockSymbols = new Set();
  try {
    stockSymbols = await loadStockSymbolSet();
  } catch (e) {
    throw new RangeMonitorFatal('股票/ETF 列表加载失败', e?.message || String(e));
  }

  const toCancel = [];
  const cancelReasons = new Map();
  let kept = 0;
  let checked = 0;
  const pairEntries = [...byPair.entries()];

  for (let i = 0; i < pairEntries.length; i += 1) {
    if (aborted()) return { cancelled: 0, kept, failed: 0, aborted: true, checked };
    const [id, pairOrders] = pairEntries[i];
    const { exchange, symbol } = pairOrders[0];
    const recentBreakout = getRecentBreakoutOrder(symbol);
    if (recentBreakout && Date.now() - recentBreakout.at < 10000) {
      kept += 1;
      log({ type: 'open_cleanup_cooldown_skip', symbol, exchange, cooldownRemaining: 10000 - (Date.now() - recentBreakout.at), clientOid: recentBreakout.clientOid });
      continue;
    }
    checked += 1;
    onStatus?.(`清理：检查 ${checked}/${pairEntries.length} ${symbol}`);

    if (stockSymbols.has(String(symbol).toUpperCase())) {
      toCancel.push(...pairOrders);
      cancelReasons.set(id, 'stock');
      continue;
    }
    if (isBlacklistedSymbol(symbol)) {
      toCancel.push(...pairOrders);
      cancelReasons.set(id, 'blacklist');
      continue;
    }

    const { inRange, hits } = await isStillInMonitorRange({ exchange, symbol }, mult, feed);
    if (!inRange) {
      log({
        type: 'cancel_candidate',
        exchange,
        symbol,
        reason: cancelReasons.get(id) || 'out_of_range',
        orders: pairOrders.map(order => ({ orderId: order.orderId, clientOid: order.clientOid, kind: order.kind })),
      });
      toCancel.push(...pairOrders);
      continue;
    }

    const row = [...hits].sort((a, b) => (b.days || 0) - (a.days || 0))[0];
    const rangeHigh = requirePositive(row?.rangeHigh, `${symbol} 区间上沿`);
    const quote = await feed.ensureQuote(symbol, '清理');
    const yy = calcDistBelowRangeHighPct(quote.last, rangeHigh);
    if (yy == null) {
      throw new RangeMonitorFatal(`${symbol} yy 无法计算`, `last=${quote.last} high=${rangeHigh}`);
    }
    if (yy > leavePct) {
      toCancel.push(...pairOrders);
      cancelReasons.set(id, 'far_from_band');
      continue;
    }

    kept += 1;
  }

  if (aborted()) return { cancelled: 0, kept, failed: 0, aborted: true, checked };
  if (!toCancel.length) {
    onStatus?.(`清理完成：保留 ${kept} 个币对委托`);
    return { cancelled: 0, kept, failed: 0, checked };
  }

  onStatus?.(`清理：撤销 ${toCancel.length} 笔开多委托…`);
  const summary = await cancelLongOpenOrders(toCancel, {
    onProgress: ({ index, summary: s }) => {
      onStatus?.(`清理：撤单 ${index + 1}/${s.total}`);
    },
  });

  const cancelledPairs = new Map();
  summary.results.forEach(({ order, result }) => {
    if (!result?.ok || !order) return;
    const id = pairIdOf(order);
    if (!cancelledPairs.has(id)) {
      cancelledPairs.set(id, {
        exchange: order.exchange,
        symbol: order.symbol,
        count: 0,
        source: 'range_monitor_cleanup',
        orderIds: [],
        reason: cancelReasons.get(id) || 'out_of_range',
      });
    }
    cancelledPairs.get(id).count += 1;
    cancelledPairs.get(id).orderIds.push({ orderId: order.orderId, clientOid: order.clientOid, kind: order.kind });
  });
  cancelledPairs.forEach(pair => {
    log({
      type: 'cancelled',
      exchange: pair.exchange,
      symbol: pair.symbol,
      count: pair.count,
      reason: pair.reason,
    });
  });

  onStatus?.(
    `清理完成：撤成功 ${summary.ok} · 失败 ${summary.failed} · 保留币对 ${kept}`
  );
  if (summary.ok > 0) {
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[RangeMonitor] refresh mirror after cancel', e);
    }
  }
  return {
    cancelled: summary.ok,
    failed: summary.failed,
    kept,
    checked,
    cancelledPairs: [...cancelledPairs.values()],
  };
};

/**
 * ② 持仓：止损 / 单笔递进止盈 / 追踪（xx>1.2E）
 */
export const runRangeMonitorPositionStops = async ({
  signal,
  onStatus,
  onLog,
  priceFeed,
  binanceSnapshot,
} = {}) => {
  const aborted = () => signal?.aborted;
  const log = entry => onLog?.(entry);
  const feed = priceFeed || getSharedMiniTickerFeed();

  if (!isLiveOrderEnabled()) {
    throw new RangeMonitorFatal('交易未解锁', '持仓处理');
  }
onStatus?.('持仓：拉取多头持仓…');
  const positions = await listAllLongPositions(binanceSnapshot);
  if (aborted()) return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: 0, failed: 0, aborted: true };

  if (!positions.length) {
    onStatus?.('持仓：无多头持仓');
    return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: 0, failed: 0, checked: 0 };
  }

  onStatus?.('持仓：拉取条件单…');
  let algos;
  try {
    const liveSnapshot = await getBinanceAccountSnapshot({ forceRest: true, ensureStarted: true });
    if (!liveSnapshot?.ok || !Array.isArray(liveSnapshot.algoOrders)) {
      throw new Error(liveSnapshot?.error || '条件单快照不可用');
    }
  const liveOrders = Array.isArray(liveSnapshot.openOrders) ? liveSnapshot.openOrders : [];
    algos = [...liveSnapshot.algoOrders, ...liveOrders];
    const orderKeys = new Set();
    algos = algos.filter(order => {
      const key = order?.algoId != null ? `a:${order.algoId}` : order?.orderId != null ? `o:${order.orderId}` : `c:${order?.clientAlgoId || order?.clientOrderId || ''}`;
      if (!key || orderKeys.has(key)) return false;
      orderKeys.add(key);
      return true;
    });
  } catch (e) {
    log({ type: 'tp_sync_failed', exchange: 'binance', detail: e?.message || String(e) });
    return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: positions.length, failed: 0, syncFailed: true };
  }
  if (aborted()) return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: 0, failed: 0, aborted: true };
  const bySym = groupAlgosBySymbol(algos);
  const activePositions = new Set(positions.map(pos => positionKey(pos.symbol, pos.positionSide)));
  let orphanExitCancelled = 0;
  for (const order of algos) {
    const side = String(order?.side || '').toUpperCase();
    const expectedPositionSide = side === 'BUY' ? 'SHORT' : side === 'SELL' ? 'LONG' : '';
    const orderPositionSide = String(order?.positionSide || 'BOTH').toUpperCase();
    const key = positionKey(order.symbol, orderPositionSide === 'BOTH' ? expectedPositionSide : orderPositionSide);
    if (!isExitOrderForPosition(order) || activePositions.has(key)) continue;
    try {
      const result = order.algoId != null || order.clientAlgoId
        ? await cancelFutureAlgoOrder({ symbol: order.symbol, ...(order.algoId != null ? { algoId: order.algoId } : {}), ...(order.clientAlgoId ? { clientAlgoId: order.clientAlgoId } : {}) })
        : await cancelFutureOrder({ symbol: order.symbol, orderId: order.orderId, origClientOrderId: order.clientOrderId });
      if (result?.ok) {
        orphanExitCancelled += 1;
        log({ type: 'orphan_exit_cancelled', exchange: 'binance', symbol: order.symbol, positionSide: orderPositionSide });
      }
    } catch (e) {
      log({ type: 'orphan_exit_cancel_failed', exchange: 'binance', symbol: order.symbol, detail: e?.message || String(e) });
    }
  }
  const tpOrderCache = readTpOrderCache();
  const activeTpCacheKeys = new Set(positions.map(tpCacheKey));
  Object.keys(tpOrderCache).forEach(key => {
    if (!activeTpCacheKeys.has(key)) delete tpOrderCache[key];
  });
  writeTpOrderCache(tpOrderCache);
  const activeXxCacheKeys = new Set(
    positions.map(pos => `${pos.exchange}:${String(pos.symbol).toUpperCase()}:${pos.openTime}`)
  );
  [...xxKlineCache.keys()].forEach(key => {
    if (!activeXxCacheKeys.has(key)) xxKlineCache.delete(key);
  });

  let armed = 0;
  let tpPlaced = 0;
  let trailPlaced = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < positions.length; i += 1) {
    if (aborted()) {
      return { armed, tpPlaced, trailPlaced, skipped, failed, aborted: true, checked: i };
    }
    const pos = positions[i];
    const sym = String(pos.symbol).toUpperCase();
    onStatus?.(`持仓：${i + 1}/${positions.length} ${pos.symbol}`);

    const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
    if (!(pos.openTime > 0)) {
      skipped += 1;
      log({
        type: 'open_time_unavailable',
        exchange: pos.exchange,
        symbol: pos.symbol,
        detail: '历史成交中未找到真实开仓时间，本轮跳过出场计算',
      });
      continue;
    }

    const quote = await feed.ensureQuote(pos.symbol, '持仓');
    const xxPack = await fetchHighSinceOpenXx({
      symbol: pos.symbol,
      exchange: pos.exchange,
      openTimeMs: pos.openTime,
      liveLast: quote.last,
      direction: positionDirection(pos),
    });
    if (xxPack?.rateLimited) {
      log({
        type: 'xx_kline_rate_limited',
        exchange: pos.exchange,
        symbol: pos.symbol,
        detail: xxPack.detail || 'Binance 限频冷却中，使用已有最高价缓存',
      });
    }
    if (xxPack?.skipped || !(xxPack?.xx > 0)) {
      skipped += 1;
      log({
        type: 'xx_kline_skip',
        exchange: pos.exchange,
        symbol: pos.symbol,
        detail: xxPack?.detail || '开仓后小时 K 不可用',
      });
      onStatus?.(`持仓跳过：${pos.symbol} REST 小时 K 暂无，下一币…`);
      await sleep(80);
      continue;
    }
    const xx = xxPack.xx;

    const symAlgos = bySym.get(sym) || [];
    const direction = positionDirection(pos);
    const moveRatio = direction === 'SHORT' ? entry / xx : xx / entry;
    const stopOrders = symAlgos.filter(o => isBinanceStopAlgo(o, direction));
    let tpOrders = symAlgos.filter(o => isBinanceTakeProfitAlgo(o, direction));
    const trailOrders = symAlgos.filter(o => isBinanceTrailingAlgo(o, direction));
    const rules = await getBinanceRules(pos.symbol);
    const breakevenStops = stopOrders.filter(o => isBreakevenStopAlgo(o, entry, rules.tickSize, direction));

    // 达到 1.4E 后撤掉开仓价全仓止损，改由追踪止盈保护。
    if (xx >= entry * RANGE_MONITOR_TRAIL_ARM_MULT && breakevenStops.length) {
      onStatus?.(`持仓：${pos.symbol} xx≥${RANGE_MONITOR_TRAIL_ARM_MULT}E，撤开仓价止损…`);
      try {
        await cancelBreakevenStops(pos.symbol, breakevenStops);
        breakevenStops.forEach(order => {
          const key = order.algoId != null ? `a:${order.algoId}` : `ac:${order.clientAlgoId || order.clientOrderId}`;
          bySym.set(sym, (bySym.get(sym) || []).filter(item => `${item.algoId != null ? `a:${item.algoId}` : `ac:${item.clientAlgoId || item.clientOrderId}`}` !== key));
        });
        log({
          type: 'sl_breakeven_cancelled',
          exchange: pos.exchange,
          symbol: pos.symbol,
          xx,
          count: breakevenStops.length,
        });
      } catch (e) {
        log({
          type: 'sl_breakeven_cancel_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          xx,
          detail: e?.message || String(e),
        });
      }
    }

    // 2.1 止损：已有追踪委托时由追踪止盈保护，不再重复挂成本止损。
    if (xx >= entry * RANGE_MONITOR_SL_ARM_MULT && !stopOrders.length && !trailOrders.length) {
      onStatus?.(`持仓：${pos.symbol} xx=${xx} ≥ 开仓×1.2，挂成本止损…`);
      const result = await placeBreakevenStop(pos);
      if (result.ok) {
        armed += 1;
        log({
          type: 'sl_armed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          triggerPrice: result.triggerPrice,
        });
      } else {
        failed += 1;
        log({
          type: 'sl_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          detail: result.detail,
        });
        onStatus?.(`持仓止损失败：${pos.symbol} ${result.detail || ''}`);
      }
      await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    }

    // 固定止盈：同时最多一笔；按 xx 递进换档
    const wantTier =
      xx < entry * 1.2
        ? RANGE_MONITOR_TP_MULTS[0]
        : xx < entry * 1.5
          ? RANGE_MONITOR_TP_MULTS[1]
          : xx < entry * 2.0
            ? RANGE_MONITOR_TP_MULTS[2]
            : null;

    // 2.2 动态一档：1.2E 前按方向维护，使用 0.2% 滞后避免成本价附近抖动。
    const firstTier = RANGE_MONITOR_TP_MULTS[0];
    const firstTarget = directionalPrice(pos, entry * firstTier.mult, entry / firstTier.mult);
    const shouldArmFirst = direction === 'SHORT' ? quote.last <= entry * 0.998 : quote.last >= entry * 1.002;
    const shouldCancelFirst = direction === 'SHORT' ? quote.last >= entry * 1.002 : quote.last <= entry * 0.998;
    const exactFirst = tpOrders.filter(o => pricesMatchTier(algoTriggerPrice(o), firstTarget, rules.tickSize));

    if (moveRatio < RANGE_MONITOR_SL_ARM_MULT && !trailOrders.length) {
      if (exactFirst.length) {
        const keepOrder = exactFirst[0];
        const duplicateOrders = exactFirst.slice(1);
        for (const order of duplicateOrders) {
          await cancelFutureAlgoOrder({
            symbol: pos.symbol,
            ...(order.algoId != null ? { algoId: order.algoId } : {}),
            ...(order.clientAlgoId || order.clientOrderId
              ? { clientAlgoId: order.clientAlgoId || order.clientOrderId }
              : {}),
          });
          await sleep(80);
          log({ type: 'tp_duplicate_cancelled', exchange: pos.exchange, symbol: pos.symbol, tier: firstTier.key });
        }
        if (shouldCancelFirst) {
          await cancelFutureAlgoOrder({
            symbol: pos.symbol,
            ...(keepOrder.algoId != null ? { algoId: keepOrder.algoId } : {}),
            ...(keepOrder.clientAlgoId || keepOrder.clientOrderId
              ? { clientAlgoId: keepOrder.clientAlgoId || keepOrder.clientOrderId }
              : {}),
          });
          await sleep(80);
          clearTpCacheTier(tpOrderCache, pos, firstTier.key);
          writeTpOrderCache(tpOrderCache);
          tpOrders = tpOrders.filter(order => !exactFirst.includes(order));
          log({ type: 'tp_first_cancelled', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, quote: quote.last });
        } else if (duplicateOrders.length) {
          tpOrders = [keepOrder, ...tpOrders.filter(order => !exactFirst.includes(order) && order !== keepOrder)];
        }
      } else if (!tpOrders.length && shouldArmFirst) {
        const placeKey = `${pos.exchange}:${sym}:${direction}:${firstTier.key}`;
        if (tpPlaceInFlight.has(placeKey)) {
          skipped += 1;
          log({ type: 'tp_place_inflight_skip', exchange: pos.exchange, symbol: pos.symbol, tier: firstTier.key });
        } else {
          tpPlaceInFlight.add(placeKey);
          let tpResult;
          try {
            tpResult = await placeOneTakeProfit(pos, firstTier.mult);
          } finally {
            tpPlaceInFlight.delete(placeKey);
          }
          if (tpResult?.ok) {
            tpPlaced += 1;
            tpCacheAdd(tpOrderCache, pos, firstTier.key);
            writeTpOrderCache(tpOrderCache);
            tpOrders = [{ type: 'TAKE_PROFIT_MARKET', orderType: 'TAKE_PROFIT_MARKET', algoType: 'CONDITIONAL', side: exitOrderSide(pos), positionSide: pos.positionSide, triggerPrice: tpResult.triggerPrice, clientAlgoId: tpResult.result?.response?.clientAlgoId }];
            log({ type: 'tp_first_placed', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, quote: quote.last, triggerPrice: tpResult.triggerPrice });
          } else {
            failed += 1;
            log({ type: 'tp_failed', exchange: pos.exchange, symbol: pos.symbol, detail: tpResult?.detail });
          }
          await sleep(RANGE_MONITOR_PLACE_GAP_MS);
        }
      }
    }

    // 2.3 固定止盈：达到 1.2E 后才递进到二档/三档。
    if (wantTier && moveRatio >= RANGE_MONITOR_SL_ARM_MULT) {
      const targetTrigger = directionalPrice(pos, entry * wantTier.mult, entry / wantTier.mult);
      const hasExact = tpOrders.some(o => pricesMatchTier(algoTriggerPrice(o), targetTrigger, rules.tickSize));
      const cachedExact = tpCacheHas(tpOrderCache, pos, wantTier.key);

      if (cachedExact || hasExact) {
        if (hasExact) {
          tpCacheAdd(tpOrderCache, pos, wantTier.key);
          writeTpOrderCache(tpOrderCache);
        }
        skipped += 1;
      } else if (!tpOrders.length) {
        const placeKey = `${pos.exchange}:${sym}:${direction}:${wantTier.key}`;
        if (tpPlaceInFlight.has(placeKey)) {
          skipped += 1;
          log({ type: 'tp_place_inflight_skip', exchange: pos.exchange, symbol: pos.symbol, tier: wantTier.key });
        } else {
          tpPlaceInFlight.add(placeKey);
          let tpResult;
          try {
            tpResult = await placeOneTakeProfit(pos, wantTier.mult);
          } finally {
            tpPlaceInFlight.delete(placeKey);
          }
          if (tpResult?.ok) {
            tpPlaced += 1;
            tpCacheAdd(tpOrderCache, pos, wantTier.key);
            writeTpOrderCache(tpOrderCache);
            log({ type: 'tp_placed', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, xx, submitted: [{ key: wantTier.key, triggerPrice: tpResult.triggerPrice }] });
          } else {
            failed += 1;
            log({ type: 'tp_failed', exchange: pos.exchange, symbol: pos.symbol, detail: tpResult?.detail });
          }
          await sleep(RANGE_MONITOR_PLACE_GAP_MS);
        }
      } else if (!hasExact) {
        skipped += 1;
        log({ type: 'tp_tier_mismatch', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, xx, targetMult: wantTier.mult, targetTrigger });
      } else {
        skipped += 1;
      }
    }
// 2.5 追踪：xx > 开仓×1.2
    if (xx > entry * RANGE_MONITOR_TRAIL_ARM_MULT && !trailOrders.length) {
      onStatus?.(`持仓：${pos.symbol} xx>${RANGE_MONITOR_TRAIL_ARM_MULT}E，挂追踪回调 ${RANGE_MONITOR_TRAIL_CALLBACK_PCT}%…`);
      const trailResult = await placeTrail(pos, quote.last);
      if (trailResult.ok) {
        trailPlaced += 1;
        log({
          type: 'trail_placed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          activatePrice: trailResult.activatePrice,
          callbackRate: trailResult.callbackRate,
        });
      } else {
        failed += 1;
        log({
          type: 'trail_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: trailResult.detail,
        });
        onStatus?.(`持仓追踪失败：${pos.symbol} ${trailResult.detail || ''}`);
      }
      await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    }
  }

  onStatus?.(
    `持仓完成：检查 ${positions.length} · 止盈 ${tpPlaced} · 止损 ${armed} · 追踪 ${trailPlaced} · 跳过 ${skipped} · 失败 ${failed}`
  );
  if (armed + tpPlaced + trailPlaced > 0) {
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[RangeMonitor] refresh mirror after exits', e);
    }
  }
  return {
    armed,
    tpPlaced,
    trailPlaced,
    skipped,
    failed,
    checked: positions.length,
  };
};

/**
 * ③ 扫描挂开多：在日 K 缓存上内存算盒子；yy≤设置、无仓无委托、最小名义<20U；坑位 200−n×2
 */
export const runRangeMonitorScanAndPlace = async ({
  signal,
  onStatus,
  onLog,
  maxRangeMult = RANGE_MONITOR_MAX_MULT,
  nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
  priceFeed,
  binanceSnapshot,
} = {}) => {
  const aborted = () => signal?.aborted;
  const mult = normalizeMaxRangeMult(maxRangeMult);
  const bandPct = normalizeNearBandPct(nearBandPct);
  const log = entry => onLog?.(entry);
  const feed = priceFeed || getSharedMiniTickerFeed();

  if (!isLiveOrderEnabled()) {
    throw new RangeMonitorFatal('交易未解锁', '开仓扫描');
  }

  syncCandleCacheTodayFromFeed(feed);
  let pairs = listCachedMonitorPairs();
  if (!pairs.length) {
    onStatus?.('扫描：日 K 缓存空，重建…');
    const built = await ensureRangeMonitorCandleCache({
      signal,
      onStatus,
      priceFeed: feed,
      maxRangeMult: mult,
    });
    if (built?.aborted || aborted()) {
      return { placed: 0, skipped: 0, failed: 0, scanned: 0, aborted: true };
    }
    pairs = listCachedMonitorPairs();
  }
  if (!pairs.length) {
    throw new RangeMonitorFatal('日 K 缓存无币对', 'ensureRangeMonitorCandleCache');
  }
  if (aborted()) return { placed: 0, skipped: 0, failed: 0, scanned: 0, aborted: true };

  onStatus?.(`扫描：内存遍历 ${pairs.length} 币（日 K 缓存）· 同步持仓/委托…`);
  const statusMaps = await fetchLiveOrderStatusMaps(pairs, { binanceSnapshot });
  if (aborted()) return { placed: 0, skipped: 0, failed: 0, scanned: 0, aborted: true };
  if (statusMaps.error) {
    throw new RangeMonitorFatal('同步持仓/委托失败', statusMaps.error);
  }
  const orderedMap = { ...(statusMaps.orderedMap || {}) };
  const positionMap = { ...(statusMaps.positionMap || {}) };

  const positions = await listAllLongPositions(binanceSnapshot);
  const n = positions.length;
  const snapshotOrders = [
    ...(binanceSnapshot?.openOrders || []),
    ...(binanceSnapshot?.algoOrders || []),
  ];
  const activeOrderKeys = new Set();
  snapshotOrders.forEach(order => {
    const status = String(order?.status || '').toUpperCase();
    if (['CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FILLED', 'FINISHED', 'TRIGGERED'].includes(status)) return;
    const key = order?.orderId != null
      ? `o:${order.orderId}`
      : order?.algoId != null
        ? `a:${order.algoId}`
        : order?.clientOrderId || order?.clientAlgoId;
    if (key) activeOrderKeys.add(String(key));
  });
  const actualOrderCount = activeOrderKeys.size;
  let slotLeft = RANGE_MONITOR_MAX_ORDERS - actualOrderCount;
  if (!(slotLeft > 0)) {
    onStatus?.(`扫描：委托已达上限 ${actualOrderCount}/${RANGE_MONITOR_MAX_ORDERS}，跳过开仓`);
    return { placed: 0, skipped: 0, failed: 0, scanned: 0, hits: 0, slotLeft, n, actualOrderCount };
  }

  let placed = 0;
  let skipped = 0;
  let failed = 0;
  let scanned = 0;
  let hits = 0;
  /** 在区间且 yy≤近带%、现价未过上沿 */
  let nearBandIn = 0;
  /** 近带内且已有仓/开多委托 */
  let nearBandBusy = 0;
  /** 本轮已破上沿币对（按 exchange:symbol 去重） */
  const brokeOutIds = new Set();
  let minNotionalSkip = 0;
  let placeSkipped = 0;
  let stopOpen = false;

  for (let i = 0; i < pairs.length; i += 1) {
    if (aborted()) {
      return {
        placed,
        skipped,
        failed,
        scanned,
        hits,
        nearBandIn,
        nearBandBusy,
        brokeOut: brokeOutIds.size,
        brokeOutSymbols: [...brokeOutIds],
        aborted: true,
        stopOpen,
      };
    }
    if (stopOpen) break;
    if (slotLeft - placed <= 0) {
      onStatus?.(`扫描：本轮可用委托槽位已用尽（已有 ${actualOrderCount} · 上限 ${RANGE_MONITOR_MAX_ORDERS}）`);
      break;
    }

    const pair = pairs[i];
    const id = pairIdOf(pair);
    scanned += 1;
    if (scanned % 20 === 0 || scanned === 1) {
      onStatus?.(
        `扫描 ${scanned}/${pairs.length} · 在区间 ${hits} · 近带内 ${nearBandIn} · 已挂 ${placed}${
          stopOpen ? ' · 开仓已中止' : ''
        }`
      );
    }

    let candles;
    let candidates = [];
    try {
      candles = getCachedMonitorCandles(pair.symbol, feed);
      if (!Array.isArray(candles) || !candles.length) {
        skipped += 1;
        continue;
      }
      candidates = findMonitorCandidateRanges(candles, pair, mult);
    } catch (e) {
      if (e instanceof RangeMonitorFatal) throw e;
      throw new RangeMonitorFatal(`${pair.symbol} 算盒子失败`, e?.message || String(e));
    }

    if (!candidates.length) {
      if (scanned % RANGE_MONITOR_CACHED_SCAN_YIELD_EVERY === 0) await sleep(0);
      continue;
    }

    const row = [...candidates].sort((a, b) => (b.days || 0) - (a.days || 0))[0];
    const rangeHigh = requirePositive(row.rangeHigh, `${row.symbol} 区间上沿`);

    const quote = await feed.ensureQuote(row.symbol, '开仓');
    const yy = calcDistBelowRangeHighPct(quote.last, rangeHigh);
    if (yy == null) {
      throw new RangeMonitorFatal(`${row.symbol} yy 无效`, `last=${quote.last}`);
    }

    // 日K/现价已破：只作「不挂」预检，不计入「破」（「破」仅=近带内实挂被 -2021）
    if (getMonitorBreakAboveHigh(candles, row, quote.last)) {
      skipped += 1;
      continue;
    }

    hits += 1;

    // 未进近带：只计在区间，不往下看仓/单
    if (yy > bandPct) {
      skipped += 1;
      continue;
    }

    nearBandIn += 1;

    if (positionMap[id] || orderedMap[id]) {
      skipped += 1;
      nearBandBusy += 1;
      continue;
    }

    const minUsdt = await resolveMinOpenNotionalUsdt({
      symbol: row.symbol,
      exchange: row.exchange,
      price: rangeHigh,
    });
    if (!(minUsdt > 0)) {
      throw new RangeMonitorFatal(`${row.symbol} 最小开仓金额无效`, String(minUsdt));
    }
    if (!(minUsdt < MONITOR_MAX_MIN_OPEN_USDT)) {
      skipped += 1;
      minNotionalSkip += 1;
      log({
        type: 'min_notional_skip',
        symbol: row.symbol,
        exchange: row.exchange,
        reason: 'min_open_ge_20',
        minUsdt,
        detail: `最小开仓 ${Number(minUsdt).toFixed(2)}U ≥ ${MONITOR_MAX_MIN_OPEN_USDT}U，跳过挂开多`,
      });
      continue;
    }

    const openNotionalUsdt = roundNum(minUsdt * MONITOR_OPEN_NOTIONAL_MULT, 2);
    if (!(openNotionalUsdt > 0)) {
      throw new RangeMonitorFatal(`${row.symbol} 开仓名义无效`, String(openNotionalUsdt));
    }

    onStatus?.(
      `开仓：${row.symbol} ~${openNotionalUsdt}U · yy=${yy.toFixed(2)}%≤${bandPct}%`
    );
      const result = await placeBreakoutTriggerOrder({
        ...row,
        openNotionalUsdt,
      });

    if (result.ok) {
      placed += 1;
      orderedMap[id] = true;
      log({
        type: 'placed',
        symbol: row.symbol,
        exchange: row.exchange,
        openNotionalUsdt,
        triggerPrice: result.triggerPrice,
        yy,
      });
      await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    } else if (result.skipped) {
      skipped += 1;
      placeSkipped += 1;
      if (result.reason === 'has_orders') orderedMap[id] = true;
      if (result.reason === 'has_position') positionMap[id] = true;
      log({
        type: 'skipped',
        symbol: row.symbol,
        exchange: row.exchange,
        reason: result.reason,
        detail: result.detail,
      });
      onStatus?.(
        `开仓跳过：${row.symbol} · ${result.reason || ''}${result.detail ? ` · ${result.detail}` : ''}`
      );
    } else if (isWouldImmediatelyTrigger(result)) {
      // 「破」唯一口径：近带内、无仓无单、实挂条件单被交易所判会立刻触发
      skipped += 1;
      brokeOutIds.add(id);
      if (shouldTipBrokeOnce(row.symbol)) {
        log({
          type: 'broke_out',
          symbol: row.symbol,
          exchange: row.exchange,
          rangeHigh,
          liveLast: quote.last,
          yy,
          scanned,
          total: pairs.length,
          detail: result.detail || '挂单会立刻触发(-2021)，未挂上',
        });
      }
    } else if (isAccountLevelOpenFail(result)) {
      failed += 1;
      stopOpen = true;
      log({
        type: 'max_stop_limit',
        symbol: row.symbol,
        exchange: row.exchange,
        scanned,
        total: pairs.length,
        detail: result.detail || '账户级/上限类失败',
      });
      onStatus?.(
        `开仓账户级失败已中止：${row.symbol} · ${result.detail || ''}（后续币对本轮不再开仓）`
      );
      break;
    } else {
      failed += 1;
      log({
        type: 'failed_stop',
        symbol: row.symbol,
        exchange: row.exchange,
        scanned,
        total: pairs.length,
        reason: result.reason,
        detail: result.detail,
      });
      onStatus?.(
        `开仓失败(币对级继续)：${row.symbol} · ${result.detail || result.reason || ''}`
      );
      await sleep(RANGE_MONITOR_SCAN_GAP_MS);
    }
  }
if (!stopOpen) {
    onStatus?.(
      `扫描完成：检 ${scanned} · 在区间 ${hits} · 距上沿≤${bandPct}% ${nearBandIn}` +
        `（已有仓/单 ${nearBandBusy}）· 名义≥20 ${minNotionalSkip}` +
        ` · 委托 ${actualOrderCount}+${placed}/${RANGE_MONITOR_MAX_ORDERS}` +
        ` · 下单跳过 ${placeSkipped} · 破 ${brokeOutIds.size} · 挂 ${placed} · 败 ${failed}`
    );
  }

  if (placed > 0) {
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[RangeMonitor] refresh mirror after scan place', e);
    }
  }

  const brokeOut = brokeOutIds.size;
  return {
    placed,
    skipped,
    failed,
    scanned,
    hits,
    nearBandIn,
    nearBandBusy,
    brokeOut,
    brokeOutSymbols: [...brokeOutIds],
    minNotionalSkip,
    placeSkipped,
    /** @deprecated 用 nearBandBusy；保留避免旧 UI 读空 */
    alreadyBusy: nearBandBusy,
    farBand: Math.max(0, hits - nearBandIn),
    stopOpen,
    n,
    actualOrderCount,
    slotLeft,
    bandPct,
  };
};

/**
 * 完整一轮：Socket 复用由调用方 start/stop；本函数内 waitReady。
 */
export const runRangeMonitorRound = async ({
  signal,
  onStatus,
  onLog,
  maxRangeMult = RANGE_MONITOR_MAX_MULT,
  nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
  priceFeed,
} = {}) => {
  const feed = priceFeed || getSharedMiniTickerFeed();
  feed.start();
  await feed.waitReady(20000);

  const binanceSnapshot = await getBinanceAccountSnapshot();
  if (RANGE_MONITOR_STRICT && !Number.isFinite(Number(maxRangeMult))) {
    throw new RangeMonitorFatal('高低比参数无效', String(maxRangeMult));
  }
  if (RANGE_MONITOR_STRICT && !Number.isFinite(Number(nearBandPct))) {
    throw new RangeMonitorFatal('近带%参数无效', String(nearBandPct));
  }

  const candleCache = await ensureRangeMonitorCandleCache({
    signal,
    onStatus,
    priceFeed: feed,
    maxRangeMult,
  });
  if (signal?.aborted || candleCache?.aborted) {
    return { cleanup: null, positions: null, scan: null, aborted: true, candleCache };
  }

  const cleanup = await runRangeMonitorCleanup({
    signal,
    onStatus,
    onLog,
    maxRangeMult,
    nearBandPct,
    priceFeed: feed,
    binanceSnapshot,
  });
  if (signal?.aborted || cleanup.aborted) {
    return { cleanup, positions: null, scan: null, aborted: true, candleCache };
  }

  const positions = await runRangeMonitorPositionStops({
    signal,
    onStatus,
    onLog,
    priceFeed: feed,
  });
  if (signal?.aborted || positions.aborted) {
    return { cleanup, positions, scan: null, aborted: true };
  }

  if (!RANGE_MONITOR_SCAN_ENABLED) {
    onStatus?.('扫描：已关闭 RANGE_MONITOR_SCAN_ENABLED');
    return {
      cleanup,
      positions,
      scan: { placed: 0, skipped: 0, failed: 0, scanned: 0, disabled: true },
      aborted: false,
    };
  }

  const scan = await runRangeMonitorScanAndPlace({
    signal,
    onStatus,
    onLog,
    maxRangeMult,
    nearBandPct,
    priceFeed: feed,
    binanceSnapshot,
  });
  return { cleanup, positions, scan, candleCache, aborted: Boolean(scan?.aborted) };
};
