import { authenticatedRequestVerbose } from '../utils/auth';

const PRODUCT_TYPE = 'USDT-FUTURES';

/**
 * Bitget V2（经典合约账户 / mix）批量下单：POST /api/v2/mix/order/batch-place-order
 * 文档：https://www.bitget.com/api-doc/contract/trade/Batch-Order
 * 一次最多 20 笔，阶梯模型的几档限价单一次请求全部挂出去。
 *
 * force 默认 'post_only'：只做 maker——如果价格已经能立即成交（会吃单），交易所直接拒绝
 * 这一笔，不会意外变成 taker。
 *
 * ⚠️ one-way（单向）持仓模式下 side='sell' 即开空、side='buy' 即开多/平空。
 * 若账户是双向持仓模式（hedge-mode），Bitget 还要求每个订单额外传 tradeSide: 'open'|'close'，
 * 这里没有处理账户持仓模式探测，接真实资金前需要按账户实际设置补上。
 *
 * ⚠️ 响应里成功/失败订单分别在 data.successList / data.failureList 里按 clientOid 对应，
 * 这是按官方文档写的，还没能用真实 Key 验证过实际返回结构，换真实 Key 后建议核对一次。
 */
export const placeFutureBatchLimitOrders = async ({
  symbol,
  orders, // [{ side, price, size, clientOid, force? }]
  marginMode = 'crossed',
  marginCoin = 'USDT',
  force = 'post_only',
}) => {
  const body = {
    symbol,
    productType: PRODUCT_TYPE,
    marginMode,
    marginCoin,
    orderList: orders.map(o => ({
      size: String(o.size),
      price: String(o.price),
      side: o.side,
      orderType: 'limit',
      force: o.force || force,
      ...(o.clientOid ? { clientOid: o.clientOid } : {}),
    })),
  };
  return authenticatedRequestVerbose('POST', '/api/v2/mix/order/batch-place-order', {}, body);
};

/** 单笔市价单：止损 / 止盈 / 结构失效离场用，只有一笔，不需要走批量接口 */
export const placeFutureMarketOrder = async ({
  symbol,
  side,
  size,
  marginMode = 'crossed',
  marginCoin = 'USDT',
  reduceOnly,
  clientOid,
}) => {
  const body = {
    symbol,
    productType: PRODUCT_TYPE,
    marginMode,
    marginCoin,
    size: String(size),
    side,
    orderType: 'market',
    ...(reduceOnly ? { reduceOnly: true } : {}),
    ...(clientOid ? { clientOid } : {}),
  };
  return authenticatedRequestVerbose('POST', '/api/v2/mix/order/place-order', {}, body);
};
