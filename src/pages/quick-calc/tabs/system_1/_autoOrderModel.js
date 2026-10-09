import { DEFAULT_LADDER } from '../backtest/_ladderRules';
import { MIN_LISTING_DAYS } from '../backtest/_rise100Rules';
import { isBreakoutHistoricalHigh } from '@root/src/utils/kline-pattern';
import { getAllFutureDailyKlines } from '@root/src/container/market';
import { placeFutureBatchLimitOrders as placeBitgetBatchLimit, placeFutureMarketOrder as placeBitgetMarket } from '@root/src/container/bitget/api/order';
import {
  placeFutureBatchLimitOrders as placeBinanceBatchLimit,
  placeFutureMarketOrder as placeBinanceMarket,
} from '@root/src/container/binance/api/order';
import { getSinglePosition as getBitgetPosition, getPendingOrders as getBitgetPendingOrders } from '@root/src/container/bitget/api/query';
import { getPositionMode as getBinancePositionMode } from '@root/src/container/binance/api/query';
import {
  getContracts as getBinanceContracts,
  getFutureFundingRate as getBinanceFundingRate,
} from '@root/src/container/binance/api';
import { getBinanceAccountSnapshot } from '@root/src/container/binance/accountMirror';
import { getFutureFundingRate as getBitgetFundingRate } from '@root/src/container/bitget/api';
import { getFutureTicker } from '@root/src/container/market';
import { getTradeSession } from '@root/src/utils/tradeSession';
import { withMarketFetchGate } from '../_marketFetchGate';
import { isBlacklistedSymbol } from '../_symbolBlacklist';

/**
 * 自动下单模型（现在会真的往交易所发签名请求，但用的是 mock/占位 API Key）
 * -----------------------------------------------------------------
 * 触发条件：某币对当日涨幅（当日最高价 / 开盘价 - 1）达到设定阈值（默认 80%）。
 * 下单模型直接复用 tabs/backtest/_ladderRules.js 里回测验证过的阶梯空单参数：
 *   - 以当日开盘价为基准，按 DEFAULT_LADDER.levels 的倍数挂空（默认四档）
 *   - 下单前拉最新价：凡档位价 ≤ 最新价（post-only/GTX 必被拒）的档，合并名义金额
 *     打一笔市价开空；其余档仍批量挂限价（Bitget post_only / Binance GTX）
 *   - 自动侧只负责开仓；不附带交易所止损，也不做本地止损/止盈/结构失效市价平仓
 *     ——平仓委托由用户自行处理
 *
 * ⚠️ 当前状态：submitLadderPlan 会调用
 * container/bitget/api/order.js、container/binance/api/order.js 里真实的签名下单
 * 请求（endpoint、参数都是按官方文档 + 实测响应验证过路径确实存在）。签名这一步
 * 两边都已经挪到 workers/exchange-proxy 这个 Cloudflare Worker 里做——Bitget 走
 * HMAC-SHA256、Binance 走 Ed25519，浏览器只是把「调哪个接口、带什么参数」转发过去，
 * 私钥/API Secret/Passphrase 都不出现在浏览器里，见 utils/exchangeProxy.js。
 * 本地用的是占位 token（.env.development 里的默认值），交易所会返回签名/鉴权失败
 * —— 这是故意的：先跑通请求构造，在浏览器 Network 面板或本函数返回值里核对
 * url/body/响应，参数确认没问题后再把 Worker 换真实凭证。
 *
 * ⚠️ 批量下单成功时的响应结构（Bitget 的 data.successList/failureList、Binance 按
 * 请求顺序返回的数组）是按官方文档写的 applyBatchResult，还没能用真实 Key 验证过，
 * 换真实 Key 后第一次下单建议核对一下实际响应形状对不对。
 *
 * ⚠️ 接真实资金前还必须处理：
 *   1. Worker 用两级 token 区分风险：PROXY_TRADE_TOKEN（全权限，GET+POST）只放本地
 *      .env.development，绝不进 CI；PROXY_READONLY_TOKEN（只放行 GET）才允许打进
 *      GitHub Actions Secret / 公开发布的 bundle（Bitget 的历史仓位查询就是线上功能，
 *      这个 token 必然会被人从 bundle 里看到）。这个开关本身不下单，但如果哪天改
 *      GATSBY_EXCHANGE_PROXY_TOKEN 时手滑填成了 trade token，线上发布出去就等于
 *      把下单权限重新公开了——改这两个 token 的值时务必确认填的是哪一个。
 *   2. 合约精度 / 最小下单量 / 合约面值（getContracts 能取到），把 notional 换算成
 *      交易所要求的张数或数量（现在直接传的是浮点数量，交易所大概率会因精度报错）
 *   3. 杠杆倍数、单向/双向持仓模式等账户级参数（双向持仓模式下 Bitget 需要
 *      tradeSide、Binance 需要 positionSide，目前都没处理）
 *   4. 风控：单币种最大仓位、总敞口上限、下单失败重试策略
 *
 * 下单前置检查：
 *   0. high100 资格（与回测一致）：拉全量日 K；上市未满 30 天、或 max(当日最高, 开盘×4) 为历史新高 → skipped
 *   1. checkExistingExposure 查该币对「同方向」是否已有持仓或未成交开仓委托
 * （Bitget: single-position + orders-pending；Binance: positionRisk + openOrders），
 * 开多只看多头、开空只看空头；对面方向不挡。查询本身失败时保守按「已有仓位」处理。
 *   2. checkFundingRate：资金费率低于 -1% → skipped
 *
 * LIVE_NOTIONAL_SCALE 控制 DEFAULT_LADDER 每档下单金额相对回测配置的缩放比例，只影响
 * 这里的实盘下单，不影响 backtest 那边的回测计算（那边仍然读原始 DEFAULT_LADDER）。
 * 参数/精度/持仓模式已验证通过，现在是 1（不缩放，按 DEFAULT_LADDER 原始金额下单）。
 *
 * ⚠️ 下单开关现在是运行时判断（isLiveOrderEnabled），不再是编译时固定值：本地
 * .env.development 里 GATSBY_ENABLE_AUTO_ORDER=true 依然直接放行（行为不变）；线上
 * 没有这个变量，改成看有没有一个还没过期的交易 session——这个 session 只能通过
 * SurgeAlert 页面的密码解锁弹窗换来（见 utils/tradeSession.js，密码校验在
 * workers/exchange-proxy），没解锁过就跟以前一样直接短路返回 auto_order_disabled，
 * 不会碰任何网络请求。币对筛选 / 行情轮询走的是完全独立的 getMergedTradingPairs /
 * getFutureKlineData，不受这个开关影响。
 */

// 不缩放，按 DEFAULT_LADDER 原始金额下单（不改 DEFAULT_LADDER 本身，backtest 页面还在用它)
const LIVE_NOTIONAL_SCALE = 1;
/** 实盘止损：基准开盘价 × 该倍数（回测仍用 DEFAULT_LADDER.stopMult=5） */
export const LIVE_STOP_MULT = 10;

// 本地开发直接放行；线上没有 GATSBY_ENABLE_AUTO_ORDER，取决于有没有解锁过的交易 session
export const isLiveOrderEnabled = () =>
  process.env.GATSBY_ENABLE_AUTO_ORDER === 'true' || Boolean(getTradeSession());

export const AUTO_ORDER_PCT_KEY = 'surge-alert-auto-order-pct';
export const AUTO_ORDER_ENABLED_KEY = 'surge-alert-auto-order-enabled';
export const AUTO_ORDER_BATCHES_KEY = 'surge-alert-auto-order-batches';
export const DEFAULT_AUTO_ORDER_PCT = 80;

export const EXIT_REASON_LABEL = {
  stop: '止损',
  target: '止盈',
  structure: '结构失效',
};

export const STATUS_LABEL = {
  submitting: '提交中…',
  open: '已挂单',
  partial: '部分成功',
  unknown: '结果待确认',
  closed: '已离场',
  failed: '提交失败',
  skipped: '已跳过',
};

export const SKIP_REASON_LABEL = {
  has_position: '已有持仓',
  has_orders: '已有未成交委托',
  query_failed: '查询持仓/委托失败',
  query_error: '查询持仓/委托异常',
  api_key_missing: '未配置交易所 API Key',
  unsupported_exchange: '不支持的交易所',
  auto_order_disabled: '自动下单未启用/未解锁',
  funding_rate_too_low: '资金费率低于 -1%',
  funding_rate_unavailable: '资金费率不可用',
  funding_rate_query_failed: '资金费率查询失败',
  listing_too_new: `上市未满 ${MIN_LISTING_DAYS} 天`,
  ath_breakout: 'max(当日最高,开盘×4) 为历史新高',
  history_unavailable: '历史K线不足，无法校验上市天数',
  blacklisted: '黑名单币对（稳定币等）',
};

const LISTING_MS = MIN_LISTING_DAYS * 24 * 60 * 60 * 1000;

/**
 * high100 自动下单资格：与回测标记日口径一致
 * - 上市未满 MIN_LISTING_DAYS（30）天 → 排除
 * - max(当日最高价, 开盘×4) 相对此前全部日 K 为历史新高突破 → 排除
 *
 * 仅在即将下单时拉取完整日 K（新币全量很少；老币也只触发一次/天）。
 */
export const checkHigh100Eligibility = async ({ symbol, exchange, candleTs, open: openHint, high: highHint }) => {
  try {
    const candles = await getAllFutureDailyKlines({ symbol }, exchange);
    const sorted = [...(candles || [])]
      .filter(c => Array.isArray(c) && c.length >= 5 && Number.isFinite(Number(c[0])))
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (sorted.length < 2) {
      return { allowed: false, reason: 'history_unavailable', listingDays: 0 };
    }

    const listedAt = Number(sorted[0][0]);
    const markerTs = Number.isFinite(Number(candleTs))
      ? Number(candleTs)
      : Number(sorted[sorted.length - 1][0]);

    if (!Number.isFinite(listedAt) || !Number.isFinite(markerTs)) {
      return { allowed: false, reason: 'history_unavailable', listingDays: 0 };
    }

    const listingDays = Math.floor((markerTs - listedAt) / (24 * 60 * 60 * 1000));
    if (markerTs - listedAt < LISTING_MS) {
      return { allowed: false, reason: 'listing_too_new', listingDays };
    }

    const markerDay = new Date(markerTs).toISOString().slice(0, 10);
    const markerCandle =
      sorted.find(c => new Date(Number(c[0])).toISOString().slice(0, 10) === markerDay) ||
      sorted[sorted.length - 1];
    const open = Number(openHint) > 0 ? Number(openHint) : Number(markerCandle?.[1]);
    const high = Number(highHint) > 0 ? Number(highHint) : Number(markerCandle?.[2]);
    if (!(open > 0) || !(high > 0)) {
      return { allowed: false, reason: 'history_unavailable', listingDays };
    }

    const athProbe = Math.max(high, open * 4);
    const ath = isBreakoutHistoricalHigh(markerTs, sorted, athProbe);
    if (ath.isBreakout) {
      return {
        allowed: false,
        reason: 'ath_breakout',
        listingDays,
        prevAth: ath.prevAth,
        prevAthDate: ath.prevAthDate,
        athProbe,
        open,
        high,
      };
    }

    return { allowed: true, listingDays, candleCount: sorted.length };
  } catch (e) {
    console.warn('[AutoOrder] high100 eligibility', symbol, e);
    return { allowed: false, reason: 'history_unavailable', listingDays: 0 };
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

/** UTC 日 00:00 的毫秒时间戳（与 1Dutc K 线、todayKey 对齐） */
export const utcDayStartTs = ts => {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const loadAutoOrderPct = () => {
  if (typeof window === 'undefined') return DEFAULT_AUTO_ORDER_PCT;
  const n = parseFloat(localStorage.getItem(AUTO_ORDER_PCT_KEY));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AUTO_ORDER_PCT;
};

export const saveAutoOrderPct = pct => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTO_ORDER_PCT_KEY, String(pct));
};

export const loadAutoOrderEnabled = () => {
  if (typeof window === 'undefined') return true;
  const raw = localStorage.getItem(AUTO_ORDER_ENABLED_KEY);
  return raw === null ? true : raw === '1';
};

export const saveAutoOrderEnabled = enabled => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTO_ORDER_ENABLED_KEY, enabled ? '1' : '0');
};

export const loadAutoOrderBatches = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(AUTO_ORDER_BATCHES_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
};

export const saveAutoOrderBatches = batches => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTO_ORDER_BATCHES_KEY, JSON.stringify(batches));
  } catch (_) {
    /* ignore */
  }
};

/** 用当日开盘价把回测阶梯模型换算成可执行的挂单计划（金额按 LIVE_NOTIONAL_SCALE；止损用 LIVE_STOP_MULT） */
export const buildLadderPlan = ({
  symbol,
  exchange,
  open,
  triggerHigh,
  candleTs,
  ladder = DEFAULT_LADDER,
}) => {
  const legs = ladder.levels.map(level => {
    const price = open * level.mult;
    const notional = level.notional * LIVE_NOTIONAL_SCALE;
    return {
      mult: level.mult,
      price,
      notional,
      qty: price > 0 ? notional / price : 0,
    };
  });

  const markerDayStartTs = utcDayStartTs(candleTs) ?? utcDayStartTs(Date.now());

  return {
    id: `${todayKey()}:${exchange}:${symbol}`,
    symbol,
    exchange,
    open,
    legs,
    stopPrice: open * LIVE_STOP_MULT,
    targetPrice: open * ladder.targetMult,
    structureHigh: triggerHigh,
    exitOnNewHigh: !!ladder.exitOnNewHigh,
    /** 标记日 UTC 日界；结构失效必须严格晚于该日 */
    markerDayStartTs,
    candleTs: Number.isFinite(Number(candleTs)) ? Number(candleTs) : undefined,
    status: 'pending',
    createdAt: Date.now(),
  };
};

/**
 * 从查询结果里判断该币对在「指定方向」上是否已有持仓或未成交委托。
 * side: 'long' | 'short' —— 开多只看多头，开空只看空头（双向持仓下两边互不挡）。
 * ⚠️ Bitget / Binance 字段按官方文档；换真实 Key 后建议核对一次。
 */
const isLongHoldSide = holdSide => {
  const v = String(holdSide || '').toLowerCase();
  return v === 'long' || v === 'buy';
};

const isShortHoldSide = holdSide => {
  const v = String(holdSide || '').toLowerCase();
  return v === 'short' || v === 'sell';
};

const isBuySide = side => String(side || '').toLowerCase() === 'buy';
const isSellSide = side => String(side || '').toLowerCase() === 'sell';

/** 普通挂单是否算作该方向的「开仓侧」敞口（平仓/reduceOnly 不计） */
const isOpenSideOrder = (order, side) => {
  const reduceOnly = order.reduceOnly === true || order.reduceOnly === 'true' || order.reduceOnly === 'YES';
  if (reduceOnly) return false;
  const tradeSide = String(order.tradeSide || '').toLowerCase();
  if (tradeSide === 'close') return false;

  if (side === 'long') {
    if (!isBuySide(order.side)) return false;
    const ps = String(order.positionSide || '').toUpperCase();
    if (ps === 'SHORT') return false;
    return true;
  }
  if (side === 'short') {
    if (!isSellSide(order.side)) return false;
    const ps = String(order.positionSide || '').toUpperCase();
    if (ps === 'LONG') return false;
    return true;
  }
  return true;
};

const hasSidePosition = (exchange, positions, side) => {
  if (!Array.isArray(positions)) return false;
  if (exchange === 'bitget') {
    return positions.some(p => {
      const size = Math.abs(parseFloat(p.total ?? p.available ?? p.posSize ?? 0));
      if (!(size > 0)) return false;
      if (side === 'long') return isLongHoldSide(p.holdSide);
      if (side === 'short') return isShortHoldSide(p.holdSide);
      return true;
    });
  }
  if (exchange === 'binance') {
    return positions.some(p => {
      const amt = parseFloat(p.positionAmt || 0);
      if (!Number.isFinite(amt) || amt === 0) return false;
      const ps = String(p.positionSide || '').toUpperCase();
      if (ps === 'LONG') return side === 'long';
      if (ps === 'SHORT') return side === 'short';
      // 单向：正数多、负数空
      if (side === 'long') return amt > 0;
      if (side === 'short') return amt < 0;
      return true;
    });
  }
  return false;
};

const parseExposure = (exchange, posResult, orderResult, side = null) => {
  if (!posResult?.ok || !orderResult?.ok) {
    const pickErr = result =>
      result?.error ||
      result?.response?.msg ||
      result?.response?.message ||
      (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);
    return {
      exposed: true,
      reason: 'query_failed',
      detail: [pickErr(posResult), pickErr(orderResult)].filter(Boolean).join(' / ') || '持仓或委托查询返回失败',
      posOk: !!posResult?.ok,
      orderOk: !!orderResult?.ok,
      posHttpStatus: posResult?.httpStatus ?? null,
      orderHttpStatus: orderResult?.httpStatus ?? null,
    };
  }
if (exchange === 'bitget') {
    const positions = Array.isArray(posResult.response?.data) ? posResult.response.data : [];
    const hasPosition = side
      ? hasSidePosition('bitget', positions, side)
      : positions.some(p => Math.abs(parseFloat(p.total ?? p.available ?? 0)) > 0);
    const orders = orderResult.response?.data?.entrustedList;
    const list = Array.isArray(orders) ? orders : [];
    const hasOrders = side ? list.some(o => isOpenSideOrder(o, side)) : list.length > 0;
    return {
      exposed: hasPosition || hasOrders,
      reason: hasPosition ? 'has_position' : hasOrders ? 'has_orders' : null,
      side: side || 'any',
    };
  }

  if (exchange === 'binance') {
    const positions = Array.isArray(posResult.response) ? posResult.response : [];
    const hasPosition = side
      ? hasSidePosition('binance', positions, side)
      : positions.some(p => Math.abs(parseFloat(p.positionAmt || 0)) > 0);
    const orders = Array.isArray(orderResult.response) ? orderResult.response : [];
    const hasOrders = side ? orders.some(o => isOpenSideOrder(o, side)) : orders.length > 0;
    return {
      exposed: hasPosition || hasOrders,
      reason: hasPosition ? 'has_position' : hasOrders ? 'has_orders' : null,
      side: side || 'any',
    };
  }

  return { exposed: true, reason: 'unsupported_exchange' };
};

/**
 * 下单前置检查：该币对在指定方向上有没有持仓或未成交开仓委托。
 * @param {{ symbol: string, exchange: string, side?: 'long'|'short'|null }} opts
 *   side 缺省时保持旧行为（任意方向都算敞口）；传 long/short 则只检查该侧。
 * 查询失败时保守按「已有仓位」处理。
 */
export const checkFundingRate = async ({ symbol, exchange }) => {
  if (!isLiveOrderEnabled()) return { allowed: false, reason: 'auto_order_disabled' };
  try {
    const result = exchange === 'binance'
      ? await getBinanceFundingRate(symbol)
      : exchange === 'bitget'
        ? await getBitgetFundingRate(symbol)
        : null;
    if (!result) return { allowed: true, fundingRate: null, fundingRateUnavailable: true, reason: 'unsupported_exchange' };
    const fundingRate = Number(result.fundingRate);
    if (!Number.isFinite(fundingRate)) {
      return { allowed: true, fundingRate: null, fundingRateUnavailable: true, reason: 'funding_rate_unavailable' };
    }
    if (fundingRate < -0.01) {
      return { allowed: false, reason: 'funding_rate_too_low', fundingRate };
    }
    return { allowed: true, fundingRate };
  } catch (e) {
    console.error(`[SurgeAlert][FUNDING] ${exchange} ${symbol} 查询资金费率失败，继续下单`, e);
    return { allowed: true, fundingRate: null, fundingRateUnavailable: true, reason: 'funding_rate_query_failed', error: e.message };
  }
};

export const checkExistingExposure = async ({ symbol, exchange, side = null }) => {
  if (!isLiveOrderEnabled()) {
    return { exposed: true, reason: 'auto_order_disabled' };
  }
  try {
    if (exchange === 'bitget') {
      const [posResult, orderResult] = await Promise.all([
        getBitgetPosition({ symbol }),
        getBitgetPendingOrders({ symbol }),
      ]);
      return parseExposure('bitget', posResult, orderResult, side);
    }
    if (exchange === 'binance') {
      // 复用账户镜像（WS），避免暴涨扫描里按币对打 openOrders
      const snap = await getBinanceAccountSnapshot();
      if (!snap?.ok) {
        return {
          exposed: true,
          reason: 'query_failed',
          detail: snap?.error || 'account mirror not ready',
        };
      }
      const sym = String(symbol || '').toUpperCase();
      const positions = (snap.positions || []).filter(
        p => String(p?.symbol || '').toUpperCase() === sym
      );
      const orders = [
        ...(snap.openOrders || []).filter(o => String(o?.symbol || '').toUpperCase() === sym),
        ...(snap.algoOrders || []).filter(o => String(o?.symbol || '').toUpperCase() === sym),
      ];
      return parseExposure(
        'binance',
        { ok: true, response: positions },
        { ok: true, response: orders },
        side
      );
    }
    return { exposed: true, reason: 'unsupported_exchange' };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[SurgeAlert][EXPOSURE] ${exchange} ${symbol} 查询持仓/委托失败`, e);
    if (/请先配置 API Key|GATSBY_BINANCE|GATSBY_BITGET|签名代理/i.test(msg)) {
      return { exposed: true, reason: 'api_key_missing', detail: msg, error: msg };
    }
    return { exposed: true, reason: 'query_error', detail: msg, error: msg };
  }
};

// 浮点数换算出来的价格/数量做个粗糙的截位，避免请求体里出现一长串浮点误差尾数
const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));

// 币安每个合约的价格/数量精度不一样（pricePrecision/quantityPrecision），
// 统一按 8 位小数截位会超出交易所允许的最大精度（-1111 Precision is over the
// maximum defined for this asset），得按具体合约的精度四舍五入。exchangeInfo
// 一次请求拉回全部合约，缓存起来，同一次会话不用重复请求。
let binanceContractsPromise = null;
const getBinanceSymbolRules = async symbol => {
  if (!binanceContractsPromise) binanceContractsPromise = getBinanceContracts();
  const contracts = await binanceContractsPromise;
  const contract = contracts.find(c => c.symbol === symbol);
  const filters = Array.isArray(contract?.filters) ? contract.filters : [];
  const findFilter = (...types) => filters.find(filter => types.includes(filter.filterType));
  const priceFilter = findFilter('PRICE_FILTER');
  const lotFilter = findFilter('LOT_SIZE');
  const marketLotFilter = findFilter('MARKET_LOT_SIZE') || lotFilter;
  const notionalFilter = findFilter('NOTIONAL', 'MIN_NOTIONAL');
  return {
    pricePrecision: contract?.pricePrecision ?? 8,
    quantityPrecision: contract?.quantityPrecision ?? 8,
    tickSize: Number(priceFilter?.tickSize) || null,
    stepSize: Number(lotFilter?.stepSize) || null,
    minQty: Number(lotFilter?.minQty) || null,
    marketStepSize: Number(marketLotFilter?.stepSize) || null,
    marketMinQty: Number(marketLotFilter?.minQty) || null,
    minNotional: Number(notionalFilter?.minNotional) || null,
  };
};

export const quantizePrice = (price, tickSize, digits = 8) => {
  if (!(price > 0)) return 0;
  if (!(tickSize > 0)) return roundNum(price, digits);
  return roundNum(Math.ceil((price / tickSize) - 1e-10) * tickSize, digits);
};

export const quantizeQuantity = (qty, stepSize, digits = 8) => {
  if (!(qty > 0)) return 0;
  if (!(stepSize > 0)) return roundNum(qty, digits);
  return roundNum(Math.floor((qty / stepSize) + 1e-10) * stepSize, digits);
};

const getBinanceSymbolPrecision = async symbol => getBinanceSymbolRules(symbol);

// 账户是单向持仓还是双向持仓（Hedge Mode）决定要不要传 positionSide，同一次会话查一次就够。
let binancePositionModePromise = null;
const isBinanceHedgeMode = async () => {
  if (!binancePositionModePromise) binancePositionModePromise = getBinancePositionMode();
  const { response } = await binancePositionModePromise;
  return response?.dualSidePosition === true;
};

const EXCHANGE_BATCH_LIMIT_API = {
  bitget: ({ symbol, orders, stopLossPrice }) =>
    placeBitgetBatchLimit({
      symbol,
      stopLossPrice: stopLossPrice > 0 ? roundNum(stopLossPrice) : undefined,
      orders: orders.map(o => ({
        side: o.side,
        price: roundNum(o.price),
        size: roundNum(o.qty),
        clientOid: o.clientOid,
      })),
    }),
  binance: async ({ symbol, orders }) => {
    const [rules, hedgeMode] = await Promise.all([
      getBinanceSymbolRules(symbol),
      isBinanceHedgeMode(),
    ]);
    const rounded = orders.map(o => ({
      ...o,
      price: quantizePrice(o.price, rules.tickSize, rules.pricePrecision),
      qty: quantizeQuantity(o.qty, rules.stepSize, rules.quantityPrecision),
    }));
    const skipped = rounded
      .filter(o => o.qty <= 0 || (rules.minQty && o.qty < rules.minQty) ||
        (rules.minNotional && o.price * o.qty < rules.minNotional))
      .map(o => ({
        ...o,
        error: o.qty <= 0 ? '数量量化后为 0' : rules.minQty && o.qty < rules.minQty
          ? `数量低于最小值 ${rules.minQty}` : `名义金额低于最小值 ${rules.minNotional}`,
      }));
    const sendable = rounded.filter(o => !skipped.some(item => item.clientOid === o.clientOid));

    if (!sendable.length) return { request: null, response: null, httpStatus: null, ok: false, skipped };

    const result = await placeBinanceBatchLimit({
      orders: sendable.map(o => ({
        symbol,
        side: o.side === 'sell' ? 'SELL' : 'BUY',
        price: o.price,
        quantity: o.qty,
        newClientOrderId: o.clientOid,
        ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
      })),
    });
    return { ...result, skipped };
  },
};

/**
 * 公开行情最新价（下单前拆分「已越过档 / 仍可挂限价档」）。
 * 走 container/market 统一入口 + 行情门闩；Binance ticker 内部用 fetchWithBackoff 处理 418/429。
 */
const fetchLatestPrice = async (exchange, symbol) => {
  try {
    const ticker = await withMarketFetchGate(() => getFutureTicker(symbol, exchange));
    const price = Number(
      ticker?.lastPrice ?? ticker?.lastPr ?? ticker?.last ?? ticker?.close ?? ticker?.price
    );
    return price > 0 ? price : null;
  } catch (e) {
    console.warn(`[SurgeAlert] fetchLatestPrice ${exchange} ${symbol}`, e);
  }
  return null;
};

/**
 * 空单：档位价 ≤ 最新价 → post-only/GTX 会被拒，并入市价；其余仍挂限价。
 * @returns {{ crossed: object[], resting: object[], lastPrice: number|null }}
 */
export const splitLegsByLastPrice = (legs, lastPrice) => {
  if (!(lastPrice > 0) || !Array.isArray(legs)) {
    return { crossed: [], resting: [...(legs || [])], lastPrice: lastPrice > 0 ? lastPrice : null };
  }
  const crossed = [];
  const resting = [];
  legs.forEach(leg => {
    if (Number.isFinite(leg.price) && leg.price <= lastPrice) crossed.push(leg);
    else resting.push(leg);
  });
  return { crossed, resting, lastPrice };
};

const isExchangeOrderRejected = (exchange, result) => {
  if (!result?.ok) return true;
  const body = result.response;
  if (exchange === 'binance') {
    if (body && typeof body === 'object' && !Array.isArray(body) && body.code != null && !body.orderId) {
      return true;
    }
    return false;
  }
  if (exchange === 'bitget') {
    return body?.code != null && String(body.code) !== '00000';
  }
  return false;
};

/** 市价开空（非 reduceOnly）；数量按交易所精度量化 */
const placeMarketOpenShort = async ({ exchange, symbol, qty, clientOid, lastPrice }) => {
  if (exchange === 'bitget') {
    const size = roundNum(qty);
    if (!(size > 0)) {
      return { ok: false, skipped: true, error: '市价数量无效', request: null, response: null, qty: 0 };
    }
    const result = await placeBitgetMarket({
      symbol,
      side: 'sell',
      size,
      clientOid,
    });
    return { ...result, qty: size };
  }

  if (exchange === 'binance') {
    const [rules, hedgeMode] = await Promise.all([
      getBinanceSymbolRules(symbol),
      isBinanceHedgeMode(),
    ]);
    const roundedQty = quantizeQuantity(
      qty,
      rules.marketStepSize || rules.stepSize,
      rules.quantityPrecision
    );
    if (!(roundedQty > 0) || (rules.marketMinQty && roundedQty < rules.marketMinQty)) {
      return {
        ok: false,
        skipped: true,
        error: '市价数量量化后无效或低于最小值',
        request: null,
        response: null,
        qty: 0,
      };
    }
    if (rules.minNotional && lastPrice > 0 && roundedQty * lastPrice < rules.minNotional) {
      return {
        ok: false,
        skipped: true,
        error: `市价名义金额低于最小值 ${rules.minNotional}`,
        request: null,
        response: null,
        qty: roundedQty,
      };
    }
    const result = await placeBinanceMarket({
      symbol,
      side: 'SELL',
      quantity: roundedQty,
      newClientOrderId: clientOid,
      ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
    });
    return { ...result, qty: roundedQty };
  }

  return { ok: false, error: 'unsupported_exchange', request: null, response: null, qty: 0 };
};

/**
 * 把批量下单的响应按 clientOid 对回每一档。批量请求整体失败时（比如鉴权失败，交易所
 * 只返回一个顶层错误、没有逐笔结果），把同一个错误套用到每一档；四舍五入后数量为 0
 * 被跳过、没有实际发出去的档，单独标记，不跟交易所返回的结果混在一起对位。
 */
const applyBatchResult = (exchange, legs, result) => {
  const skippedOids = new Set((result.skipped || []).map(o => o.clientOid));
  const skippedResults = legs
    .filter(leg => skippedOids.has(leg.clientOid))
    .map(leg => ({ ...leg, ok: false, status: 'skipped', error: '数量四舍五入到合约精度后为 0，已跳过' }));
  const sendableLegs = legs.filter(leg => !skippedOids.has(leg.clientOid)); 

  let sentResults;
  if (exchange === 'binance' && Array.isArray(result.response)) {
    const responseByOid = new Map();
    result.response.forEach(item => {
      const oid = item?.clientOrderId || item?.origClientOrderId || item?.newClientOrderId;
      if (oid) responseByOid.set(oid, item);
    });
    const canUseIndex = result.response.length === sendableLegs.length;
    sentResults = sendableLegs.map((leg, index) => {
      const item = responseByOid.get(leg.clientOid) || (canUseIndex ? result.response[index] : null);
      if (!item) return { ...leg, ok: null, status: 'unknown', response: null, httpStatus: result.httpStatus };
      const rejected = item.code != null || item.msg && !item.orderId;
      return {
        ...leg,
        ok: !rejected,
        status: rejected ? 'rejected' : 'submitted',
        orderId: item.orderId ?? null,
        response: item,
        httpStatus: result.httpStatus,
        error: rejected ? item.msg : undefined,
      };
    });
  } else if (exchange === 'bitget') {
    const data = result.response?.data;
    if (data && (Array.isArray(data.successList) || Array.isArray(data.failureList))) {
      const successMap = new Map((data.successList || []).map(item => [item.clientOid, item]));
      const failureMap = new Map((data.failureList || []).map(item => [item.clientOid, item]));
      sentResults = sendableLegs.map(leg => {
        const success = successMap.get(leg.clientOid);
        return {
          ...leg,
          ok: !!success,
          status: success ? 'submitted' : 'rejected',
          orderId: success?.orderId || null,
          response: success || failureMap.get(leg.clientOid) || result.response,
          httpStatus: result.httpStatus,
        };
      });
    }
  }
  if (!sentResults) {
    const unknown = result.response == null || !result.ok;
    sentResults = sendableLegs.map(leg => ({
      ...leg,
      ok: unknown ? null : false,
      status: unknown ? 'unknown' : 'rejected',
      response: result.response,
      httpStatus: result.httpStatus,
      error: result.error || (unknown ? '未收到逐档响应，需查询确认' : undefined),
    }));
  }

  const byOid = new Map([...skippedResults, ...sentResults].map(r => [r.clientOid, r]));
  return legs.map(leg => byOid.get(leg.clientOid) || {
    ...leg,
    ok: null,
    status: 'unknown',
    error: '未收到该档位的交易所响应',
  });
};

const getBatchStatus = legs => {
  const submitted = legs.filter(leg => leg.status === 'submitted').length;
  const rejected = legs.filter(leg => leg.status === 'rejected' || leg.status === 'error').length;
  const unknown = legs.filter(leg => leg.status === 'unknown').length;
  const skipped = legs.filter(leg => leg.status === 'skipped').length;
  if (submitted > 0 && (rejected > 0 || unknown > 0 || skipped > 0)) return 'partial';
  if (submitted > 0) return 'open';
  if (unknown > 0) return 'unknown';
  if (skipped === legs.length) return 'skipped';
  return 'failed';
};

/** 阶梯限价挂出后，再挂交易所侧仓位止损（平掉该方向全部仓位）
 * ⚠️ 已停用：平仓由用户自行处理，不再自动挂交易所止损。
 */
export const placeExchangeStopLoss = async plan => {
  console.warn(
    `[SurgeAlert][STOP] placeExchangeStopLoss disabled — skip ${plan?.exchange} ${plan?.symbol}`
  );
  return {
    ok: false,
    status: 'disabled',
    error: 'auto_stop_disabled',
    clientOid: `surgestop${plan?.createdAt || Date.now()}`,
    submittedAt: Date.now(),
  };
};

/**
 * 提交阶梯开空：
 * 1) 拉最新价，把档位价 ≤ 最新价的档合并成一笔市价开空；
 * 2) 其余档批量挂 post-only / GTX 限价。
 * 不附带 presetStopLoss / 条件止损（平仓由用户自行下）。
 */
export const submitLadderPlan = async plan => {
  const legsWithOid = plan.legs.map((leg, idx) => ({ ...leg, clientOid: `surge${plan.createdAt}${idx}` }));

  if (isBlacklistedSymbol(plan?.symbol)) {
    return {
      ...plan,
      legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'skipped', error: 'blacklisted' })),
      status: 'skipped',
      skipReason: 'blacklisted',
      skipDetail: SKIP_REASON_LABEL.blacklisted,
    };
  }

  if (!isLiveOrderEnabled()) {
    return {
      ...plan,
      legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'error', error: 'auto_order_disabled' })),
      status: 'failed',
    };
  }

  const limitApi = EXCHANGE_BATCH_LIMIT_API[plan.exchange];

  if (!limitApi) {
    return { ...plan, legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'unsupported_exchange' })), status: 'failed' };
  }

  try {
    const lastPrice = await fetchLatestPrice(plan.exchange, plan.symbol);
    const { crossed, resting } = splitLegsByLastPrice(legsWithOid, lastPrice);

    console.warn(
      `[SurgeAlert][LADDER SPLIT] ${plan.exchange} ${plan.symbol} lastPrice=${lastPrice} crossed=${crossed.length} resting=${resting.length}`,
      crossed.map(l => l.mult),
      resting.map(l => l.mult)
    );

    const resultByOid = new Map();
    let marketRequest = null;
    let batchRequest = null;
    let marketMeta = null;

    if (crossed.length) {
      const marketNotional = crossed.reduce((sum, leg) => sum + (Number(leg.notional) || 0), 0);
      const marketQtyRaw = lastPrice > 0 ? marketNotional / lastPrice : 0;
      const marketClientOid = `surgemkt${plan.createdAt}`;
      try {
        const mktResult = await placeMarketOpenShort({
          exchange: plan.exchange,
          symbol: plan.symbol,
          qty: marketQtyRaw,
          clientOid: marketClientOid,
          lastPrice,
        });
        marketRequest = mktResult.request || null;
        const rejected = mktResult.skipped || isExchangeOrderRejected(plan.exchange, mktResult);
        const orderId =
          mktResult.response?.orderId ??
          mktResult.response?.data?.orderId ??
          null;
        marketMeta = {
          lastPrice,
          notional: marketNotional,
          qty: mktResult.qty ?? marketQtyRaw,
          clientOid: marketClientOid,
          ok: !rejected,
          orderId,
          error: rejected
            ? mktResult.error ||
              mktResult.response?.msg ||
              mktResult.response?.message ||
              '市价开空失败'
            : undefined,
        };
        console.warn(
          `[SurgeAlert][MARKET OPEN SHORT] ${plan.exchange} ${plan.symbol} notional=${marketNotional} qty=${marketMeta.qty} ok=${marketMeta.ok}`,
          mktResult
        );
        crossed.forEach(leg => {
          resultByOid.set(leg.clientOid, {
            ...leg,
            orderType: 'market',
            marketMerged: true,
            marketClientOid,
            fillPriceHint: lastPrice,
            ok: !rejected,
            status: rejected ? (mktResult.skipped ? 'skipped' : 'rejected') : 'submitted',
            orderId,
            response: mktResult.response,
            httpStatus: mktResult.httpStatus,
            error: marketMeta.error,
          });
        });
      } catch (e) {
        console.error(`[SurgeAlert][MARKET OPEN SHORT] ${plan.exchange} ${plan.symbol} 失败`, e);
        marketMeta = {
          lastPrice,
          notional: marketNotional,
          qty: marketQtyRaw,
          clientOid: marketClientOid,
          ok: false,
          error: e.message,
        };
        crossed.forEach(leg => {
          resultByOid.set(leg.clientOid, {
            ...leg,
            orderType: 'market',
            marketMerged: true,
            marketClientOid,
            fillPriceHint: lastPrice,
            ok: false,
            status: 'error',
            error: e.message,
          });
        });
      }
    }

    if (resting.length) {
      const result = await limitApi({
        symbol: plan.symbol,
        stopLossPrice: undefined,
        orders: resting.map(l => ({ side: 'sell', price: l.price, qty: l.qty, clientOid: l.clientOid })),
      });
      batchRequest = result.request;
      console.warn(
        `[SurgeAlert][BATCH ORDER] ${plan.exchange} ${plan.symbol} legs=${resting.length} ok=${result.ok} httpStatus=${result.httpStatus}`,
        result
      );
      applyBatchResult(plan.exchange, resting, result).forEach(leg => {
        resultByOid.set(leg.clientOid, { ...leg, orderType: leg.orderType || 'limit' });
      });
    }

    const legs = legsWithOid.map(
      leg =>
        resultByOid.get(leg.clientOid) || {
          ...leg,
          ok: null,
          status: 'unknown',
          error: '未收到该档位的交易所响应',
        }
    );
    const status = getBatchStatus(legs);

    return {
      ...plan,
      legs,
      lastPriceAtSubmit: lastPrice,
      marketOpen: marketMeta,
      marketRequest,
      batchRequest,
      status,
      peakPrice: plan.triggerHigh || plan.structureHigh || undefined,
    };
  } catch (e) {
    console.error(`[SurgeAlert][LADDER ORDER] ${plan.exchange} ${plan.symbol} 下单失败`, e);
    return {
      ...plan,
      legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'error', error: e.message })),
      status: 'failed',
    };
  }
};

/** 触发止损 / 止盈 / 结构失效时，用市价单平仓（真实签名请求，只有一笔，不用批量接口）
 * ⚠️ 已停用：用户自行平仓；保留函数避免旧引用报错，但绝不再发市价单。
 */
export const closeLadderPlan = async (batch, reason, exitPrice) => {
  console.warn(
    `[SurgeAlert][ORDER] closeLadderPlan disabled — skip market close ${batch?.exchange} ${batch?.symbol} reason=${reason}`
  );
  return {
    ...batch,
    status: batch.status === 'open' || batch.status === 'partial' ? batch.status : 'open',
    exitAttempt: {
      reason,
      exitPrice,
      skipped: true,
      error: 'auto_close_disabled',
      at: Date.now(),
    },
  };
};

/**
 * 用最新价判断已挂出的阶梯批次是否触发离场。
 * 止盈 targetMult（如 1.4×开盘）在触发时现价常已 >1× 但仍 < target，不能当成已到止盈；
 * 必须现价曾触及最低挂空档（或已有 peak）后，再回落到 target 才离场。
 *
 * @param {object} options
 * @param {number} [options.candleTs] 当前用于判定的日 K openTime；结构失效必须晚于标记日
 */
export const evaluateExit = (batch, lastPrice, options = {}) => {
  if (!Number.isFinite(lastPrice)) return null;
  if (Number.isFinite(batch.stopPrice) && lastPrice >= batch.stopPrice) return 'stop';

  const minEntry = Math.min(...(batch.legs || []).map(l => l.price).filter(n => Number.isFinite(n) && n > 0));
  const peak = Math.max(
    Number.isFinite(batch.peakPrice) ? batch.peakPrice : 0,
    lastPrice
  );
  if (
    Number.isFinite(batch.targetPrice) &&
    lastPrice <= batch.targetPrice &&
    Number.isFinite(minEntry) &&
    peak >= minEntry
  ) {
    return 'target';
  }
  if (batch.exitOnNewHigh && Number.isFinite(batch.structureHigh) && lastPrice > batch.structureHigh) {
    // 与回测一致：标记日当天不判结构失效（simulateLadder 要求 index > 0）
    if (!isPastMarkerDay(batch, options.candleTs)) return null;
    return 'structure';
  }
  return null;
};

/** 当前 K 线日是否已严格晚于批次标记日（结构失效前置条件） */
export const isPastMarkerDay = (batch, candleTs) => {
  const markerStart = Number.isFinite(batch?.markerDayStartTs)
    ? batch.markerDayStartTs
    : utcDayStartTs(batch?.candleTs);
  const candleStart = utcDayStartTs(candleTs);

  if (Number.isFinite(markerStart) && Number.isFinite(candleStart)) {
    return candleStart > markerStart;
  }

  // 旧 localStorage 批次没有标记日字段：创建后 24h 内保守不判结构失效
  if (Number.isFinite(batch?.createdAt) && Date.now() - batch.createdAt < DAY_MS) {
    return false;
  }
  return true;
}; 