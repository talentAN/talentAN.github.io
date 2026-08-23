/**
 * 交易所签名代理（Binance + Bitget）：真实的私钥/Secret/Passphrase 只存在于这个
 * Worker 的 Secret 里，浏览器永远拿不到。前端把「调用哪个交易所的哪个接口、带什么
 * 参数」POST 过来，这里签好名再转发给对应交易所，把响应原样带回去。
 *
 * 三种 Authorization 凭证，权限不同：
 * - PROXY_TRADE_TOKEN：全权限（GET+POST），只允许出现在本地 .env.development。
 * - PROXY_READONLY_TOKEN：只放行 GET（只读）接口，POST 一律 403。这个 token 才允许
 *   打进 CI / 公开发布的 bundle——因为 Bitget 的历史仓位查询（trade-record）是线上
 *   公开功能，它的 token 必然会被任何人从发布出去的 JS 里看到；只读 token 泄露的
 *   代价是"被人查一下历史仓位"，不是"被人拿去下单"。
 * - session token：`action: 'unlock'` 用密码换来的、带过期时间的临时凭证，权限等同
 *   PROXY_TRADE_TOKEN。用于线上公开站点——任何人都能看到这个站点的代码，但只有知道
 *   UNLOCK_PASSWORD 的人能换到一个短期有效的交易权限。
 */

const BASE = {
  binance: 'https://fapi.binance.com',
  bitget: 'https://api.bitget.com',
};

// 只认识项目里实际用到的这几个接口，按交易所分开，防止 token 泄露后被拿去调用任意接口。
const ALLOWED_ENDPOINTS = {
  binance: new Set([
    'GET /fapi/v2/positionRisk',
    'GET /fapi/v1/openOrders',
    'GET /fapi/v2/account',
    'POST /fapi/v1/batchOrders',
    'POST /fapi/v1/order',
    // 诊断用：公开接口，不需要签名/权限，用来判断 Worker 出口 IP 是否被币安拦截
    'GET /fapi/v1/time',
  ]),
  bitget: new Set([
    'GET /api/v2/mix/position/single-position',
    'GET /api/v2/mix/order/orders-pending',
    'GET /api/v2/mix/position/history-position',
    'POST /api/v2/mix/order/batch-place-order',
    'POST /api/v2/mix/order/place-order',
  ]),
};

const mask = value => {
  if (!value) return value;
  const str = String(value);
  return str.length <= 8 ? '***' : `${str.slice(0, 4)}...${str.slice(-4)}`;
};

// ---------- 编解码工具 ----------

const arrayBufferToBase64 = bytesOrBuffer => {
  const bytes = new Uint8Array(bytesOrBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const base64ToBase64Url = b64 => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const stringToBase64Url = str => base64ToBase64Url(arrayBufferToBase64(new TextEncoder().encode(str)));

const base64UrlToString = b64url => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

// ---------- Binance: Ed25519 ----------

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

// 同一个 Worker 实例可能处理多个请求，私钥没变就不用重复 import。
let cachedEd25519Pem = null;
let cachedEd25519KeyPromise = null;
const importEd25519Key = pem => {
  if (pem !== cachedEd25519Pem) {
    cachedEd25519Pem = pem;
    cachedEd25519KeyPromise = crypto.subtle.importKey('pkcs8', pemToArrayBuffer(pem), { name: 'Ed25519' }, false, [
      'sign',
    ]);
  }
  return cachedEd25519KeyPromise;
};

const signBinance = async (query, privateKeyPem) => {
  const key = await importEd25519Key(privateKeyPem);
  const signatureBuffer = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(query));
  return arrayBufferToBase64(signatureBuffer);
};

const buildBinanceRequest = async ({ method, path, params, env }) => {
  const query = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const qs = new URLSearchParams(query).toString();
  const signature = await signBinance(qs, env.BINANCE_PRIVATE_KEY);
  const url = `${BASE.binance}${path}?${qs}&signature=${encodeURIComponent(signature)}`;
  const headers = { 'X-MBX-APIKEY': env.BINANCE_API_KEY };
  const requestSummary = {
    url: `${BASE.binance}${path}?${qs}&signature=${mask(signature)}`,
    method,
    headers: { 'X-MBX-APIKEY': mask(env.BINANCE_API_KEY) },
    body: null,
  };
  return { url, headers, bodyStr: null, requestSummary };
};

// ---------- 通用 HMAC-SHA256（Bitget 签名 + session token 签名共用）----------

// 同一个 Worker 实例里 Bitget secret 和 session 签名 key 会交替使用，缓存只留一格
// 没关系——单次 import 很快，这里只是避免同一个 secret 连续多次请求时重复 import。
let cachedHmacSecret = null;
let cachedHmacKeyPromise = null;
const importHmacKey = secret => {
  if (secret !== cachedHmacSecret) {
    cachedHmacSecret = secret;
    cachedHmacKeyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
  return cachedHmacKeyPromise;
};

const signHmac = async (message, secret) => {
  const key = await importHmacKey(secret);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return arrayBufferToBase64(signatureBuffer);
};

const buildBitgetRequest = async ({ method, path, params, body, env }) => {
  const queryString = params && Object.keys(params).length ? new URLSearchParams(params).toString() : '';
  const requestPath = queryString ? `${path}?${queryString}` : path;
  const bodyStr = body ? JSON.stringify(body) : '';
  const timestamp = Date.now().toString();
  const message = timestamp + method + requestPath + bodyStr;
  const signature = await signHmac(message, env.BITGET_API_SECRET);
  const url = `${BASE.bitget}${requestPath}`;
  const headers = {
    'ACCESS-KEY': env.BITGET_API_KEY,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': env.BITGET_PASSPHRASE,
    'Content-Type': 'application/json',
    locale: 'zh-CN',
  };
  const requestSummary = {
    url,
    method,
    headers: {
      ...headers,
      'ACCESS-KEY': mask(env.BITGET_API_KEY),
      'ACCESS-SIGN': mask(signature),
      'ACCESS-PASSPHRASE': mask(env.BITGET_PASSPHRASE),
    },
    body: bodyStr || null,
  };
  return { url, headers, bodyStr: bodyStr || null, requestSummary };
};

// ---------- 密码解锁 -> 临时交易 session token ----------

// token 格式：`<base64url(JSON payload)>.<base64url(HMAC 签名)>`，跟 JWT 的思路一样，
// 但不引入额外依赖——复用上面已有的 Web Crypto HMAC。
const mintSessionToken = async env => {
  const ttlMinutes = Number(env.SESSION_TTL_MINUTES) || 60;
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
  const payloadB64Url = stringToBase64Url(JSON.stringify({ exp: expiresAt }));
  const sigB64Url = base64ToBase64Url(await signHmac(payloadB64Url, env.SESSION_SIGNING_KEY));
  return { token: `${payloadB64Url}.${sigB64Url}`, expiresAt };
};

const verifySessionToken = async (token, env) => {
  if (!token || !env.SESSION_SIGNING_KEY || !token.includes('.')) return false;
  const [payloadB64Url, sigB64Url] = token.split('.');
  const expectedSig = base64ToBase64Url(await signHmac(payloadB64Url, env.SESSION_SIGNING_KEY));
  if (expectedSig !== sigB64Url) return false;
  try {
    const payload = JSON.parse(base64UrlToString(payloadB64Url));
    return typeof payload.exp === 'number' && Date.now() < payload.exp;
  } catch (e) {
    return false;
  }
};

// ---------- 通用请求处理 ----------

const corsHeaders = (env, request) => {
  const allowed = (env.ALLOWED_ORIGINS || 'http://localhost:8000').split(',').map(s => s.trim());
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
};

const json = (data, status, env, request) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, env, request);
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const isTradeToken = Boolean(env.PROXY_TRADE_TOKEN) && token === env.PROXY_TRADE_TOKEN;
    const isReadonlyToken = Boolean(env.PROXY_READONLY_TOKEN) && token === env.PROXY_READONLY_TOKEN;
    const hasStaticToken = isTradeToken || isReadonlyToken;

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Invalid JSON body' }, 400, env, request);
    }

    // 解锁请求：必须先带一个已有 token（防裸扫描），再校验密码本身。
    if (body?.action === 'unlock') {
      if (!hasStaticToken) {
        return json({ error: 'Unauthorized' }, 401, env, request);
      }
      if (!env.UNLOCK_PASSWORD) {
        return json({ error: 'Proxy 未配置 UNLOCK_PASSWORD' }, 500, env, request);
      }
      if (body.password !== env.UNLOCK_PASSWORD) {
        return json({ ok: false, error: '密码错误' }, 200, env, request);
      }
      const { token: sessionToken, expiresAt } = await mintSessionToken(env);
      return json({ ok: true, sessionToken, expiresAt }, 200, env, request);
    }

    // 常规代理转发：static token 不够时，看是不是一个有效未过期的 session token。
    const isSessionToken = !hasStaticToken && (await verifySessionToken(token, env));
    if (!hasStaticToken && !isSessionToken) {
      return json({ error: 'Unauthorized' }, 401, env, request);
    }
    const grantsTrade = isTradeToken || isSessionToken;

    const { exchange, method = 'GET', path, params = {}, body: reqBody = null } = body || {};
    if (!grantsTrade && method !== 'GET') {
      return json({ error: '只读 token 不能调用非 GET 接口' }, 403, env, request);
    }
    if (!ALLOWED_ENDPOINTS[exchange]?.has(`${method} ${path}`)) {
      return json({ error: `Endpoint not allowed: ${exchange} ${method} ${path}` }, 403, env, request);
    }

    // 诊断专用：裸请求，不签名、不带任何 key，只用来判断 Worker 出口 IP 是否被拦截，
    // 跟浏览器直接访问这个公开接口时发出的请求完全对等。
    if (exchange === 'binance' && method === 'GET' && path === '/fapi/v1/time') {
      const diagUrl = `${BASE.binance}${path}`;
      try {
        const res = await fetch(diagUrl);
        const httpStatus = res.status;
        const ok = res.ok;
        const response = await res.json().catch(() => null);
        return json(
          { request: { url: diagUrl, method: 'GET', headers: {}, body: null }, response, httpStatus, ok },
          200,
          env,
          request
        );
      } catch (e) {
        return json(
          { request: { url: diagUrl, method: 'GET', headers: {}, body: null }, response: null, httpStatus: null, ok: false, error: e.message },
          200,
          env,
          request
        );
      }
    }

    let requestBuilder;
    if (exchange === 'binance') {
      if (!env.BINANCE_API_KEY || !env.BINANCE_PRIVATE_KEY) {
        return json({ error: 'Proxy 未配置 BINANCE_API_KEY / BINANCE_PRIVATE_KEY' }, 500, env, request);
      }
      requestBuilder = buildBinanceRequest({ method, path, params, env });
    } else {
      if (!env.BITGET_API_KEY || !env.BITGET_API_SECRET || !env.BITGET_PASSPHRASE) {
        return json({ error: 'Proxy 未配置 BITGET_API_KEY / BITGET_API_SECRET / BITGET_PASSPHRASE' }, 500, env, request);
      }
      requestBuilder = buildBitgetRequest({ method, path, params, body: reqBody, env });
    }

    const { url, headers, bodyStr, requestSummary } = await requestBuilder;

    try {
      const res = await fetch(url, { method, headers, body: bodyStr || undefined });
      const httpStatus = res.status;
      const ok = res.ok;
      const response = await res.json().catch(() => null);
      return json({ request: requestSummary, response, httpStatus, ok }, 200, env, request);
    } catch (e) {
      return json(
        { request: requestSummary, response: null, httpStatus: null, ok: false, error: e.message },
        200,
        env,
        request
      );
    }
  },
};
