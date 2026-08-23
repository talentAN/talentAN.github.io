import { DEFAULT_LADDER } from '../backtest/_ladderRules';
import { placeFutureBatchLimitOrders as placeBitgetBatchLimit, placeFutureMarketOrder as placeBitgetMarket } from '@root/src/container/bitget/api/order';
import { placeFutureBatchLimitOrders as placeBinanceBatchLimit, placeFutureMarketOrder as placeBinanceMarket } from '@root/src/container/binance/api/order';
import { getSinglePosition as getBitgetPosition, getPendingOrders as getBitgetPendingOrders } from '@root/src/container/bitget/api/query';
import { getPositionRisk as getBinancePositionRisk, getOpenOrders as getBinanceOpenOrders, getPositionMode as getBinancePositionMode } from '@root/src/container/binance/api/query';
import { getContracts as getBinanceContracts } from '@root/src/container/binance/api';
import { getTradeSession } from '@root/src/utils/tradeSession';

/**
 * 自动下单模型（现在会真的往交易所发签名请求，但用的是 mock/占位 API Key）
 * -----------------------------------------------------------------
 * 触发条件：某币对当日涨幅（当日最高价 / 开盘价 - 1）达到设定阈值（默认 80%）。
 * 下单模型直接复用 tabs/backtest/_ladderRules.js 里回测验证过的阶梯空单参数：
 *   - 以当日开盘价为基准，按 DEFAULT_LADDER.levels 的倍数一次性批量挂限价空单
 *     （Bitget: POST /api/v2/mix/order/batch-place-order；
 *      Binance: POST /fapi/v1/batchOrders），全部是 orderType=限价 + 只做 maker
 *      （Bitget force=post_only，Binance timeInForce=GTX），价格已经能立即成交
 *      的档会被交易所直接拒绝，不会意外变成吃单的 taker
 *   - 止损：开盘价 × stopMult；止盈：开盘价 × targetMult（用市价单平仓，只有一笔，
 *     不需要走批量接口）
 *   - 结构失效离场：现价重新站上触发时刻的当日最高价（exitOnNewHigh）
 *
 * ⚠️ 当前状态：submitLadderPlan / closeLadderPlan 会调用
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
 * 下单前置检查：checkExistingExposure 会先查该币对当前是否已有持仓或未成交委托
 * （Bitget: single-position + orders-pending；Binance: positionRisk + openOrders），
 * 只要命中任意一项就跳过自动下单（标记为 skipped，当天不再重复触发/查询）。查询本身
 * 失败时保守按「已有仓位」处理。这些接口返回的字段名是按官方文档写的，还没能用真实
 * Key 验证过实际结构，换真实 Key 后第一次触发建议核对一下。
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
  closed: '已离场',
  failed: '提交失败',
  skipped: '已跳过',
};

export const SKIP_REASON_LABEL = {
  has_position: '已有持仓',
  has_orders: '已有未成交委托',
  query_failed: '查询持仓/委托失败',
  query_error: '查询持仓/委托异常',
  unsupported_exchange: '不支持的交易所',
  auto_order_disabled: '自动下单未启用/未解锁',
};

const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
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

/** 用当日开盘价把回测阶梯模型换算成可执行的挂单计划（金额按 LIVE_NOTIONAL_SCALE 缩小） */
export const buildLadderPlan = ({ symbol, exchange, open, triggerHigh, ladder = DEFAULT_LADDER }) => {
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

  return {
    id: `${todayKey()}:${exchange}:${symbol}`,
    symbol,
    exchange,
    open,
    legs,
    stopPrice: open * ladder.stopMult,
    targetPrice: open * ladder.targetMult,
    structureHigh: triggerHigh,
    exitOnNewHigh: !!ladder.exitOnNewHigh,
    status: 'pending',
    createdAt: Date.now(),
  };
};

/**
 * 从查询结果里判断该币对是否已有持仓或未成交委托。
 * ⚠️ Bitget 的 total/available/entrustedList、Binance 的 positionAmt 都是按官方
 * 文档写的字段名，还没能用真实 Key 验证过实际返回结构，换真实 Key 后第一次触发
 * 建议核对一下。
 */
const parseExposure = (exchange, posResult, orderResult) => {
  if (!posResult?.ok || !orderResult?.ok) {
    return { exposed: true, reason: 'query_failed' };
  }

  if (exchange === 'bitget') {
    const positions = Array.isArray(posResult.response?.data) ? posResult.response.data : [];
    const hasPosition = positions.some(p => Math.abs(parseFloat(p.total ?? p.available ?? 0)) > 0);
    const orders = orderResult.response?.data?.entrustedList;
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    return { exposed: hasPosition || hasOrders, reason: hasPosition ? 'has_position' : hasOrders ? 'has_orders' : null };
  }

  if (exchange === 'binance') {
    const positions = Array.isArray(posResult.response) ? posResult.response : [];
    const hasPosition = positions.some(p => Math.abs(parseFloat(p.positionAmt || 0)) > 0);
    const orders = Array.isArray(orderResult.response) ? orderResult.response : [];
    const hasOrders = orders.length > 0;
    return { exposed: hasPosition || hasOrders, reason: hasPosition ? 'has_position' : hasOrders ? 'has_orders' : null };
  }

  return { exposed: true, reason: 'unsupported_exchange' };
};

/**
 * 下单前置检查：该币对当前有没有持仓或未成交委托，任意一项命中就不自动下单。
 * 查询请求本身失败（鉴权失败、网络异常等）时保守按「已有仓位」处理，不确定账户
 * 状态就不继续开新仓。
 */
export const checkExistingExposure = async ({ symbol, exchange }) => {
  if (!isLiveOrderEnabled()) {
    return { exposed: true, reason: 'auto_order_disabled' };
  }
  try {
    if (exchange === 'bitget') {
      const [posResult, orderResult] = await Promise.all([
        getBitgetPosition({ symbol }),
        getBitgetPendingOrders({ symbol }),
      ]);
      return parseExposure('bitget', posResult, orderResult);
    }
    if (exchange === 'binance') {
      const [posResult, orderResult] = await Promise.all([
        getBinancePositionRisk({ symbol }),
        getBinanceOpenOrders({ symbol }),
      ]);
      return parseExposure('binance', posResult, orderResult);
    }
    return { exposed: true, reason: 'unsupported_exchange' };
  } catch (e) {
    console.error(`[SurgeAlert][EXPOSURE] ${exchange} ${symbol} 查询持仓/委托失败`, e);
    return { exposed: true, reason: 'query_error', error: e.message };
  }
};

let orderSeq = 0;

// 浮点数换算出来的价格/数量做个粗糙的截位，避免请求体里出现一长串浮点误差尾数
const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));

// 币安每个合约的价格/数量精度不一样（pricePrecision/quantityPrecision），
// 统一按 8 位小数截位会超出交易所允许的最大精度（-1111 Precision is over the
// maximum defined for this asset），得按具体合约的精度四舍五入。exchangeInfo
// 一次请求拉回全部合约，缓存起来，同一次会话不用重复请求。
let binanceContractsPromise = null;
const getBinanceSymbolPrecision = async symbol => {
  if (!binanceContractsPromise) binanceContractsPromise = getBinanceContracts();
  const contracts = await binanceContractsPromise;
  const contract = contracts.find(c => c.symbol === symbol);
  return {
    pricePrecision: contract?.pricePrecision ?? 8,
    quantityPrecision: contract?.quantityPrecision ?? 8,
  };
};

// 账户是单向持仓还是双向持仓（Hedge Mode）决定要不要传 positionSide，同一次会话查一次就够。
let binancePositionModePromise = null;
const isBinanceHedgeMode = async () => {
  if (!binancePositionModePromise) binancePositionModePromise = getBinancePositionMode();
  const { response } = await binancePositionModePromise;
  return response?.dualSidePosition === true;
};

const EXCHANGE_BATCH_LIMIT_API = {
  bitget: ({ symbol, orders }) =>
    placeBitgetBatchLimit({
      symbol,
      orders: orders.map(o => ({ side: o.side, price: roundNum(o.price), size: roundNum(o.qty), clientOid: o.clientOid })),
    }),
  binance: async ({ symbol, orders }) => {
    const [{ pricePrecision, quantityPrecision }, hedgeMode] = await Promise.all([
      getBinanceSymbolPrecision(symbol),
      isBinanceHedgeMode(),
    ]);
    const rounded = orders.map(o => ({ ...o, price: roundNum(o.price, pricePrecision), qty: roundNum(o.qty, quantityPrecision) }));
    // 四舍五入到合约精度后数量变成 0 的档，发出去毫无意义，直接跳过不发请求
    const sendable = rounded.filter(o => o.qty > 0);
    const skipped = rounded.filter(o => o.qty <= 0);

    if (!sendable.length) {
      return { request: null, response: null, httpStatus: null, ok: false, skipped };
    }

    const result = await placeBinanceBatchLimit({
      orders: sendable.map(o => ({
        symbol,
        side: o.side === 'sell' ? 'SELL' : 'BUY',
        price: o.price,
        quantity: o.qty,
        newClientOrderId: o.clientOid,
        // 双向持仓下必须传 positionSide；单向持仓下不能传
        ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
      })),
    });
    return { ...result, skipped };
  },
};

const EXCHANGE_MARKET_API = {
  bitget: ({ symbol, side, qty, clientOid }) =>
    placeBitgetMarket({ symbol, side, size: roundNum(qty), reduceOnly: side === 'buy', clientOid }),
  binance: async ({ symbol, side, qty, clientOid }) => {
    const [{ quantityPrecision }, hedgeMode] = await Promise.all([
      getBinanceSymbolPrecision(symbol),
      isBinanceHedgeMode(),
    ]);
    const roundedQty = roundNum(qty, quantityPrecision);
    if (roundedQty <= 0) {
      throw new Error('数量四舍五入到合约精度后为 0，无法平仓');
    }
    return placeBinanceMarket({
      symbol,
      side: side === 'sell' ? 'SELL' : 'BUY',
      quantity: roundedQty,
      // 双向持仓下不能传 reduceOnly（跟 positionSide 冲突），单向持仓才需要
      reduceOnly: !hedgeMode && side === 'buy',
      ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
      newClientOrderId: clientOid,
    });
  },
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
  if (exchange === 'bitget') {
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
  } else if (exchange === 'binance' && Array.isArray(result.response) && result.response.length === sendableLegs.length) {
    sentResults = sendableLegs.map((leg, i) => {
      const item = result.response[i];
      const ok = !!result.ok && !item?.code;
      return { ...leg, ok, status: ok ? 'submitted' : 'rejected', orderId: item?.orderId ?? null, response: item, httpStatus: result.httpStatus };
    });
  }

  if (!sentResults) {
    sentResults = sendableLegs.map(leg => ({
      ...leg,
      ok: false,
      status: result.ok ? 'unknown' : 'rejected',
      response: result.response,
      httpStatus: result.httpStatus,
      error: result.error,
    }));
  }

  const byOid = new Map([...skippedResults, ...sentResults].map(r => [r.clientOid, r]));
  return legs.map(leg => byOid.get(leg.clientOid));
};

/**
 * 一次批量请求把阶梯的几档限价空单全部挂出去（真实签名请求；key 换成真实的之前会被
 * 交易所整体拒绝）。
 */
export const submitLadderPlan = async plan => {
  const legsWithOid = plan.legs.map((leg, idx) => ({ ...leg, clientOid: `surge${plan.createdAt}${idx}` }));

  if (!isLiveOrderEnabled()) {
    return {
      ...plan,
      legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'error', error: 'auto_order_disabled' })),
      status: 'failed',
    };
  }

  const api = EXCHANGE_BATCH_LIMIT_API[plan.exchange];

  if (!api) {
    return { ...plan, legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'unsupported_exchange' })), status: 'failed' };
  }

  try {
    const result = await api({
      symbol: plan.symbol,
      orders: legsWithOid.map(l => ({ side: 'sell', price: l.price, qty: l.qty, clientOid: l.clientOid })),
    });

    console.warn(
      `[SurgeAlert][BATCH ORDER] ${plan.exchange} ${plan.symbol} legs=${legsWithOid.length} ok=${result.ok} httpStatus=${result.httpStatus}`,
      result
    );

    const legs = applyBatchResult(plan.exchange, legsWithOid, result);
    const anySucceeded = legs.some(l => l.ok);
    const allSkipped = legs.every(l => l.status === 'skipped');
    return {
      ...plan,
      legs,
      batchRequest: result.request,
      status: anySucceeded ? 'open' : allSkipped ? 'skipped' : 'failed',
    };
  } catch (e) {
    console.error(`[SurgeAlert][BATCH ORDER] ${plan.exchange} ${plan.symbol} 批量下单请求失败`, e);
    return {
      ...plan,
      legs: legsWithOid.map(l => ({ ...l, ok: false, status: 'error', error: e.message })),
      status: 'failed',
    };
  }
};

const placeExchangeMarketOrder = async ({ symbol, exchange, side, qty }) => {
  orderSeq += 1;
  const clientOid = `surge${Date.now()}${orderSeq}`;

  if (!isLiveOrderEnabled()) {
    return { clientOid, orderId: null, ok: false, status: 'error', error: 'auto_order_disabled', submittedAt: Date.now() };
  }

  const api = EXCHANGE_MARKET_API[exchange];

  if (!api) {
    return { orderId: null, ok: false, status: 'unsupported_exchange', submittedAt: Date.now() };
  }

  try {
    const result = await api({ symbol, side, qty, clientOid });
    console.warn(
      `[SurgeAlert][ORDER] ${exchange} ${symbol} ${side} market qty=${qty} ok=${result.ok} httpStatus=${result.httpStatus}`,
      result
    );
    return {
      clientOid,
      orderId: result.response?.data?.orderId || result.response?.orderId || null,
      ok: !!result.ok,
      status: result.ok ? 'submitted' : 'rejected',
      httpStatus: result.httpStatus,
      request: result.request,
      response: result.response,
      submittedAt: Date.now(),
    };
  } catch (e) {
    console.error(`[SurgeAlert][ORDER] ${exchange} ${symbol} 平仓请求失败`, e);
    return { clientOid, orderId: null, ok: false, status: 'error', error: e.message, submittedAt: Date.now() };
  }
};

/** 触发止损 / 止盈 / 结构失效时，用市价单平仓（真实签名请求，只有一笔，不用批量接口） */
export const closeLadderPlan = async (batch, reason, exitPrice) => {
  const qty = (batch.legs || []).reduce((sum, leg) => sum + (leg.qty || 0), 0);
  const closeOrder = await placeExchangeMarketOrder({ symbol: batch.symbol, exchange: batch.exchange, side: 'buy', qty });
  return {
    ...batch,
    status: 'closed',
    exitReason: reason,
    exitPrice,
    closeOrder,
    closedAt: Date.now(),
  };
};

/** 用最新价判断已挂出的阶梯批次是否触发离场；命中返回原因，否则 null */
export const evaluateExit = (batch, lastPrice) => {
  if (!Number.isFinite(lastPrice)) return null;
  if (lastPrice >= batch.stopPrice) return 'stop';
  if (lastPrice <= batch.targetPrice) return 'target';
  if (batch.exitOnNewHigh && Number.isFinite(batch.structureHigh) && lastPrice > batch.structureHigh) {
    return 'structure';
  }
  return null;
};
