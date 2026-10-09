import { signedRequestVerbose } from '../utils/auth';

const FUTURES_BASE = 'https://fapi.binance.com';

/**
 * 查询合约持仓风险（U 本位永续）：GET /fapi/v2/positionRisk
 * 不传 symbol 时返回账户全部持仓。
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#position-information-v2-user_data
 */
export const getPositionRisk = async ({ symbol } = {}) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v2/positionRisk',
    params: symbol ? { symbol } : {},
  });

/**
 * 查询当前挂单：GET /fapi/v1/openOrders
 * 不传 symbol 时返回账户全部未成交挂单。
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#current-all-open-orders-user_data
 */
export const getOpenOrders = async ({ symbol } = {}) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v1/openOrders',
    params: symbol ? { symbol } : {},
  });

/**
 * 查询未完成条件单：GET /fapi/v1/openAlgoOrders
 * 不传 symbol 时返回账户全部未完成条件单。
 */
export const getOpenAlgoOrders = async ({ symbol } = {}) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v1/openAlgoOrders',
    params: symbol ? { symbol } : {},
  });

/**
 * 查询单笔订单：GET /fapi/v1/order
 * 用 orderId 或 origClientOrderId。用于判断限价空单是否已成交，再挂止损。
 */
export const getOrder = async ({ symbol, orderId, origClientOrderId }) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v1/order',
    params: {
      symbol,
      ...(orderId != null ? { orderId } : {}),
      ...(origClientOrderId ? { origClientOrderId } : {}),
    },
  });

  export const getUserTrades = async ({ symbol, startTime, endTime, limit = 1000 } = {}) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v1/userTrades',
    params: {
      symbol,
      ...(startTime != null ? { startTime } : {}),
      ...(endTime != null ? { endTime } : {}),
      ...(limit != null ? { limit } : {}),
    },
  });
/**
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#get-current-position-mode-user_data
 * 返回 { dualSidePosition: true|false }；双向持仓下单必须带 positionSide。
 */
export const getPositionMode = async () =>
  signedRequestVerbose({ method: 'GET', base: FUTURES_BASE, path: '/fapi/v1/positionSide/dual', params: {} });
