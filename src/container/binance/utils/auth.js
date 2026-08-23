import CryptoJS from 'crypto-js';

/**
 * 币安签名请求（浏览器端）。
 * api/index.js 里的 createAuthenticatedClient.sign 用的是 Node 内置 crypto，
 * 在浏览器打包环境里 require('crypto') 不可用，会直接抛 "Signing not supported in
 * browser environment"；这里改用 crypto-js（项目已依赖，bitget 签名也在用）算
 * HMAC-SHA256 输出 hex，是币安要求的签名格式。
 */

export const getApiConfig = () => ({
  apiKey: process.env.GATSBY_BINANCE_API_KEY,
  apiSecret: process.env.GATSBY_BINANCE_API_SECRET,
});

const sign = (query, secret) => CryptoJS.HmacSHA256(query, secret).toString(CryptoJS.enc.Hex);

const mask = value => {
  if (!value) return value;
  const str = String(value);
  return str.length <= 8 ? '***' : `${str.slice(0, 4)}...${str.slice(-4)}`;
};

/**
 * 同时返回实际发出的请求明细（url/headers，敏感字段打码）和交易所原始响应，
 * 用于下单这类「先看请求再验证参数」的场景。
 */
export const signedRequestVerbose = async ({ method = 'GET', base, path, params = {} }) => {
  const { apiKey, apiSecret } = getApiConfig();
  if (!apiKey || !apiSecret) {
    throw new Error('请先配置 API Key（GATSBY_BINANCE_API_KEY / GATSBY_BINANCE_API_SECRET）');
  }

  const query = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const qs = new URLSearchParams(query).toString();
  const signature = sign(qs, apiSecret);
  const url = `${base}${path}?${qs}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': apiKey };

  const request = {
    url: `${base}${path}?${qs}&signature=${mask(signature)}`,
    method,
    headers: { 'X-MBX-APIKEY': mask(apiKey) },
    body: null,
  };

  try {
    const res = await fetch(url, { method, headers });
    const httpStatus = res.status;
    const ok = res.ok;
    const response = await res.json().catch(() => null);
    return { request, response, httpStatus, ok };
  } catch (e) {
    return { request, response: null, httpStatus: null, ok: false, error: e.message };
  }
};
