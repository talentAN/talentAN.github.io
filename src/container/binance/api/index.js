// Minimal Binance adapter implementing the functions our app expects.
// Uses public REST endpoints; these calls do not require API keys for market data.

import { signedRequestVerbose } from '../utils/auth';

const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

// fapi 公共接口权重上限 2400/min，接近软上限就主动降速，避免升级成 418 封禁
const WEIGHT_SOFT_LIMIT = 1500;
// 418/429 是按 IP 封禁，全局共享解禁时间，避免其它请求继续撞墙
let bannedUntil = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const getBinanceBanRemaining = () => Math.max(0, bannedUntil - Date.now());

// 带限频退避的 fetch：遇 418/429 按 Retry-After 等待并重试，权重吃紧时自动降速
const fetchWithBackoff = async (url, { signal, retries = 6 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const remaining = bannedUntil - Date.now();
    if (remaining > 0) await sleep(Math.min(remaining, 30000));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const response = await fetch(url, { signal });

    if (response.status === 418 || response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? (retryAfter + 1) * 1000
          : Math.min(120000, 3000 * 2 ** attempt);
      bannedUntil = Date.now() + waitMs;
      console.warn(`Binance ${response.status} 限频，等待 ${Math.round(waitMs / 1000)}s 后重试`);
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Binance 请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }

    const used = Number(response.headers.get('x-mbx-used-weight-1m'));
    if (Number.isFinite(used) && used > WEIGHT_SOFT_LIMIT) {
      await sleep(Math.min(20000, (used - WEIGHT_SOFT_LIMIT) * 20));
    }
    return response;
  }
  throw new Error('Binance 限频重试次数已用尽，请稍后再试');
};

function normalizeInterval(granularity) {
  if (!granularity) return '1d';
  const g = String(granularity).toLowerCase();
  if (g.includes('1d')) return '1d';
  if (g.includes('1h')) return '1h';
  if (g.includes('1m')) return '1m';
  // fallback: try to extract number + unit
  if (/^\d+d$/.test(g)) return g;
  if (/^\d+h$/.test(g)) return g;
  return '1d';
}

export const getTradingPairs = async () => {
  try {
    const res = await fetch(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    // return symbols as array of { symbol }
    const filtered = symbols
      .filter(s => s.symbol && s.symbol.endsWith('USDT') && s.status === 'TRADING')
      .map(s => ({ symbol: s.symbol }));
    return filtered;
  } catch (e) {
    console.error('binance getTradingPairs error', e);
    return [];
  }
};

// 获取合约配置；underlyingType / underlyingSubType 可识别股票、商品及其他 TradFi 标的
export const getContracts = async () => {
  try {
    const res = await fetch(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    return Array.isArray(data.symbols) ? data.symbols : [];
  } catch (e) {
    console.error('binance getContracts error', e);
    return [];
  }
};

export const getSpotTradingPairs = async () => {
  try {
    const res = await fetch(`${SPOT_BASE}/api/v3/exchangeInfo`);
    const data = await res.json();
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    return symbols.filter(s => s.symbol && s.status === 'TRADING').map(s => ({ symbol: s.symbol }));
  } catch (e) {
    console.error('binance getSpotTradingPairs error', e);
    return [];
  }
};

export const getFutureKlineData = async ({
  symbol,
  granularity,
  limit = 2,
  startTime,
  endTime,
}) => {
  try {
    const interval = normalizeInterval(granularity);
    let url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const ret = await fetch(url);
    const data = await ret.json();
    // 对齐 Bitget 形状: [ts, open, high, low, close, baseVol, quoteVol]
    const normalized = Array.isArray(data)
      ? data.map(c => [c[0], c[1], c[2], c[3], c[4], c[5], c[7]])
      : [];
    return { data: normalized };
  } catch (e) {
    console.error('binance getFutureKlineData error', e);
    return { data: [] };
  }
};

/**
 * 分页拉取 Binance U 本位合约的全部日线。
 * 从最新向历史回溯；单页上限 1500，直到交易对上市首日。
 */
export const getAllFutureDailyKlines = async ({
  symbol,
  signal,
  onPage,
  endTime = Date.now(),
}) => {
  // 1000 根的请求权重为 5；1500 根权重为 10。1000 综合更稳。
  const pageSize = 1000;
  const all = new Map();
  let cursor = endTime;
  let page = 0;

  while (cursor > 0) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${pageSize}&endTime=${cursor}`;
    const response = await fetchWithBackoff(url, { signal });
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error(raw?.msg || 'Binance K线响应异常');
    if (!raw.length) break;

    raw.forEach(c => all.set(Number(c[0]), [c[0], c[1], c[2], c[3], c[4], c[5], c[7]]));
    page += 1;
    onPage?.({ page, loaded: all.size });

    const oldest = Number(raw[0][0]);
    if (raw.length < pageSize || !Number.isFinite(oldest) || oldest >= cursor) break;
    cursor = oldest - 1;
    // 单页 1000 根的权重为 5；300ms 一页约 1000 权重/分钟，留出一半余量给其它请求。
    await sleep(300);
  }

  return [...all.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
};

export const getSpotKlineData = async ({ symbol, granularity, limit = 2, startTime, endTime }) => {
  try {
    const interval = normalizeInterval(granularity);
    let url = `${SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const ret = await fetch(url);
    const data = await ret.json();
    return { data };
  } catch (e) {
    console.error('binance getSpotKlineData error', e);
    return { data: [] };
  }
};

export const getFutureTicker = async symbol => {
  try {
    const res = await fetch(`${FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('binance getFutureTicker error', e);
    return {};
  }
};

/** 获取 U 本位合约当前资金费率。 */
export const getFutureFundingRate = async symbol => {
  const response = await fetch(
    `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
  );
  const data = await response.json();
  if (!response.ok || data?.code) {
    throw new Error(data?.msg || `Binance 资金费率请求失败 (${response.status})`);
  }
  const fundingRate = Number(data?.lastFundingRate);
  if (!Number.isFinite(fundingRate)) throw new Error('Binance 资金费率响应无效');
  return { symbol, fundingRate, nextFundingTime: Number(data?.nextFundingTime) || null, raw: data };
};

export const getSpotTicker = async symbol => {
  try {
    const res = await fetch(`${SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('binance getSpotTicker error', e);
    return {};
  }
};

// Create an authenticated client. Signs locally (utils/auth.js) with the
// Ed25519 private key from GATSBY_BINANCE_PRIVATE_KEY — Binance blocks
// Cloudflare Workers' egress IPs, so this can't go through the proxy Worker.
export function createAuthenticatedClient() {
  return {
    // expose public methods
    getTradingPairs,
    getSpotTradingPairs,
    getFutureKlineData,
    getAllFutureDailyKlines,
    getSpotKlineData,
    getFutureTicker,
    getSpotTicker,
    // authenticated example
    getFutureAccount: async () => {
      try {
        const { response } = await signedRequestVerbose({ method: 'GET', base: FUTURES_BASE, path: '/fapi/v2/account' });
        return response || {};
      } catch (e) {
        console.error('binance getFutureAccount error', e);
        return {};
      }
    },
  };
}

export default {
  getTradingPairs,
  getContracts,
  getSpotTradingPairs,
  getFutureKlineData,
  getAllFutureDailyKlines,
  getSpotKlineData,
  getFutureTicker,
  getSpotTicker,
};
