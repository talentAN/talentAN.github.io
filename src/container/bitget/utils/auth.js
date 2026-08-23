import { callExchangeProxy } from '@root/src/utils/exchangeProxy';

/**
 * 同时返回实际发出的请求明细（url/headers，敏感字段打码，由代理侧构造后带回来）
 * 和交易所原始响应，用于下单这类「先看请求再验证参数」的场景。
 */
export const signedRequestVerbose = ({ method = 'GET', path, params = {} }) =>
  callExchangeProxy({ exchange: 'binance', method, path, params });
