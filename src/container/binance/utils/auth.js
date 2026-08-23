/**
 * 币安签名请求（浏览器端，本地直接签）。
 * 币安会拦 Cloudflare Workers 的出口 IP（已用裸请求验证过：不签名、不带 key 的
 * GET /fapi/v1/time 一样被 403），所以币安这部分退回本地直接签名——用你自己电脑
 * 的家庭宽带 IP 发请求，不经过 Worker。私钥只放本地 .env.development，跟其它本地
 * 凭证一样，不进 CI/发布产物。Bitget 那边不受影响，继续走 workers/exchange-proxy。
 */

export const getApiConfig = () => ({
  apiKey: process.env.GATSBY_BINANCE_API_KEY,
  privateKey: process.env.GATSBY_BINANCE_PRIVATE_KEY,
});

// PEM (PKCS8) -> ArrayBuffer，供 crypto.subtle.importKey 使用
const pemToArrayBuffer = pem => {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const arrayBufferToBase64 = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

// 同一把私钥只需要 import 一次；用 PEM 原文做 key 避免切换私钥时读到旧缓存
let cachedPem = null;
let cachedKeyPromise = null;
const importPrivateKey = pem => {
  if (pem !== cachedPem) {
    cachedPem = pem;
    cachedKeyPromise = crypto.subtle.importKey('pkcs8', pemToArrayBuffer(pem), { name: 'Ed25519' }, false, [
      'sign',
    ]);
  }
  return cachedKeyPromise;
};

const sign = async (query, privateKeyPem) => {
  const key = await importPrivateKey(privateKeyPem);
  const signatureBuffer = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(query));
  return arrayBufferToBase64(signatureBuffer);
};

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
  const { apiKey, privateKey } = getApiConfig();
  if (!apiKey || !privateKey) {
    throw new Error('请先配置 API Key（GATSBY_BINANCE_API_KEY / GATSBY_BINANCE_PRIVATE_KEY）');
  }

  const query = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const qs = new URLSearchParams(query).toString();
  const signature = await sign(qs, privateKey);
  // Base64 签名含 + / = 等字符，必须 encodeURIComponent 后才能安全拼进 URL
  const url = `${base}${path}?${qs}&signature=${encodeURIComponent(signature)}`;
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
