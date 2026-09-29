import { authenticatedRequestVerbose } from '../utils/auth';

const PRODUCT_TYPE = 'USDT-FUTURES';

/**
 * 查询某个合约当前持仓（USDT 本位永续）：GET /api/v2/mix/position/single-position
 * 文档：https://www.bitget.com/api-doc/contract/position/get-single-position
 * 无持仓时 data 通常是空数组 []。
 */
export const getSinglePosition = async ({ symbol, marginCoin = 'USDT' }) =>
  authenticatedRequestVerbose('GET', '/api/v2/mix/position/single-position', {
    symbol,
    marginCoin,
    productType: PRODUCT_TYPE,
  });

/**
 * 查询全部持仓：GET /api/v2/mix/position/all-position
 */
export const getAllPositions = async ({ marginCoin = 'USDT' } = {}) =>
  authenticatedRequestVerbose('GET', '/api/v2/mix/position/all-position', {
    marginCoin,
    productType: PRODUCT_TYPE,
  });

/**
 * 查询未成交委托：GET /api/v2/mix/order/orders-pending
 * symbol 可选；不传则拉全部（单页最多 100，调用方自行分页）。
 */
export const getPendingOrders = async ({ symbol, idLessThan, limit = '100' } = {}) =>
  authenticatedRequestVerbose('GET', '/api/v2/mix/order/orders-pending', {
    ...(symbol ? { symbol } : {}),
    ...(idLessThan ? { idLessThan } : {}),
    limit: String(limit),
    productType: PRODUCT_TYPE,
  });

/**
 * 查询计划委托（含未触发）：GET /api/v2/mix/order/orders-plan-pending
 * planType: normal_plan | track_plan | …
 * symbol 可选。
 */
export const getPendingPlanOrders = async ({
  symbol,
  planType = 'normal_plan',
  idLessThan,
  limit = '100',
} = {}) =>
  authenticatedRequestVerbose('GET', '/api/v2/mix/order/orders-plan-pending', {
    ...(symbol ? { symbol } : {}),
    ...(idLessThan ? { idLessThan } : {}),
    limit: String(limit),
    productType: PRODUCT_TYPE,
    planType,
  });
