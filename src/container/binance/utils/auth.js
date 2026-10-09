/**
 * 币安签名请求（浏览器端，本地直接签）。
 * 币安会拦 Cloudflare Workers 的出口 IP（已用裸请求验证过：不签名、不带 key 的
 * GET /fapi/v1/time 一样被 403），所以币安这部分退回本地直接签名——用你自己电脑
 * 的家庭宽带 IP 发请求，不经过 Worker。私钥只放本地 .env.development，跟其它本地
 * 凭证一样，不进 CI/发布产物。Bitget 那边不受影响，继续走 workers/exchange-proxy。
 */

const FUTURES_TIME_URL = 'https://fapi.binance.com/fapi/v1/time';
const TIME_SYNC_TTL_MS = 5 * 60 * 1000;
const RECV_WINDOW_MS = 10000;
const PRIVATE_MAX_CONCURRENT = 1;
const PRIVATE_MIN_GAP_MS = 120;
const PRIVATE_MAX_RETRIES = 3;
const PRIVATE_SOFT_WEIGHT = 1500;
const PRIVATE_COOLDOWN_PAD_MS = 1000;

let privateActive = 0;
let privateLastStartAt = 0;
let privateQueue = Promise.resolve();
let privateBannedUntil = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const enqueuePrivate = task => {
  const run = privateQueue.then(task, task);
  privateQueue = run.catch(() => undefined);
  return run;
};

const parseCooldownMs = (body, retryAfter) => {
  const match = String(body || '').match(/banned until\s+(\d+)/i);
  const bannedAt = match ? Number(match[1]) : 0;
  const retryAt = Number(retryAfter) > 0 ? Date.now() + Number(retryAfter) * 1000 : 0;
  const deadline = Math.max(bannedAt, retryAt);
  return deadline > Date.now() ? deadline - Date.now() + PRIVATE_COOLDOWN_PAD_MS : 0;
};

const waitPrivateCooldown = async () => {
  const remaining = privateBannedUntil - Date.now();
  if (remaining > 0) await sleep(remaining);
  const gap = PRIVATE_MIN_GAP_MS - (Date.now() - privateLastStartAt);
  if (gap > 0) await sleep(gap);
};

const schedulePrivate = async task => enqueuePrivate(async () => {
  while (privateActive >= PRIVATE_MAX_CONCURRENT) await sleep(PRIVATE_MIN_GAP_MS);
  await waitPrivateCooldown();
  privateActive += 1;
  privateLastStartAt = Date.now();
  try {
    return await task();
  } finally {
    privateActive -= 1;
  }
});

export const getApiConfig = () => ({
  apiKey: process.env.GATSBY_BINANCE_API_KEY,
  privateKey: process.env.GATSBY_BINANCE_PRIVATE_KEY,
});

const pemToArrayBuffer = pem => {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
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
    cachedKeyPromise = crypto.subtle.importKey('pkcs8', pemToArrayBuffer(pem), { name: 'Ed25519' }, false, ['sign']);
  }
  return cachedKeyPromise;
};
const sign = async (query, privateKeyPem) => {
  const key = await importPrivateKey(privateKeyPem);
  return arrayBufferToBase64(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(query)));
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
    const localBefore = Date.now();
    const res = await fetch(FUTURES_TIME_URL);
    const localAfter = Date.now();
    if (!res.ok) throw new Error(`同步币安服务器时间失败 HTTP ${res.status}`);
    const data = await res.json();
    const serverTime = Number(data?.serverTime);
    if (!Number.isFinite(serverTime)) throw new Error('同步币安服务器时间失败：无 serverTime');
    serverTimeOffsetMs = serverTime - Math.floor((localBefore + localAfter) / 2);
    lastTimeSyncAt = Date.now();
    return serverTimeOffsetMs;
  })().finally(() => { timeSyncPromise = null; });
  return timeSyncPromise;
};
const serverTimestamp = () => Date.now() + serverTimeOffsetMs;
const isTimestampError = response => response?.code === -1021 || /timestamp/i.test(String(response?.msg || response?.message || ''));

export const signedRequestVerbose = async ({ method = 'GET', base, path, params = {} }) => {
  const { apiKey, privateKey } = getApiConfig();
  if (!apiKey || !privateKey) throw new Error('请先配置 API Key（GATSBY_BINANCE_API_KEY / GATSBY_BINANCE_PRIVATE_KEY）');

  return schedulePrivate(async () => {
    const sendOnce = async () => {
      await syncServerTime();
      const query = { ...params, timestamp: serverTimestamp(), recvWindow: RECV_WINDOW_MS };
      const qs = new URLSearchParams(query).toString();
      const signature = await sign(qs, privateKey);
      const url = `${base}${path}?${qs}&signature=${encodeURIComponent(signature)}`;
      const request = { url: `${base}${path}?${qs}&signature=${mask(signature)}`, method, headers: { 'X-MBX-APIKEY': mask(apiKey) }, body: null };
      try {
        const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': apiKey } });
        const bodyText = await res.clone().text().catch(() => '');
        const response = JSON.parse(bodyText || 'null');
        if (res.status === 418 || res.status === 429) {
          const cooldownMs = parseCooldownMs(bodyText, res.headers.get('retry-after')) || Math.min(120000, 3000 * 2 ** PRIVATE_MAX_RETRIES);
          privateBannedUntil = Math.max(privateBannedUntil, Date.now() + cooldownMs);
          console.warn(`[Binance private] ${method} ${path} ${res.status}，冷却 ${Math.ceil(cooldownMs / 1000)}s`);
        }
        const used = Number(res.headers.get('x-mbx-used-weight-1m'));
        if (Number.isFinite(used) && used > PRIVATE_SOFT_WEIGHT) await sleep(Math.min(20000, (used - PRIVATE_SOFT_WEIGHT) * 20));
        return { request, response, httpStatus: res.status, ok: res.ok };
      } catch (e) {
        return { request, response: null, httpStatus: null, ok: false, error: e.message };
      }
    };

    let result = await sendOnce();
    for (let attempt = 0; (result.httpStatus === 418 || result.httpStatus === 429) && attempt < PRIVATE_MAX_RETRIES; attempt += 1) {
      await waitPrivateCooldown();
      result = await sendOnce();
    }
    if (!result.ok && isTimestampError(result.response)) {
      await syncServerTime(true);
      result = await sendOnce();
    }
    return result;
  });
};