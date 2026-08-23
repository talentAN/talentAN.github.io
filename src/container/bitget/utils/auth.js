import { generateHeaders } from './headers';

// 从环境变量获取 API 配置
export const getApiConfig = () => {
  const apiKey = process.env.GATSBY_BITGET_API_KEY;
  const apiSecret = process.env.GATSBY_BITGET_API_SECRET;
  const passphrase = process.env.GATSBY_BITGET_PASSPHRASE;
  return { apiKey, apiSecret, passphrase };
};

const mask = value => {
  if (!value) return value;
  const str = String(value);
  return str.length <= 8 ? '***' : `${str.slice(0, 4)}...${str.slice(-4)}`;
};

const buildSignedRequest = ({ apiKey, apiSecret, passphrase, method, endpoint, params, body }) => {
  const queryString = params && Object.keys(params).length ? new URLSearchParams(params).toString() : '';
  const requestPath = queryString ? `${endpoint}?${queryString}` : endpoint;
  const bodyStr = body ? JSON.stringify(body) : '';
  const timestamp = Date.now().toString();
  const headers = generateHeaders({ apiKey, apiSecret, passphrase, method, requestPath, body: bodyStr, timestamp });
  return { url: `https://api.bitget.com${requestPath}`, headers, bodyStr };
};

// 发送认证请求（GET 查询 / POST JSON body），返回解析后的响应体
export const authenticatedRequest = async (method, endpoint, params = {}, body = null) => {
  const { apiKey, apiSecret, passphrase } = getApiConfig();

  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('请先配置 API Key');
  }

  const { url, headers, bodyStr } = buildSignedRequest({
    apiKey,
    apiSecret,
    passphrase,
    method,
    endpoint,
    params,
    body,
  });

  const response = await fetch(url, { method, headers, body: bodyStr || undefined });
  return response.json();
};

/**
 * 同 authenticatedRequest，但额外把实际发出的请求（url/headers/body，敏感字段打码）
 * 和交易所原始响应一起带回来，用于下单这类「先看请求再验证参数」的场景。
 */
export const authenticatedRequestVerbose = async (method, endpoint, params = {}, body = null) => {
  const { apiKey, apiSecret, passphrase } = getApiConfig();

  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('请先配置 API Key（GATSBY_BITGET_API_KEY / GATSBY_BITGET_API_SECRET / GATSBY_BITGET_PASSPHRASE）');
  }

  const { url, headers, bodyStr } = buildSignedRequest({
    apiKey,
    apiSecret,
    passphrase,
    method,
    endpoint,
    params,
    body,
  });

  const request = {
    url,
    method,
    headers: { ...headers, 'ACCESS-KEY': mask(apiKey), 'ACCESS-SIGN': mask(headers['ACCESS-SIGN']), 'ACCESS-PASSPHRASE': mask(passphrase) },
    body: bodyStr || null,
  };

  try {
    const res = await fetch(url, { method, headers, body: bodyStr || undefined });
    const httpStatus = res.status;
    const ok = res.ok;
    const response = await res.json().catch(() => null);
    return { request, response, httpStatus, ok };
  } catch (e) {
    return { request, response: null, httpStatus: null, ok: false, error: e.message };
  }
};
