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
 * ⚠️ 单向持仓模式下 side='SELL' 即开空、side='BUY' 即开多/平空。
 * 若账户开了双向持仓模式（Hedge Mode），币安还要求每个订单额外传 positionSide: 'SHORT'|'LONG'，
 * 这里没有处理账户持仓模式探测，接真实资金前需要按账户实际设置补上。
 *
 * ⚠️ 响应是一个跟请求顺序一致的数组，每项要么是订单对象（成功），要么是 { code, msg }
 * （失败）——这是按官方文档写的，还没能用真实 Key 验证过实际返回结构，换真实 Key 后
 * 建议核对一次。
 */
export const placeFutureBatchLimitOrders = async ({ orders, timeInForce = 'GTX' }) => {
  // orders: [{ symbol, side, price, quantity, newClientOrderId, timeInForce? }]
  const batchOrders = orders.map(o => ({
    symbol: o.symbol,
    side: o.side,
    type: 'LIMIT',
    timeInForce: o.timeInForce || timeInForce,
    quantity: String(o.quantity),
    price: String(o.price),
    ...(o.newClientOrderId ? { newClientOrderId: o.newClientOrderId } : {}),
  }));
  return signedRequestVerbose({
    method: 'POST',
    base: FUTURES_BASE,
    path: '/fapi/v1/batchOrders',
    params: { batchOrders: JSON.stringify(batchOrders) },
  });
};

/** 市价单，主要用于止损/止盈/结构失效时的模拟平仓 */
export const placeFutureMarketOrder = async ({ symbol, side, quantity, reduceOnly, newClientOrderId }) => {
  const params = {
    symbol,
    side,
    type: 'MARKET',
    quantity: String(quantity),
    ...(reduceOnly ? { reduceOnly: 'true' } : {}),
    ...(newClientOrderId ? { newClientOrderId } : {}),
  };
  return signedRequestVerbose({ method: 'POST', base: FUTURES_BASE, path: '/fapi/v1/order', params });
};
