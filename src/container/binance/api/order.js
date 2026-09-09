import { signedRequestVerbose } from '../utils/auth';

const FUTURES_BASE = 'https://fapi.binance.com';

/**
 * 币安 U 本位合约批量下单：POST /fapi/v1/batchOrders
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#place-multiple-orders-trade
 * 一次最多 5 笔，阶梯模型的几档限价单一次请求全部挂出去。
 *
 * timeInForce 默认 'GTX'（Post-Only）：只做 maker——如果价格已经能立即成交（会吃单），
 * 交易所直接拒绝这一笔，不会意外变成 taker。
 *
 * ⚠️ 单向持仓模式下 side='SELL' 即开空、side='BUY' 即开多/平空，不传 positionSide。
 * 双向持仓模式（Hedge Mode）下每个订单必须传 positionSide: 'SHORT'|'LONG'，且不能再传
 * reduceOnly（币安会报参数冲突）。调用方（_autoOrderModel.js）会先查账户实际是哪种
 * 模式再决定传不传 positionSide。
 *
 * ⚠️ USDS-M Futures Open API 无法在限价开仓单上附带止损（无 spot orderList/oto、
 * 无 attachAlgoOrds）；条件单请另走 /fapi/v1/algoOrder。
 */
export const placeFutureBatchLimitOrders = async ({ orders, timeInForce = 'GTX' }) => {
  // orders: [{ symbol, side, price, quantity, newClientOrderId, timeInForce?, positionSide? }]
  const batchOrders = orders.map(o => ({
    symbol: o.symbol,
    side: o.side,
    type: 'LIMIT',
    timeInForce: o.timeInForce || timeInForce,
    quantity: String(o.quantity),
    price: String(o.price),
    ...(o.newClientOrderId ? { newClientOrderId: o.newClientOrderId } : {}),
    ...(o.positionSide ? { positionSide: o.positionSide } : {}),
  }));
  return signedRequestVerbose({
    method: 'POST',
    base: FUTURES_BASE,
    path: '/fapi/v1/batchOrders',
    params: { batchOrders: JSON.stringify(batchOrders) },
  });
};

/** 单笔限价单，默认用于 reduce-only 止盈平空。 */
export const placeFutureLimitOrder = async ({ symbol, side, price, quantity, reduceOnly, positionSide, newClientOrderId, timeInForce = 'GTC' }) => {
  const params = {
    symbol,
    side,
    type: 'LIMIT',
    timeInForce,
    quantity: String(quantity),
    price: String(price),
    ...(reduceOnly ? { reduceOnly: 'true' } : {}),
    ...(positionSide ? { positionSide } : {}),
    ...(newClientOrderId ? { newClientOrderId } : {}),
  };
  return signedRequestVerbose({ method: 'POST', base: FUTURES_BASE, path: '/fapi/v1/order', params });
};

/** 市价单，主要用于止损/止盈/结构失效时的模拟平仓 */
export const placeFutureMarketOrder = async ({ symbol, side, quantity, reduceOnly, positionSide, newClientOrderId }) => {
  const params = {
    symbol,
    side,
    type: 'MARKET',
    quantity: String(quantity),
    ...(reduceOnly ? { reduceOnly: 'true' } : {}),
    ...(positionSide ? { positionSide } : {}),
    ...(newClientOrderId ? { newClientOrderId } : {}),
  };
  return signedRequestVerbose({ method: 'POST', base: FUTURES_BASE, path: '/fapi/v1/order', params });
};

/**
 * 按数量挂 STOP_MARKET 条件单（空单止损：BUY + quantity）。
 * 双向仓带 positionSide=SHORT；单向仓带 reduceOnly。
 */
export const placeFutureQtyStopAlgo = async ({
  symbol,
  side,
  quantity,
  triggerPrice,
  positionSide,
  clientAlgoId,
  workingType = 'CONTRACT_PRICE',
  priceProtect = true,
}) => {
  const algoParams = {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type: 'STOP_MARKET',
    triggerPrice: String(triggerPrice),
    quantity: String(quantity),
    workingType,
    ...(priceProtect ? { priceProtect: 'true' } : {}),
    ...(positionSide ? { positionSide } : { reduceOnly: 'true' }),
    ...(clientAlgoId ? { clientAlgoId } : {}),
  };
  return signedRequestVerbose({
    method: 'POST',
    base: FUTURES_BASE,
    path: '/fapi/v1/algoOrder',
    params: algoParams,
  }).then(r => ({ ...r, via: 'algoOrder' }));
};

/**
 * 仓位止损 / 止盈条件单（平掉全部仓位）。
 * 2025-12 起条件单应走 /fapi/v1/algoOrder；若返回 -4120 以外的旧环境错误，再回退
 * 到 /fapi/v1/order。
 *
 * 空单止损：side=BUY + STOP_MARKET + closePosition
 * 空单止盈：side=BUY + TAKE_PROFIT_MARKET + closePosition
 */
export const placeFutureClosePositionAlgo = async ({
  symbol,
  side,
  triggerPrice,
  orderType = 'STOP_MARKET',
  positionSide,
  clientAlgoId,
  workingType = 'CONTRACT_PRICE',
}) => {
  const algoParams = {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type: orderType,
    triggerPrice: String(triggerPrice),
    closePosition: 'true',
    workingType,
    ...(positionSide ? { positionSide } : {}),
    ...(clientAlgoId ? { clientAlgoId } : {}),
  };
  const algoResult = await signedRequestVerbose({
    method: 'POST',
    base: FUTURES_BASE,
    path: '/fapi/v1/algoOrder',
    params: algoParams,
  });
  if (algoResult.ok) return { ...algoResult, via: 'algoOrder' };

  const code = algoResult.response?.code;
  // -4120 表示必须走 algo；其它错误（如端点不存在）再试旧接口
  if (code === -4120) return { ...algoResult, via: 'algoOrder' };

  const legacyParams = {
    symbol,
    side,
    type: orderType,
    stopPrice: String(triggerPrice),
    closePosition: 'true',
    workingType,
    ...(positionSide ? { positionSide } : {}),
    ...(clientAlgoId ? { newClientOrderId: clientAlgoId } : {}),
  };
  const legacyResult = await signedRequestVerbose({
    method: 'POST',
    base: FUTURES_BASE,
    path: '/fapi/v1/order',
    params: legacyParams,
  });
  return { ...legacyResult, via: 'order' };
};
