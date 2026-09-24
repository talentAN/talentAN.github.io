import { signedRequestVerbose } from '../utils/auth';

const FUTURES_BASE = 'https://fapi.binance.com';

/**
 * 查询某个合约当前持仓风险（U 本位永续）：GET /fapi/v2/positionRisk
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#position-information-v2-user_data
 * 无持仓时返回的 positionAmt 是 "0"。
 */
export const getPositionRisk = async ({ symbol }) =>
  signedRequestVerbose({ method: 'GET', base: FUTURES_BASE, path: '/fapi/v2/positionRisk', params: { symbol } });

/**
 * 查询某个合约当前挂单：GET /fapi/v1/openOrders
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#current-all-open-orders-user_data
 * 无挂单时返回空数组。
 */
export const getOpenOrders = async ({ symbol }) =>
  signedRequestVerbose({ method: 'GET', base: FUTURES_BASE, path: '/fapi/v1/openOrders', params: { symbol } });

/**
 * 查询未完成条件单：GET /fapi/v1/openAlgoOrders
 */
export const getOpenAlgoOrders = async ({ symbol }) =>
  signedRequestVerbose({
    method: 'GET',
    base: FUTURES_BASE,
    path: '/fapi/v1/openAlgoOrders',
    params: { symbol },
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

/**
 * 查询账户是单向持仓还是双向持仓（Hedge Mode）：GET /fapi/v1/positionSide/dual
 * 文档：https://binance-docs.github.io/apidocs/futures/en/#get-current-position-mode-user_data
 * 返回 { dualSidePosition: true|false }；双向持仓下单必须带 positionSide。
 */
export const getPositionMode = async () =>
  signedRequestVerbose({ method: 'GET', base: FUTURES_BASE, path: '/fapi/v1/positionSide/dual', params: {} });
