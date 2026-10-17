import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import { getPositionMode as getBinancePositionMode } from '@root/src/container/binance/api/query';
import {
  getBinanceAccountSnapshot,
  patchBinancePositionOpenTime,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import {
  gateBeforeExitPlace,
  rememberExitSuccess,
  PlaceIntent,
} from '@root/src/container/binance/placeGate';
import { clearPlaceSuccessByIntent } from '@root/src/container/binance/placeSuccessCache';
import {
  placeFutureClosePositionAlgo,
  placeFutureQtyTakeProfitAlgo,
  placeFutureTrailingStopAlgo,
  cancelFutureAlgoOrder,
  cancelFutureOrder,
} from '@root/src/container/binance/api/order';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { isBlacklistedSymbol } from '../_symbolBlacklist';
import { isLiveOrderEnabled, quantizeQuantity } from '../system_1/_autoOrderModel';
import { waitBinanceBanIfNeeded } from '../_marketFetchGate';
import {
  findMonitorCandidateRanges,
  getMonitorBreakAboveHigh,
  getMonitorLeftRange,
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
import { getSharedKLineMirror } from '@root/src/container/market/klineMirror';
import { RangeMonitorFatal, getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';
import {
  RANGE_MONITOR_SCAN_ENABLED,
  RANGE_MONITOR_SL_ARM_MULT,
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
import {
  calcMoveRatio,
  exitOrderSide,
  hasReachedGainMult,
  hasReachedTrailArm,
  hasTpOrderAtTrigger,
  isBinanceStopAlgo,
  isBinanceTakeProfitOrder,
  isBinanceTrailingAlgo,
  isBreakevenStopAlgo,
  isClosePositionAlgo,
  isExitOrderForPosition,
  isQtyBasedStopAlgo,
  isInFirstTierDynamicPhase,
  isInFixedTpPhase,
  isQtyTooSmall,
  listFirstTierTakeProfitOrders,
  positionDirection,
  selectWantedTpTier,
  shouldArmFirstTier,
  shouldCancelFirstTier,
  tierTriggerPrice,
  tpCacheHas,
  tpCacheKey,
  tpTiersForDirection,
  trailActivateRawPrice,
} from './_rangeMonitorJudges';

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

/**
 * 清理用：有几何候选盒子即 keep 候选；不要用 active（已破上沿会空，会把待成交突破单误撤）。
 */
const resolveCleanupBox = async (pair, maxRangeMult, priceFeed) => {
  const candles = await resolveMonitorCandles(pair, priceFeed);
  if (!Array.isArray(candles) || !candles.length) {
    throw new RangeMonitorFatal(`${pair.symbol} 历史 K 线为空`, '清理/扫描无法重算高低比');
  }
  const hits = findMonitorCandidateRanges(candles, pair, maxRangeMult);
  return { hasBox: hits.length > 0, hits, candles };
};

const isRangeMonitorOpenOrder = order =>
  /^lvb/i.test(String(order?.clientOid || order?.clientAlgoId || order?.clientOrderId || ''));

/** 条件单去重键：优先 clientAlgoId，避免「本地影子(无 algoId)」与「交易所真单」被当成两笔。 */
const algoIdentityKey = order => {
  const clientId = String(order?.clientAlgoId || order?.clientOrderId || '').trim();
  if (clientId) return `c:${clientId}`;
  if (order?.algoId != null) return `a:${order.algoId}`;
  if (order?.orderId != null) return `o:${order.orderId}`;
  return '';
};

/** 逐笔撤销指定币对的成本价止损条件单；跳过本地影子单（无交易所 algoId），避免误撤真单。 */
const cancelBreakevenStops = async (symbol, orders) => {
  for (const order of orders) {
    // 仅 _rememberedAt、尚无 algoId 的是进程内乐观记录，对其 cancel(clientAlgoId) 会误撤刚挂上的真单
    if (order?._rememberedAt && order?.algoId == null && order?.orderId == null) continue;
    const algoId = order.algoId ?? order.orderId;
    const clientAlgoId = order.clientAlgoId || order.clientOrderId;
    if (algoId == null && !clientAlgoId) continue;
    await cancelFutureAlgoOrder({
      symbol,
      ...(algoId != null ? { algoId } : {}),
      // 有 algoId 时不要再带 clientAlgoId，减少误伤同 client 的其它形态
      ...(algoId == null && clientAlgoId ? { clientAlgoId } : {}),
    });
    await sleep(80);
  }
};

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

/** 持仓算 xx 拉小时 K：空数组/网络抖常见，有限重试 */
const XX_KLINE_RETRY = RANGE_MONITOR_XX_KLINE_RETRY;
const XX_HOUR_MS = RANGE_MONITOR_XX_HOUR_MS;
const XX_KLINE_CACHE_TTL_MS = RANGE_MONITOR_XX_KLINE_CACHE_TTL_MS;
/** 单次小时 K 上限；更长持仓向前翻页 */
const XX_HOUR_LIMIT = RANGE_MONITOR_XX_HOUR_LIMIT;
/** 按币对+持仓生命周期缓存开仓后的小时 K；落在统一 KLineMirror.hourXx */
const xxKlineCache = () => getSharedKLineMirror().hourXx;

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
/** 成本止损 / 追踪挂单 inflight，防止事件驱动并发双挂 */
const slPlaceInFlight = new Set();
const trailPlaceInFlight = new Set();
/** 刚成功挂上成本止损的冷却（镜像尚未带回新单时防重挂） */
const slArmedAt = new Map();
const SL_ARM_COOLDOWN_MS = 60_000;
/** 刚成功挂上的止盈档冷却 */
const tpArmedAt = new Map();
const TP_ARM_COOLDOWN_MS = 120_000;
/**
 * 本进程刚挂出、镜像可能尚未带回的出场条件单（按 symbol）。
 * 下一轮合并进 bySym，避免账户变更立刻再跑时重复挂止盈。
 */
const recentExitAlgosBySym = new Map();
const RECENT_EXIT_ALGO_TTL_MS = 120_000;

const rememberRecentExitAlgo = (symbol, algo) => {
  const sym = String(symbol || '').toUpperCase();
  if (!sym || !algo) return;
  const list = recentExitAlgosBySym.get(sym) || [];
  list.push({ ...algo, _rememberedAt: Date.now() });
  recentExitAlgosBySym.set(sym, list);
};

const mergeRecentExitAlgos = bySym => {
  const now = Date.now();
  recentExitAlgosBySym.forEach((list, sym) => {
    const alive = list.filter(o => now - (o._rememberedAt || 0) < RECENT_EXIT_ALGO_TTL_MS);
    if (!alive.length) {
      recentExitAlgosBySym.delete(sym);
      return;
    }
    recentExitAlgosBySym.set(sym, alive);
    const existing = bySym.get(sym) || [];
    const keys = new Set(existing.map(algoIdentityKey).filter(Boolean));
    alive.forEach(o => {
      const key = algoIdentityKey(o);
      // 镜像已有同 clientAlgoId 真单时不再塞影子，否则去重会 cancel(clientId) 误撤真单
      if (key && !keys.has(key)) {
        existing.push(o);
        keys.add(key);
      }
    });
    bySym.set(sym, existing);
  });
};

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
    const res = await getFutureKlineData(
      {
        symbol,
        granularity: '1H',
        startTime: chunkStart,
        endTime: chunkEnd,
        limit: XX_HOUR_LIMIT,
      },
      exchange
    );
    const chunk = Array.isArray(res?.data) ? res.data : [];
    chunk.forEach(c => {
      const ts = Number(c[0]);
      // 开仓之后的根（根开盘 ≥ 开仓时刻）；开仓当小时靠 liveLast / sticky 极值补
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

const persistXxExtreme = (cacheKey, prev, extreme, bars, direction = 'LONG') => {
  // sticky：有利极值只升不降，避免冲高回落后 TTL 重拉把 xx 打回 1.2 以下、漏挂成本止损
  const sticky = directionalExtreme(prev?.extreme || prev?.high, extreme, direction);
  const row = {
    fetchedAt: Date.now(),
    extreme: sticky,
    high: sticky,
    bars: bars != null ? bars : prev?.bars || 0,
    _direction: direction,
  };
  xxKlineCache().set(cacheKey, row);
  return row;
};

const fetchHighSinceOpenXx = async ({
  symbol,
  exchange,
  openTimeMs,
  liveLast,
  direction = 'LONG',
}) => {
  requirePositive(openTimeMs, `${symbol} 持仓首次获取时间 updateTime`);
  const live = Number(liveLast);
  const cacheKey = `${exchange}:${String(symbol).toUpperCase()}:${openTimeMs}`;
  const cached = xxKlineCache().get(cacheKey);
  if (cached && !cached._direction) cached._direction = direction;
  const now = Date.now();

  const withLiveSticky = base => {
    const merged = directionalExtreme(base, live, direction);
    const row = persistXxExtreme(cacheKey, cached, merged, cached?.bars, direction);
    return {
      xx: row.extreme,
      a: row.extreme,
      b: live > 0 ? live : null,
      bars: row.bars,
      cached: true,
    };
  };

  if (cached && now - cached.fetchedAt < XX_KLINE_CACHE_TTL_MS) {
    return withLiveSticky(cached.extreme || cached.high);
  }

  if (getBinanceBanRemaining() > 0) {
    if (cached?.extreme > 0 || cached?.high > 0 || live > 0) {
      return {
        ...withLiveSticky(cached?.extreme || cached?.high),
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
    if (live > 0) {
      const row = persistXxExtreme(cacheKey, cached, live, 0, direction);
      return { xx: row.extreme, a: null, b: live };
    }
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
    const fromBarsAndLive = directionalExtreme(a, live, direction);
    const extreme = directionalExtreme(
      cached?.extreme || cached?.high,
      fromBarsAndLive,
      direction
    );
    if (extreme > 0) {
      const row = persistXxExtreme(cacheKey, cached, extreme, candles.length, direction);
      return { xx: row.extreme, a: a || row.extreme, b: live > 0 ? live : null, bars: candles.length };
    }

    lastDetail = candles.length
      ? `有小时 K 但最高无效 attempt=${attempt}/${XX_KLINE_RETRY}`
      : `空小时 K attempt=${attempt}/${XX_KLINE_RETRY}`;

    if (attempt < XX_KLINE_RETRY) await sleep(500 * attempt);
  }

  if (live > 0 || cached?.extreme > 0 || cached?.high > 0) {
    const extreme = directionalExtreme(cached?.extreme || cached?.high, live, direction);
    const row = persistXxExtreme(cacheKey, cached, extreme, 0, direction);
    return {
      xx: row.extreme,
      a: cached?.extreme || cached?.high || null,
      b: live > 0 ? live : null,
      bars: 0,
      note: `小时K暂空，xx=sticky极值 · ${lastDetail}`,
    };
  }

  return { xx: null, a: null, b: null, skipped: true, detail: `open=${openTimeMs} end=${now} · ${lastDetail}` };
};

const listAllLongPositions = async (snapshotOverride = null, { onStatus } = {}) => {
  const snap = snapshotOverride || (await getBinanceAccountSnapshot());
  if (!snap?.ok) {
    throw new RangeMonitorFatal('拉取多头持仓失败', snap?.error || 'account mirror');
  }
  const rows = Array.isArray(snap.positions) ? snap.positions : null;
  if (!rows) {
    throw new RangeMonitorFatal('持仓响应非数组', typeof snap.positions);
  }

  const candidates = [];
  for (const p of rows) {
    const amt = Number(p?.positionAmt || 0);
    const ps = String(p?.positionSide || '').toUpperCase();
    if (ps === 'SHORT' && !(amt < 0)) continue;
    if (ps !== 'SHORT' && !(amt > 0)) continue;
    const positionSide = ps === 'LONG' || ps === 'SHORT' ? ps : 'BOTH';
    candidates.push({ p, amt, ps, positionSide });
  }

  const positions = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const { p, amt, ps, positionSide } = candidates[i];
    // 镜像 sticky openTime = 首次见到仓位的 updateTime，常晚于真实成交。
    // 算 xx / 武装成本止损必须用 userTrades 开仓时间（与持仓监控页一致）；getPositionOpenTime 有 6h 缓存。
    const stickyOpen = Number(p.openTime) || 0;
    onStatus?.(
      `持仓：解析开仓时间 ${i + 1}/${candidates.length} ${String(p.symbol).toUpperCase()}…`
    );
    const tradeOpen =
      Number(await getPositionOpenTime({ symbol: p.symbol, positionSide })) || 0;
    const openTime =
      tradeOpen > 0 ? tradeOpen : stickyOpen || Number(p.updateTime) || null;
    if (tradeOpen > 0 && (stickyOpen <= 0 || tradeOpen < stickyOpen)) {
      try {
        patchBinancePositionOpenTime({
          symbol: p.symbol,
          positionSide,
          openTime: tradeOpen,
        });
      } catch (_) {
        /* ignore */
      }
    }
    positions.push({
      exchange: 'binance',
      symbol: p.symbol,
      qty: Math.abs(amt),
      entryPrice: finite(p.entryPrice),
      markPrice: finite(p.markPrice),
      positionSide,
      side: ps === 'SHORT' ? 'SHORT' : 'LONG',
      openTime,
      openTimeSource: tradeOpen > 0 ? 'trade' : stickyOpen > 0 ? 'sticky' : 'updateTime',
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

const positionKey = (symbol, side) => `${String(symbol || '').toUpperCase()}:${String(side || 'BOTH').toUpperCase()}`;

/** 算成本止损触发价、持仓方向、clientOid（数量用 closePosition 全平） */
const prepareBreakevenStop = async pos => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const mode = await getBinancePositionModeCached();
  if (!mode?.ok && mode?.response == null) {
    throw new RangeMonitorFatal('查询持仓模式失败', pickErr(mode) || 'positionSide/dual');
  }
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const rules = await getBinanceRules(pos.symbol);
  return {
    symbol: pos.symbol,
    direction: positionDirection(pos),
    triggerPrice: floorToTick(entry, rules),
    positionSide: hedgeMode ? pos.positionSide || 'LONG' : undefined,
    clientOid: `rmsl${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
  };
};

/** 向交易所提交成本止损条件单，成功则写入本机 EXIT_SL 缓存 */
const submitBreakevenStop = async (pos, prepared) => {
  const result = await placeFutureClosePositionAlgo({
    symbol: prepared.symbol,
    side: exitOrderSide(pos),
    triggerPrice: prepared.triggerPrice,
    orderType: 'STOP_MARKET',
    positionSide: prepared.positionSide,
    clientAlgoId: prepared.clientOid,
  });
  const body = result?.response;
  const algoId = body?.algoId ?? body?.orderId;
  if (result?.ok && algoId != null && !(Number(body?.code) < 0)) {
    rememberExitSuccess({
      symbol: prepared.symbol,
      intent: PlaceIntent.EXIT_SL,
      tag: prepared.direction,
      meta: { clientAlgoId: body?.clientAlgoId || prepared.clientOid, algoId },
    });
    return {
      ok: true,
      triggerPrice: prepared.triggerPrice,
      result,
      algoId,
      clientAlgoId: body?.clientAlgoId || prepared.clientOid,
    };
  }
  return {
    ok: false,
    detail: pickErr(result) || '成本止损（全部平仓）提交失败',
    triggerPrice: prepared.triggerPrice,
    result,
  };
};

/** 成本价止损主流程：准备参数 → 闸门防重 → 提交 closePosition 单 */
const placeBreakevenStop = async pos => {
  const prepared = await prepareBreakevenStop(pos);
  const gate = await gateBeforeExitPlace({
    symbol: prepared.symbol,
    intent: PlaceIntent.EXIT_SL,
    tag: prepared.direction,
    alreadyOnBook: book =>
      (book.algoOrders || []).some(o => isBinanceStopAlgo(o, prepared.direction)),
    localDetail: '本机已挂成本止损缓存',
    restDetail: '已有止损委托（REST）',
  });
  if (gate.alreadyExists) {
    return {
      ok: true,
      alreadyExists: true,
      detail: gate.detail,
      triggerPrice: prepared.triggerPrice,
    };
  }
  if (!gate.allowPlace) {
    return { ok: false, detail: gate.detail, triggerPrice: prepared.triggerPrice };
  }
  return submitBreakevenStop(pos, prepared);
};

/** 从 bySym 映射里去掉已撤销的条件单，避免本轮误判「还在」 */
const dropAlgosFromBySym = (bySym, sym, orders) => {
  const dropKeys = new Set((orders || []).map(algoIdentityKey).filter(Boolean));
  bySym.set(
    sym,
    (bySym.get(sym) || []).filter(item => {
      const key = algoIdentityKey(item);
      return !key || !dropKeys.has(key);
    })
  );
};

/** 算止盈数量与触发价；比例量化后过小则改挂该档全仓 */
const prepareOneTakeProfit = async (pos, tier) => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const qty = requirePositive(pos.qty, `${pos.symbol} 持仓数量`);
  const rules = await getBinanceRules(pos.symbol);
  const mode = await getBinancePositionModeCached();
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const direction = positionDirection(pos);

  let closePct = Number(tier?.closePct) > 0 ? Number(tier.closePct) : RANGE_MONITOR_TP_CLOSE_PCT;
  let quantity = quantizeQuantity(qty * closePct, rules.stepSize, rules.quantityPrecision);
  let usedFull = false;
  if (isQtyTooSmall(quantity, rules)) {
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
  const trigger = floorToTick(tierTriggerPrice(entry, tier, direction), rules);
  if (!(trigger > 0)) {
    throw new RangeMonitorFatal(`${pos.symbol} 止盈触发价无效`, String(trigger));
  }

  return {
    symbol: pos.symbol,
    direction,
    positionSide: hedgeMode ? pos.positionSide || 'LONG' : undefined,
    trigger,
    quantity,
    closePct,
    usedFull,
    mult: tier?.mult,
    tpTag: `${direction}:${tier?.key || tier?.mult || 'tp'}`,
  };
};

/** 把 prepared 字段摊成 placeOneTakeProfit 的统一返回形状 */
const tpResultShape = (prepared, extra) => ({
  triggerPrice: prepared.trigger,
  quantity: prepared.quantity,
  mult: prepared.mult,
  closePct: prepared.closePct,
  usedFull: prepared.usedFull,
  ...extra,
});

/** 提交止盈条件单，成功则记 EXIT_TP 缓存 */
const submitOneTakeProfit = async (pos, prepared) => {
  const result = await placeFutureQtyTakeProfitAlgo({
    symbol: prepared.symbol,
    side: exitOrderSide(pos),
    quantity: prepared.quantity,
    triggerPrice: prepared.trigger,
    positionSide: prepared.positionSide,
    clientAlgoId: `rmtp${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
  });
  if (result?.ok) {
    rememberExitSuccess({
      symbol: prepared.symbol,
      intent: PlaceIntent.EXIT_TP,
      tag: prepared.tpTag,
    });
  }
  return tpResultShape(prepared, {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '止盈提交失败',
    result,
  });
};

/** 挂一档止盈：准备 → 闸门防重 → 提交 */
const placeOneTakeProfit = async (pos, tier) => {
  const prepared = await prepareOneTakeProfit(pos, tier);
  const gate = await gateBeforeExitPlace({
    symbol: prepared.symbol,
    intent: PlaceIntent.EXIT_TP,
    tag: prepared.tpTag,
    alreadyOnBook: book =>
      (book.algoOrders || []).some(o => isBinanceTakeProfitOrder(o, prepared.direction)),
    localDetail: '本机已挂止盈缓存',
    restDetail: '已有止盈委托（REST）',
  });
  if (gate.alreadyExists) {
    return tpResultShape(prepared, { ok: true, alreadyExists: true, detail: gate.detail });
  }
  if (!gate.allowPlace) {
    return tpResultShape(prepared, { ok: false, detail: gate.detail });
  }
  return submitOneTakeProfit(pos, prepared);
};

/** 算追踪激活价；已过武装点返回 null（立刻激活、不传 activatePrice） */
const calcTrailActivatePrice = ({ direction, entry, last, extremeXx, rules }) => {
  const armRaw = trailActivateRawPrice(entry, direction);
  const xx = Number(extremeXx);
  if (direction === 'LONG') {
    const alreadyPast = (xx > 0 && xx >= armRaw) || last >= armRaw;
    if (alreadyPast) return null;
    let activatePrice = ceilToTick(armRaw, rules);
    if (activatePrice <= last) activatePrice = ceilToTick(last * 1.001, rules);
    return activatePrice;
  }
  const alreadyPast = (xx > 0 && xx <= armRaw) || last <= armRaw;
  if (alreadyPast) return null;
  let activatePrice = floorToTick(armRaw, rules);
  if (activatePrice >= last) activatePrice = floorToTick(last * 0.999, rules);
  return activatePrice;
};

/** 准备追踪数量、方向与激活价 */
const prepareTrail = async (pos, lastPrice, extremeXx) => {
  const entry = requirePositive(pos.entryPrice, `${pos.symbol} 开仓均价`);
  const qty = requirePositive(pos.qty, `${pos.symbol} 持仓数量`);
  const last = requirePositive(lastPrice, `${pos.symbol} 最新价`);
  const rules = await getBinanceRules(pos.symbol);
  const mode = await getBinancePositionModeCached();
  const hedgeMode = Boolean(mode?.response?.dualSidePosition);
  const direction = positionDirection(pos);
  const trailQty = quantizeQuantity(qty, rules.stepSize, rules.quantityPrecision);
  if (!(trailQty > 0)) {
    throw new RangeMonitorFatal(`${pos.symbol} 追踪数量无效`, String(trailQty));
  }
  return {
    symbol: pos.symbol,
    direction,
    positionSide: hedgeMode ? pos.positionSide || 'LONG' : undefined,
    activatePrice: calcTrailActivatePrice({ direction, entry, last, extremeXx, rules }),
    trailQty,
    callbackRate: RANGE_MONITOR_TRAIL_CALLBACK_PCT,
  };
};

/** 把 prepared 字段摊成 placeTrail 的统一返回形状 */
const trailResultShape = (prepared, extra) => ({
  activatePrice: prepared.activatePrice,
  callbackRate: prepared.callbackRate,
  quantity: prepared.trailQty,
  ...extra,
});

/** 提交追踪止盈，成功则记 EXIT_TRAIL 缓存 */
const submitTrail = async (pos, prepared) => {
  const result = await placeFutureTrailingStopAlgo({
    symbol: prepared.symbol,
    side: exitOrderSide(pos),
    quantity: prepared.trailQty,
    ...(prepared.activatePrice != null && prepared.activatePrice > 0
      ? { activatePrice: prepared.activatePrice }
      : {}),
    callbackRate: prepared.callbackRate,
    positionSide: prepared.positionSide,
    clientAlgoId: `rmtr${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
  });
  if (result?.ok) {
    rememberExitSuccess({
      symbol: prepared.symbol,
      intent: PlaceIntent.EXIT_TRAIL,
      tag: prepared.direction,
    });
  }
  return trailResultShape(prepared, {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '追踪提交失败',
    result,
  });
};

/** 挂追踪止盈：准备 → 闸门防重 → 提交 */
const placeTrail = async (pos, lastPrice, extremeXx) => {
  const prepared = await prepareTrail(pos, lastPrice, extremeXx);
  const gate = await gateBeforeExitPlace({
    symbol: prepared.symbol,
    intent: PlaceIntent.EXIT_TRAIL,
    tag: prepared.direction,
    alreadyOnBook: book =>
      (book.algoOrders || []).some(o => isBinanceTrailingAlgo(o, prepared.direction)),
    localDetail: '本机已挂追踪缓存',
    restDetail: '已有追踪委托（REST）',
  });
  if (gate.alreadyExists) {
    return trailResultShape(prepared, { ok: true, alreadyExists: true, detail: gate.detail });
  }
  if (!gate.allowPlace) {
    return trailResultShape(prepared, { ok: false, detail: gate.detail });
  }
  return submitTrail(pos, prepared);
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
    if (!isRangeMonitorOpenOrder(o)) return;
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

    const { hasBox, hits } = await resolveCleanupBox({ exchange, symbol }, mult, feed);
    // 已破上沿仍有几何盒子 → 保留突破单等成交；仅无盒子才 out_of_range
    if (!hasBox) {
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
    // yy≤0（现价≥上沿）不算离开近带
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
  /** 仅处理这些 symbol（大写）；缺省=全部多头 */
  onlySymbols = null,
} = {}) => {
  const aborted = () => signal?.aborted;
  const log = entry => onLog?.(entry);
  const feed = priceFeed || getSharedMiniTickerFeed();
  const onlySet =
    Array.isArray(onlySymbols) && onlySymbols.length
      ? new Set(onlySymbols.map(s => String(s).toUpperCase()))
      : onlySymbols instanceof Set
        ? onlySymbols
        : null;

  if (!isLiveOrderEnabled()) {
    throw new RangeMonitorFatal('交易未解锁', '持仓处理');
  }

  onStatus?.('持仓：读取多头持仓…');
  // 优先复用本轮已有快照；缺省再读内存镜像（勿在此处 forceRest，否则又打 4 路签名 REST）
  const allPositions = await listAllLongPositions(binanceSnapshot, { onStatus });
  // 孤儿清理必须用「全账户持仓」建 active 集合；onlySymbols 只收窄后面挂撤循环。
  // 否则单币轻判时其它币止盈/止损/追踪会被当成孤儿全撤。
  let positions = allPositions;
  if (onlySet) {
    positions = allPositions.filter(p => onlySet.has(String(p.symbol || '').toUpperCase()));
  }
  if (aborted()) return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: 0, failed: 0, aborted: true };

  if (!positions.length) {
    onStatus?.('持仓：无多头持仓');
    return { armed: 0, tpPlaced: 0, trailPlaced: 0, skipped: 0, failed: 0, checked: 0 };
  }

  onStatus?.(`持仓：已载入 ${positions.length} 仓 · 同步条件单…`);
  let algos;
  try {
    // 有可用镜像则用内存；仅未打底时才 REST
    const liveSnapshot =
      binanceSnapshot?.ok && Array.isArray(binanceSnapshot.algoOrders)
        ? binanceSnapshot
        : await getBinanceAccountSnapshot({ ensureStarted: true });
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
  mergeRecentExitAlgos(bySym);
  const activePositions = new Set(
    allPositions.map(pos => positionKey(pos.symbol, pos.positionSide))
  );
  let orphanExitCancelled = 0;
  // 全量轮才扫孤儿；单币轻判不碰其它币出场单
  if (!onlySet) {
    for (const order of algos) {
      const side = String(order?.side || '').toUpperCase();
      const expectedPositionSide = side === 'BUY' ? 'SHORT' : side === 'SELL' ? 'LONG' : '';
      const orderPositionSide = String(order?.positionSide || 'BOTH').toUpperCase();
      const key = positionKey(
        order.symbol,
        orderPositionSide === 'BOTH' ? expectedPositionSide : orderPositionSide
      );
      if (!isExitOrderForPosition(order) || activePositions.has(key)) continue;
      try {
        const result =
          order.algoId != null || order.clientAlgoId
            ? await cancelFutureAlgoOrder({
                symbol: order.symbol,
                ...(order.algoId != null ? { algoId: order.algoId } : {}),
                ...(order.clientAlgoId ? { clientAlgoId: order.clientAlgoId } : {}),
              })
            : await cancelFutureOrder({
                symbol: order.symbol,
                orderId: order.orderId,
                origClientOrderId: order.clientOrderId,
              });
        if (result?.ok) {
          orphanExitCancelled += 1;
          log({
            type: 'orphan_exit_cancelled',
            exchange: 'binance',
            symbol: order.symbol,
            positionSide: orderPositionSide,
          });
        }
      } catch (e) {
        log({
          type: 'orphan_exit_cancel_failed',
          exchange: 'binance',
          symbol: order.symbol,
          detail: e?.message || String(e),
        });
      }
    }
  }
  const tpOrderCache = readTpOrderCache();
  // 必须用全账户持仓收钥匙；onlySymbols 轻判若只留当前币，会把其它币止盈缓存清掉 → 下一轮重复挂
  const activeTpCacheKeys = new Set(allPositions.map(tpCacheKey));
  Object.keys(tpOrderCache).forEach(key => {
    if (!activeTpCacheKeys.has(key)) {
      delete tpOrderCache[key];
      // key ≈ exchange:SYMBOL:side — 平仓后清出场成功缓存，避免挡下次武装（不动开仓缓存）
      const sym = String(key || '').split(':')[1];
      if (sym) {
        clearPlaceSuccessByIntent({
          exchange: 'binance',
          symbol: sym,
          intent: PlaceIntent.EXIT_SL,
        });
        clearPlaceSuccessByIntent({
          exchange: 'binance',
          symbol: sym,
          intent: PlaceIntent.EXIT_TP,
        });
        clearPlaceSuccessByIntent({
          exchange: 'binance',
          symbol: sym,
          intent: PlaceIntent.EXIT_TRAIL,
        });
      }
    }
  });
  writeTpOrderCache(tpOrderCache);
  // xx 缓存生命周期按全账户持仓，避免 onlySymbols 轻判误删其它币 sticky 极值
  const activeXxCacheKeys = new Set(
    allPositions.map(pos => `${pos.exchange}:${String(pos.symbol).toUpperCase()}:${pos.openTime}`)
  );
  [...xxKlineCache().keys()].forEach(key => {
    if (!activeXxCacheKeys.has(key)) xxKlineCache().delete(key);
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
    const directionEarly = positionDirection(pos);
    const quote = await feed.ensureQuote(pos.symbol, '持仓');
    const liveForXx = directionalExtreme(quote.last, pos.markPrice, directionEarly);
    if (pos.openTimeSource && pos.openTimeSource !== 'trade') {
      log({
        type: 'open_time_fallback',
        exchange: pos.exchange,
        symbol: pos.symbol,
        openTime: pos.openTime,
        source: pos.openTimeSource,
        detail: '未解析到成交开仓时间，xx 窗口可能偏晚',
      });
    }

    let xxPack;
    if (!(pos.openTime > 0)) {
      // 无真实开仓时间时仍用最新/标记价做 xx，避免漏挂成本止损；其它依赖小时K的档位可能偏保守
      if (!(liveForXx > 0)) {
        skipped += 1;
        log({
          type: 'open_time_unavailable',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: '历史成交中未找到真实开仓时间，且无最新价，本轮跳过',
        });
        continue;
      }
      xxPack = { xx: liveForXx, a: null, b: liveForXx, bars: 0, note: 'openTime缺失，xx=live' };
      log({
        type: 'open_time_live_fallback',
        exchange: pos.exchange,
        symbol: pos.symbol,
        xx: liveForXx,
      });
    } else {
      xxPack = await fetchHighSinceOpenXx({
        symbol: pos.symbol,
        exchange: pos.exchange,
        openTimeMs: pos.openTime,
        liveLast: liveForXx,
        direction: directionEarly,
      });
    }
    if (xxPack?.rateLimited) {
      log({
        type: 'xx_kline_rate_limited',
        exchange: pos.exchange,
        symbol: pos.symbol,
        detail: xxPack.detail || 'Binance 限频冷却中，使用已有最高价缓存',
      });
    }
    let xx = xxPack?.xx;
    // 小时 K 暂不可用时，仍用最新/标记价兜底，避免已冲过 1.2E 却整轮跳过不出场
    if (!(xx > 0) && liveForXx > 0) {
      xx = liveForXx;
      log({
        type: 'xx_live_fallback',
        exchange: pos.exchange,
        symbol: pos.symbol,
        xx,
        detail: xxPack?.detail || '小时K不可用，xx=live',
      });
    }
    if (!(xx > 0)) {
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
const symAlgos = bySym.get(sym) || [];
    const direction = positionDirection(pos);
    const moveRatio = calcMoveRatio(entry, xx, direction);
    const stopOrders = symAlgos.filter(o => isBinanceStopAlgo(o, direction));
    let tpOrders = symAlgos.filter(o => isBinanceTakeProfitOrder(o, direction));
    const trailOrders = symAlgos.filter(o => isBinanceTrailingAlgo(o, direction));
    const rules = await getBinanceRules(pos.symbol);
    let breakevenStops = stopOrders.filter(o =>
      isBreakevenStopAlgo(o, entry, rules.tickSize, direction)
    );
    const slKey = `sl:${pos.exchange}:${sym}:${direction}`;

    // 已有重复成本止损：优先保留「有 algoId 的全平真单」，影子单只从本地摘掉不发撤单
    if (breakevenStops.length > 1) {
      const ranked = [...breakevenStops].sort((a, b) => {
        const score = o =>
          (isClosePositionAlgo(o) ? 4 : 0) +
          (o?.algoId != null || o?.orderId != null ? 2 : 0) +
          (o?._rememberedAt ? -1 : 0);
        return score(b) - score(a);
      });
      const keep = ranked[0];
      const dupes = ranked.slice(1);
      onStatus?.(`持仓：${pos.symbol} 成本止损重复×${breakevenStops.length}，撤多余…`);
      try {
        await cancelBreakevenStops(pos.symbol, dupes);
        dropAlgosFromBySym(bySym, sym, dupes);
        breakevenStops = [keep];
        log({
          type: 'sl_breakeven_deduped',
          exchange: pos.exchange,
          symbol: pos.symbol,
          cancelled: dupes.length,
        });
      } catch (e) {
        log({
          type: 'sl_breakeven_dedupe_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: e?.message || String(e),
        });
      }
    }

    // 仅明确的按数量成本止损才撤改全平（避免把全平回包里的 quantity 误判后循环撤挂）
    const qtyBreakevenStops = breakevenStops.filter(isQtyBasedStopAlgo);
    if (qtyBreakevenStops.length) {
      onStatus?.(`持仓：${pos.symbol} 成本止损非全平，改挂全部平仓…`);
      try {
        await cancelBreakevenStops(pos.symbol, qtyBreakevenStops);
        dropAlgosFromBySym(bySym, sym, qtyBreakevenStops);
        breakevenStops = breakevenStops.filter(o => !isQtyBasedStopAlgo(o));
        slArmedAt.delete(slKey); // 避免冷却挡住立刻重挂 closePosition
        log({
          type: 'sl_breakeven_qty_upgraded',
          exchange: pos.exchange,
          symbol: pos.symbol,
          cancelled: qtyBreakevenStops.length,
        });
      } catch (e) {
        log({
          type: 'sl_breakeven_qty_upgrade_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: e?.message || String(e),
        });
      }
    }

    // 盈利达到追踪武装点后撤掉开仓价全仓止损，改由追踪止盈保护。
    if (hasReachedTrailArm(entry, xx, direction) && breakevenStops.length) {
      const cancelCount = breakevenStops.length;
      onStatus?.(`持仓：${pos.symbol} 已达追踪武装点，撤开仓价止损…`);
      try {
        await cancelBreakevenStops(pos.symbol, breakevenStops);
        dropAlgosFromBySym(bySym, sym, breakevenStops);
        breakevenStops = [];
        slArmedAt.delete(slKey);
        log({
          type: 'sl_breakeven_cancelled',
          exchange: pos.exchange,
          symbol: pos.symbol,
          xx,
          count: cancelCount,
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
    const recentSlArm =
      Date.now() - (slArmedAt.get(slKey) || 0) < SL_ARM_COOLDOWN_MS;
    const liveStopOrders = (bySym.get(sym) || []).filter(o =>
      isBinanceStopAlgo(o, direction)
    );
    if (
      hasReachedGainMult(entry, xx, direction, RANGE_MONITOR_SL_ARM_MULT) &&
      !liveStopOrders.length &&
      !trailOrders.length &&
      !slPlaceInFlight.has(slKey) &&
      !recentSlArm
    ) {
      slPlaceInFlight.add(slKey);
      onStatus?.(`持仓：${pos.symbol} 盈利≥20%，挂成本止损…`);
      let result;
      try {
        result = await placeBreakevenStop(pos);
      } finally {
        slPlaceInFlight.delete(slKey);
      }
      if (result?.ok && result.alreadyExists) {
        skipped += 1;
        log({
          type: 'sl_already_exists',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          detail: result.detail,
        });
      } else if (result?.ok) {
        armed += 1;
        slArmedAt.set(slKey, Date.now());
        const placed = {
          type: 'STOP_MARKET',
          orderType: 'STOP_MARKET',
          algoType: 'CONDITIONAL',
          side: exitOrderSide(pos),
          positionSide: pos.positionSide,
          triggerPrice: result.triggerPrice,
          closePosition: true,
          algoId: result.algoId,
          clientAlgoId: result.clientAlgoId || result.result?.response?.clientAlgoId,
        };
        bySym.set(sym, [...(bySym.get(sym) || []), placed]);
        rememberRecentExitAlgo(sym, placed);
        log({
          type: 'sl_armed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          triggerPrice: result.triggerPrice,
          algoId: result.algoId,
          clientAlgoId: placed.clientAlgoId,
        });
      } else {
        failed += 1;
        log({
          type: 'sl_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          detail: result?.detail,
        });
        onStatus?.(`持仓止损失败：${pos.symbol} ${result?.detail || ''}`);
      }
      await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    } else if (
      hasReachedGainMult(entry, xx, direction, RANGE_MONITOR_SL_ARM_MULT) &&
      !liveStopOrders.length &&
      !trailOrders.length &&
      (slPlaceInFlight.has(slKey) || recentSlArm)
    ) {
      log({
        type: 'sl_place_inflight_skip',
        exchange: pos.exchange,
        symbol: pos.symbol,
        reason: slPlaceInFlight.has(slKey) ? 'inflight' : 'cooldown',
      });
    }

    // 固定止盈：同时最多一笔；按已实现盈利倍数递进换档
    const wantTier = selectWantedTpTier(entry, xx, direction);

    // 2.2 动态一档：盈利未达 20% 前按方向维护，使用滞后避免成本价附近抖动。
    const firstTier = tpTiersForDirection(direction)[0];
    const shouldArmFirst = shouldArmFirstTier(direction, entry, quote.last);
    const shouldCancelFirst = shouldCancelFirstTier(direction, entry, quote.last);
    const exactFirst = listFirstTierTakeProfitOrders(tpOrders, pos, entry, rules.tickSize);

    if (isInFirstTierDynamicPhase(moveRatio, trailOrders)) {
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
          tpArmedAt.delete(`${pos.exchange}:${sym}:${direction}:${firstTier.key}`);
          tpOrders = tpOrders.filter(order => !exactFirst.includes(order));
          log({ type: 'tp_first_cancelled', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, quote: quote.last });
        } else if (duplicateOrders.length) {
          tpOrders = [keepOrder, ...tpOrders.filter(order => !exactFirst.includes(order) && order !== keepOrder)];
        }
      } else if (!tpOrders.length && shouldArmFirst && !tpCacheHas(tpOrderCache, pos, firstTier.key)) {
        // 一档曾成功挂出（含已成交）则不再重挂；仅主动撤档清缓存后才允许再挂。
        const placeKey = `${pos.exchange}:${sym}:${direction}:${firstTier.key}`;
        const recentTp =
          Date.now() - (tpArmedAt.get(placeKey) || 0) < TP_ARM_COOLDOWN_MS;
        if (tpPlaceInFlight.has(placeKey) || recentTp) {
          skipped += 1;
          log({
            type: 'tp_place_inflight_skip',
            exchange: pos.exchange,
            symbol: pos.symbol,
            tier: firstTier.key,
            reason: tpPlaceInFlight.has(placeKey) ? 'inflight' : 'cooldown',
          });
        } else {
          tpPlaceInFlight.add(placeKey);
          let tpResult;
          try {
            tpResult = await placeOneTakeProfit(pos, firstTier);
          } finally {
            tpPlaceInFlight.delete(placeKey);
          }
          if (tpResult?.ok && tpResult.alreadyExists) {
            skipped += 1;
            tpCacheAdd(tpOrderCache, pos, firstTier.key);
            writeTpOrderCache(tpOrderCache);
            log({
              type: 'tp_already_exists',
              exchange: pos.exchange,
              symbol: pos.symbol,
              tier: firstTier.key,
              detail: tpResult.detail,
            });
          } else if (tpResult?.ok) {
            tpPlaced += 1;
            tpArmedAt.set(placeKey, Date.now());
            tpCacheAdd(tpOrderCache, pos, firstTier.key);
            writeTpOrderCache(tpOrderCache);
            const placed = {
              type: 'TAKE_PROFIT_MARKET',
              orderType: 'TAKE_PROFIT_MARKET',
              algoType: 'CONDITIONAL',
              side: exitOrderSide(pos),
              positionSide: pos.positionSide,
              triggerPrice: tpResult.triggerPrice,
              clientAlgoId: tpResult.result?.response?.clientAlgoId,
            };
            tpOrders = [placed];
            bySym.set(sym, [...(bySym.get(sym) || []), placed]);
            rememberRecentExitAlgo(sym, placed);
            log({ type: 'tp_first_placed', exchange: pos.exchange, symbol: pos.symbol, entryPrice: entry, quote: quote.last, triggerPrice: tpResult.triggerPrice });
          } else {
            failed += 1;
            log({ type: 'tp_failed', exchange: pos.exchange, symbol: pos.symbol, detail: tpResult?.detail });
          }
          await sleep(RANGE_MONITOR_PLACE_GAP_MS);
        }
      } else if (!tpOrders.length && shouldArmFirst && tpCacheHas(tpOrderCache, pos, firstTier.key)) {
        skipped += 1;
      }
    }

    // 2.3 固定止盈：盈利达 20% 后递进后续档（多 1.5/2.0；空 0.7E）。
    if (wantTier && isInFixedTpPhase(moveRatio)) {
      const targetTrigger = tierTriggerPrice(entry, wantTier, direction);
      const hasExact = hasTpOrderAtTrigger(tpOrders, targetTrigger, rules.tickSize);
      const cachedExact = tpCacheHas(tpOrderCache, pos, wantTier.key);

      if (cachedExact || hasExact) {
        if (hasExact) {
          tpCacheAdd(tpOrderCache, pos, wantTier.key);
          writeTpOrderCache(tpOrderCache);
        }
        skipped += 1;
      } else if (!tpOrders.length) {
        const placeKey = `${pos.exchange}:${sym}:${direction}:${wantTier.key}`;
        const recentTp =
          Date.now() - (tpArmedAt.get(placeKey) || 0) < TP_ARM_COOLDOWN_MS;
        if (tpPlaceInFlight.has(placeKey) || recentTp) {
          skipped += 1;
          log({
            type: 'tp_place_inflight_skip',
            exchange: pos.exchange,
            symbol: pos.symbol,
            tier: wantTier.key,
            reason: tpPlaceInFlight.has(placeKey) ? 'inflight' : 'cooldown',
          });
        } else {
          tpPlaceInFlight.add(placeKey);
          let tpResult;
          try {
            tpResult = await placeOneTakeProfit(pos, wantTier);
          } finally {
            tpPlaceInFlight.delete(placeKey);
          }
          if (tpResult?.ok && tpResult.alreadyExists) {
            skipped += 1;
            tpCacheAdd(tpOrderCache, pos, wantTier.key);
            writeTpOrderCache(tpOrderCache);
            log({
              type: 'tp_already_exists',
              exchange: pos.exchange,
              symbol: pos.symbol,
              tier: wantTier.key,
              detail: tpResult.detail,
            });
          } else if (tpResult?.ok) {
            tpPlaced += 1;
            tpArmedAt.set(placeKey, Date.now());
            tpCacheAdd(tpOrderCache, pos, wantTier.key);
            writeTpOrderCache(tpOrderCache);
            const placed = {
              type: 'TAKE_PROFIT_MARKET',
              orderType: 'TAKE_PROFIT_MARKET',
              algoType: 'CONDITIONAL',
              side: exitOrderSide(pos),
              positionSide: pos.positionSide,
              triggerPrice: tpResult.triggerPrice,
              clientAlgoId: tpResult.result?.response?.clientAlgoId,
            };
            tpOrders = [...tpOrders, placed];
            bySym.set(sym, [...(bySym.get(sym) || []), placed]);
            rememberRecentExitAlgo(sym, placed);
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
// 2.5 追踪：盈利超过追踪武装点（多 1.4E / 空 0.75E）；已越过则立刻激活（无 activatePrice）
    const trailKey = `trail:${pos.exchange}:${sym}:${direction}`;
    const liveTrailOrders = (bySym.get(sym) || []).filter(o =>
      isBinanceTrailingAlgo(o, direction)
    );
    if (
      hasReachedTrailArm(entry, xx, direction) &&
      !liveTrailOrders.length &&
      !trailPlaceInFlight.has(trailKey)
    ) {
      trailPlaceInFlight.add(trailKey);
      onStatus?.(
        direction === 'LONG'
          ? `持仓：${pos.symbol} 最高价已超 1.4E，立刻挂追踪（无激活价 · 回撤 ${RANGE_MONITOR_TRAIL_CALLBACK_PCT}%）…`
          : `持仓：${pos.symbol} 最低价已破 0.75E，立刻挂追踪（无激活价 · 回撤 ${RANGE_MONITOR_TRAIL_CALLBACK_PCT}%）…`
      );
      let trailResult;
      try {
        trailResult = await placeTrail(pos, quote.last, xx);
      } finally {
        trailPlaceInFlight.delete(trailKey);
      }
      if (trailResult?.ok && trailResult.alreadyExists) {
        skipped += 1;
        log({
          type: 'trail_already_exists',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: trailResult.detail,
        });
      } else if (trailResult?.ok) {
        trailPlaced += 1;
        const trailPlacedAlgo = {
          type: 'TRAILING_STOP_MARKET',
          orderType: 'TRAILING_STOP_MARKET',
          algoType: 'CONDITIONAL',
          side: exitOrderSide(pos),
          positionSide: pos.positionSide,
          clientAlgoId: trailResult.result?.response?.clientAlgoId,
        };
        bySym.set(sym, [...(bySym.get(sym) || []), trailPlacedAlgo]);
        rememberRecentExitAlgo(sym, trailPlacedAlgo);
        log({
          type: 'trail_placed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          entryPrice: entry,
          xx,
          activatePrice: trailResult.activatePrice,
          immediate: trailResult.activatePrice == null,
          callbackRate: trailResult.callbackRate,
        });
      } else {
        failed += 1;
        log({
          type: 'trail_failed',
          exchange: pos.exchange,
          symbol: pos.symbol,
          detail: trailResult?.detail,
        });
        onStatus?.(`持仓追踪失败：${pos.symbol} ${trailResult?.detail || ''}`);
      }
      await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    } else if (trailPlaceInFlight.has(trailKey)) {
      log({
        type: 'trail_place_inflight_skip',
        exchange: pos.exchange,
        symbol: pos.symbol,
      });
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

    // 已走出盒子（上破或下破）不计「在区间」；「破」计数仍仅=近带内实挂被 -2021
    // 上破同时也不挂；下破同样不算在区间（与回测标记日 / 漏斗口径一致）
    if (getMonitorLeftRange(candles, row, quote.last)) {
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
    binanceSnapshot,
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
