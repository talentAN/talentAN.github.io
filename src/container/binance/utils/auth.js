/**
 * 币安签名请求（浏览器端，本地直接签）。
 * HTTP 与公共行情共用 container/market/_fetchGate（同一 IP 限额），
 * 避免 openOrders 等与 klines 各算各的限流叠打 429。
 */

import {
  withBinanceIpGate,
  reportBinanceRateLimit,
  reportBinanceUsedWeight,
  waitBinanceBanIfNeeded,
} from '../../market/_fetchGate';

const FUTURES_TIME_URL = 'https://fapi.binance.com/fapi/v1/time';
const TIME_SYNC_TTL_MS = 5 * 60 * 1000;
const RECV_WINDOW_MS = 10000;
/** 429 后不再连打重试：全局冷却结束由上层再排队，避免把 -1003 打成串 */
const PRIVATE_MAX_RETRIES = 0;
const PRIVATE_COOLDOWN_PAD_MS = 1000;

/** 签名逻辑串行（账户态顺序）；实际发包走 IP 门闩 */
let privateQueue = Promise.resolve();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const enqueuePrivate = task => {
  const run = privateQueue.then(task, task);
  privateQueue = run.catch(() => undefined);
  return run;
};

const parseCooldownMs = (body, retryAfter, attempt = 0) => {
  const match = String(body || '').match(/banned until\s+(\d+)/i);
  const bannedAt = match ? Number(match[1]) : 0;
  const fromBan = bannedAt > Date.now() ? bannedAt - Date.now() + PRIVATE_COOLDOWN_PAD_MS : 0;
  const retrySec = Number(retryAfter);
  const fromRetry = retrySec > 0 ? retrySec * 1000 + PRIVATE_COOLDOWN_PAD_MS : 0;
  const backoff = Math.min(120000, 8000 * 2 ** attempt);
  return Math.max(fromBan, fromRetry, backoff, 20000);
};

export const getApiConfig = () => ({
  apiKey: process.env.GATSBY_BINANCE_API_KEY,
  privateKey: process.env.GATSBY_BINANCE_PRIVATE_KEY,
});

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
let cachedPem = null;
let cachedKeyPromise = null;
const importPrivateKey = pem => {
  if (pem !== cachedPem) {
    cachedPem = pem;
    cachedKeyPromise = crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(pem),
      { name: 'Ed25519' },
      false,
      ['sign']
    );
  }
  return cachedKeyPromise;
};
const sign = async (query, privateKeyPem) => {
  const key = await importPrivateKey(privateKeyPem);
  return arrayBufferToBase64(
    await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(query))
  );
};
const mask = value => {
  if (!value) return value;
  const str = String(value);
  return str.length <= 8 ? '***' : `${str.slice(0, 4)}...${str.slice(-4)}`;
};

let serverTimeOffsetMs = 0;
let lastTimeSyncAt = 0;
let timeSyncPromise = null;

const syncServerTime = async (force = false) => {
  if (!force && Date.now() - lastTimeSyncAt < TIME_SYNC_TTL_MS) return serverTimeOffsetMs;
  if (timeSyncPromise) return timeSyncPromise;
  timeSyncPromise = (async () => {
    await waitBinanceBanIfNeeded();
    const localBefore = Date.now();
    const res = await withBinanceIpGate(() => fetch(FUTURES_TIME_URL));
    const localAfter = Date.now();
    if (res.status === 418 || res.status === 429) {
      const body = await res.clone().text().catch(() => '');
      const waitMs = parseCooldownMs(body, res.headers.get('retry-after'), 0);
      reportBinanceRateLimit(waitMs);
      throw new Error(`同步币安服务器时间限频 HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`同步币安服务器时间失败 HTTP ${res.status}`);
    const used = Number(res.headers.get('x-mbx-used-weight-1m'));
    if (Number.isFinite(used)) reportBinanceUsedWeight(used);
    const data = await res.json();
    const serverTime = Number(data?.serverTime);
    if (!Number.isFinite(serverTime)) throw new Error('同步币安服务器时间失败：无 serverTime');
    serverTimeOffsetMs = serverTime - Math.floor((localBefore + localAfter) / 2);
    lastTimeSyncAt = Date.now();
    return serverTimeOffsetMs;
  })().finally(() => {
    timeSyncPromise = null;
  });
  return timeSyncPromise;
};

const serverTimestamp = () => Date.now() + serverTimeOffsetMs;
const isTimestampError = response =>
  response?.code === -1021 || /timestamp/i.test(String(response?.msg || response?.message || ''));

export const signedRequestVerbose = async ({ method = 'GET', base, path, params = {} }) => {
  const { apiKey, privateKey } = getApiConfig();
  if (!apiKey || !privateKey) {
    throw new Error('请先配置 API Key（GATSBY_BINANCE_API_KEY / GATSBY_BINANCE_PRIVATE_KEY）');
  }

  return enqueuePrivate(async () => {
    const sendOnce = async attempt => {
      await waitBinanceBanIfNeeded();
      await syncServerTime();
      const query = { ...params, timestamp: serverTimestamp(), recvWindow: RECV_WINDOW_MS };
      const qs = new URLSearchParams(query).toString();
      const signature = await sign(qs, privateKey);
      const url = `${base}${path}?${qs}&signature=${encodeURIComponent(signature)}`;
      const request = {
        url: `${base}${path}?${qs}&signature=${mask(signature)}`,
        method,
        headers: { 'X-MBX-APIKEY': mask(apiKey) },
        body: null,
      };
      try {
        const res = await withBinanceIpGate(() =>
          fetch(url, { method, headers: { 'X-MBX-APIKEY': apiKey } })
        );
        const bodyText = await res.clone().text().catch(() => '');
        let response = null;
        try {
          response = JSON.parse(bodyText || 'null');
        } catch (_) {
          response = null;
        }
        const rateLimitedHttp = res.status === 418 || res.status === 429;
        const rateLimitedBody =
          response?.code === -1003 ||
          /too many requests|way too many requests|banned until/i.test(bodyText || '');
        if (rateLimitedHttp || rateLimitedBody) {
          const cooldownMs = parseCooldownMs(bodyText, res.headers.get('retry-after'), attempt);
          reportBinanceRateLimit(cooldownMs);
          console.warn(
            `[Binance private] ${method} ${path} ${res.status}${
              response?.code != null ? ` code=${response.code}` : ''
            }，全局冷却 ${Math.ceil(cooldownMs / 1000)}s`
          );
          return {
            request,
            response,
            httpStatus: rateLimitedHttp ? res.status : 429,
            ok: false,
            error: response?.msg || 'Binance rate limited',
          };
        }
        const used = Number(res.headers.get('x-mbx-used-weight-1m'));
        if (Number.isFinite(used)) reportBinanceUsedWeight(used);
        // 币安偶发 HTTP 200 + body.code<0；业务失败不得当 ok
        const businessOk = !(response && typeof response === 'object' && Number(response.code) < 0);
        return { request, response, httpStatus: res.status, ok: res.ok && businessOk };
      } catch (e) {
        return { request, response: null, httpStatus: null, ok: false, error: e.message };
      }
    };

    let result = await sendOnce(0);
    for (
      let attempt = 0;
      (result.httpStatus === 418 || result.httpStatus === 429) && attempt < PRIVATE_MAX_RETRIES;
      attempt += 1
    ) {
      await waitBinanceBanIfNeeded();
      await sleep(300 + attempt * 200);
      result = await sendOnce(attempt + 1);
    }
    if (!result.ok && isTimestampError(result.response)) {
      await syncServerTime(true);
      result = await sendOnce(0);
    }
    return result;
  });
};
