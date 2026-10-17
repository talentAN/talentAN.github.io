/**
 * 币安 U 本位 User Data Stream：listenKey 创建 / 续命 / 关闭。
 * 这类接口只需 API Key，不需要签名；HTTP 仍走统一 IP 门闩。
 * 文档：https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams
 */

import { getApiConfig } from '../utils/auth';
import {
  withBinanceIpGate,
  reportBinanceRateLimit,
  reportBinanceUsedWeight,
  waitBinanceBanIfNeeded,
} from '../../market/_fetchGate';

const FUTURES_BASE = 'https://fapi.binance.com';
const LISTEN_KEY_PATH = '/fapi/v1/listenKey';

const parseCooldownMs = (body, retryAfter) => {
  const match = String(body || '').match(/banned until\s+(\d+)/i);
  const bannedAt = match ? Number(match[1]) : 0;
  const fromBan = bannedAt > Date.now() ? bannedAt - Date.now() + 1000 : 0;
  const retrySec = Number(retryAfter);
  const fromRetry = retrySec > 0 ? retrySec * 1000 : 0;
  return Math.max(fromBan, fromRetry, 20000);
};

const listenKeyRequest = async method => {
  const { apiKey } = getApiConfig();
  if (!apiKey) {
    return {
      ok: false,
      error: '请先配置 GATSBY_BINANCE_API_KEY',
      httpStatus: null,
      response: null,
    };
  }
  try {
    await waitBinanceBanIfNeeded();
    const res = await withBinanceIpGate(() =>
      fetch(`${FUTURES_BASE}${LISTEN_KEY_PATH}`, {
        method,
        headers: { 'X-MBX-APIKEY': apiKey },
      })
    );
    const httpStatus = res.status;
    const bodyText = await res.clone().text().catch(() => '');
    let response = null;
    try {
      response = JSON.parse(bodyText || 'null');
    } catch (_) {
      response = null;
    }
    if (
      httpStatus === 418 ||
      httpStatus === 429 ||
      response?.code === -1003 ||
      /too many requests|banned until/i.test(bodyText || '')
    ) {
      reportBinanceRateLimit(parseCooldownMs(bodyText, res.headers.get('retry-after')));
    }
    const used = Number(res.headers.get('x-mbx-used-weight-1m'));
    if (Number.isFinite(used)) reportBinanceUsedWeight(used);
    const ok = res.ok && !response?.code;
    return {
      ok,
      httpStatus,
      response,
      error: ok ? null : response?.msg || response?.message || `HTTP ${httpStatus}`,
      listenKey: response?.listenKey || null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), httpStatus: null, response: null };
  }
};

/** POST /fapi/v1/listenKey */
export const createFuturesListenKey = () => listenKeyRequest('POST');

/** PUT /fapi/v1/listenKey — 建议每 30 分钟一次，60 分钟未续命会过期 */
export const keepaliveFuturesListenKey = () => listenKeyRequest('PUT');

/** DELETE /fapi/v1/listenKey */
export const closeFuturesListenKey = () => listenKeyRequest('DELETE');

/**
 * User Data Stream WebSocket URL 候选（按优先级）。
 * 2026 起部分环境要求 /private/ws + events=；旧环境仍可用 /ws/<listenKey>。
 */
export const buildFuturesUserDataWsUrls = listenKey => {
  const key = encodeURIComponent(listenKey);
  const events = [
    'ORDER_TRADE_UPDATE',
    'ACCOUNT_UPDATE',
    'ALGO_UPDATE',
    'ALGO_ORDER_UPDATE',
    'listenKeyExpired',
  ].join('/');
  return [
    `wss://fstream.binance.com/private/ws?listenKey=${key}&events=${encodeURIComponent(events)}`,
    `wss://fstream.binance.com/private/stream?listenKey=${key}&events=${encodeURIComponent(events)}`,
    `wss://fstream.binance.com/ws/${listenKey}`,
  ];
};
