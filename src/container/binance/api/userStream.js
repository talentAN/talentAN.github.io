/**
 * 币安 U 本位 User Data Stream：listenKey 创建 / 续命 / 关闭。
 * 这类接口只需 API Key，不需要签名。
 * 文档：https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams
 */

import { getApiConfig } from '../utils/auth';

const FUTURES_BASE = 'https://fapi.binance.com';
const LISTEN_KEY_PATH = '/fapi/v1/listenKey';

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
    const res = await fetch(`${FUTURES_BASE}${LISTEN_KEY_PATH}`, {
      method,
      headers: { 'X-MBX-APIKEY': apiKey },
    });
    const httpStatus = res.status;
    const response = await res.json().catch(() => null);
    const ok = res.ok && !response?.code;
    return {
      ok,
      httpStatus,
      response,
      error: ok
        ? null
        : response?.msg || response?.message || `HTTP ${httpStatus}`,
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
  // 官方新格式：events 用 / 分隔（见 USDⓈ-M Futures WS 升级说明）
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
