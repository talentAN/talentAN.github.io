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
 * 查询某个合约当前未成交委托：GET /api/v2/mix/order/orders-pending
 * 文档：https://www.bitget.com/api-doc/contract/trade/Get-Orders-Pending
 * 无挂单时 data.entrustedList 可能是 null 或空数组，两种都要当「没有」处理。
 */
export const getPendingOrders = async ({ symbol }) =>
  authenticatedRequestVerbose('GET', '/api/v2/mix/order/orders-pending', {
    symbol,
    productType: PRODUCT_TYPE,
  });
