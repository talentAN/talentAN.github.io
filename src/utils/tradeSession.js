/**
 * 线上"密码解锁交易"用的临时 session。
 * 密码本身从不落盘——用户在解锁弹窗里手动输入（或用自己临时跑在控制台、不落盘的脚本
 * 自动填入），换回来的 session token 只存在内存 + sessionStorage（关标签页就没了），
 * 过期时间由 workers/exchange-proxy 的 SESSION_TTL_MINUTES 决定，真正的过期判定始终
 * 以 Worker 校验为准，这里的本地记录只是用来决定要不要提前弹出解锁框。
 */

import { getProxyConfig } from './exchangeProxyConfig';

const STORAGE_KEY = 'exchange-trade-session';

let cachedToken = null;
let cachedExpiresAt = 0;

const readFromStorage = () => {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

const writeToStorage = (token, expiresAt) => {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  } catch (e) {
    // sessionStorage 不可用（隐私模式等）时退化成只在内存里存，刷新页面要重新解锁
  }
};

export const setTradeSession = (token, expiresAt) => {
  cachedToken = token;
  cachedExpiresAt = expiresAt;
  writeToStorage(token, expiresAt);
};

export const clearTradeSession = () => {
  cachedToken = null;
  cachedExpiresAt = 0;
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // ignore
  }
};

/** 返回还没过期的 session token，没有或已过期返回 null。 */
export const getTradeSession = () => {
  if (!cachedToken) {
    const stored = readFromStorage();
    if (stored?.token) {
      cachedToken = stored.token;
      cachedExpiresAt = stored.expiresAt;
    }
  }
  return cachedToken && Date.now() < cachedExpiresAt ? cachedToken : null;
};

/** session 剩余有效时间（毫秒），没有有效 session 返回 0——用于判断要不要提前续期。 */
export const getTradeSessionRemainingMs = () => {
  if (!getTradeSession()) return 0;
  return Math.max(0, cachedExpiresAt - Date.now());
};

/** 用密码换一个临时交易 session；成功返回 { ok: true }，失败返回 { ok: false, error }。 */
export const unlockTradeSession = async password => {
  const { proxyUrl, proxyToken } = getProxyConfig();
  if (!proxyUrl || !proxyToken) {
    return { ok: false, error: '请先配置签名代理（GATSBY_EXCHANGE_PROXY_URL / GATSBY_EXCHANGE_PROXY_TOKEN）' };
  }
  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proxyToken}` },
      body: JSON.stringify({ action: 'unlock', password }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok && data.sessionToken) {
      setTradeSession(data.sessionToken, data.expiresAt);
      return { ok: true };
    }
    return { ok: false, error: data?.error || '密码错误' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
