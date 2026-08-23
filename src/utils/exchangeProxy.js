/**
 * 交易所签名代理客户端（浏览器端）。
 * 私钥/API Secret/Passphrase 不在浏览器里——这里只是把「哪个交易所、调用哪个接口、
 * 带什么参数」转发给 workers/exchange-proxy 这个 Cloudflare Worker，Worker 签好
 * 名再转发给交易所。浏览器只持有访问这个代理用的 token，不接触真正的交易凭证。
 * Binance（`container/binance/utils/auth.js`）和 Bitget（`container/bitget/utils/auth.js`）
 * 共用这一份调用逻辑，避免同样的 fetch/打码/错误处理写两遍。
 */

import { getTradeSession } from './tradeSession';
import { getProxyConfig } from './exchangeProxyConfig';

export { getProxyConfig };

/**
 * 返回 { request, response, httpStatus, ok }：request 是代理侧构造好的、敏感字段
 * 已打码的实际请求明细，response 是交易所原始响应，用于下单这类「先看请求再验证
 * 参数」的场景。
 *
 * Authorization 优先用有效的交易 session token（线上密码解锁换来的临时凭证），
 * 没有就用静态配置的 GATSBY_EXCHANGE_PROXY_TOKEN——本地开发从来没走解锁流程，
 * 永远是后者（本地配的就是全权限 trade token），行为不受影响。
 */
export const callExchangeProxy = async ({ exchange, method = 'GET', path, params = {}, body = null }) => {
  const { proxyUrl, proxyToken } = getProxyConfig();
  const authToken = getTradeSession() || proxyToken;
  if (!proxyUrl || !authToken) {
    throw new Error('请先配置签名代理（GATSBY_EXCHANGE_PROXY_URL / GATSBY_EXCHANGE_PROXY_TOKEN）');
  }

  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ exchange, method, path, params, body }),
    });
    const httpStatus = res.status;
    const ok = res.ok;
    const data = await res.json().catch(() => null);
    if (!ok) {
      return { request: data?.request ?? null, response: data, httpStatus, ok };
    }
    return { request: data.request, response: data.response, httpStatus: data.httpStatus, ok: data.ok };
  } catch (e) {
    return { request: null, response: null, httpStatus: null, ok: false, error: e.message };
  }
};
