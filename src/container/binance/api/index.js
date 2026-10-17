// Minimal Binance adapter implementing the functions our app expects.
// 公共行情一律：统一门闩 + 单次尝试（429 全局限流后由外层再排队，禁止门闩内连打）。

import { signedRequestVerbose } from '../utils/auth';
import {
  withMarketFetchGate,
  reportBinanceRateLimit,
  reportBinanceUsedWeight,
  getBinanceBanRemaining,
  waitBinanceBanIfNeeded,
} from '../../market/_fetchGate';

const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** klines limit>1000 → weight 10；封顶 1000（weight 5） */
const MAX_KLINE_LIMIT = 1000;

const parseBanWaitMs = (text, retryAfter, attempt) => {
  const match = String(text || '').match(/banned until\s+(\d+)/i);
  const bannedAt = match ? Number(match[1]) : 0;
  const fromBan = bannedAt > Date.now() ? bannedAt - Date.now() + 60 * 1000 : 0;
  const fromRetry = Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 0;
  const backoff = Math.min(120000, 5000 * 2 ** attempt);
  return Math.max(fromBan, fromRetry, backoff, 15000);
};

export { getBinanceBanRemaining };

const throwRateLimited = (status, body, retryAfter) => {
  const waitMs = parseBanWaitMs(body, retryAfter, 0);
  reportBinanceRateLimit(waitMs);
  console.warn(`Binance ${status || -1003} 限频，全局冷却 ${Math.round(waitMs / 1000)}s`);
  const err = new Error(`Binance 限频冷却中 ${Math.round(waitMs / 1000)}s`);
  err.rateLimited = true;
  err.status = status;
  err.waitMs = waitMs;
  throw err;
};

const bodyLooksRateLimited = text => {
  if (!text) return false;
  if (/"code"\s*:\s*-1003\b/.test(text)) return true;
  return /too many requests|way too many requests|banned until/i.test(text);
};

/**
 * 单次 HTTP（必须已在门闩内）。429/418/-1003 只记限流并抛错，不在门闩内重试。
 */
const fetchOnce = async (url, { signal } = {}) => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch(url, { signal });
  const retryAfter = Number(response.headers.get('retry-after'));

  if (response.status === 418 || response.status === 429) {
    const body = await response.clone().text().catch(() => '');
    throwRateLimited(response.status, body, retryAfter);
  }

  if (!response.ok) {
    const body = await response.clone().text().catch(() => '');
    if (bodyLooksRateLimited(body)) {
      throwRateLimited(response.status, body, retryAfter);
    }
    const error = new Error(`Binance 请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }

  // 少数网关会 200 + 短 JSON code=-1003；大包（K 线数组）跳过 peek
  const len = Number(response.headers.get('content-length'));
  if (!Number.isFinite(len) || len < 512) {
    const peek = await response.clone().text().catch(() => '');
    if (bodyLooksRateLimited(peek)) {
      throwRateLimited(response.status, peek, retryAfter);
    }
  }

  const used = Number(response.headers.get('x-mbx-used-weight-1m'));
  if (Number.isFinite(used)) reportBinanceUsedWeight(used);
  return response;
};

/**
 * 公共行情唯一出口：
 * 1) 等解禁 2) 门闩放行 3) 单次 fetch
 * 429 后整站冷却，再重新排队（不会在门闩槽位里连打放大 QPS）
 */
const publicFetch = async (url, { signal, retries = 1 } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await waitBinanceBanIfNeeded();
    try {
      return await withMarketFetchGate(() => fetchOnce(url, { signal }));
    } catch (e) {
      lastErr = e;
      // 限流后只再排一次队；门闩预算应避免二次 429，禁止门闩内连打
      if (e?.rateLimited && attempt < retries) {
        await waitBinanceBanIfNeeded();
        await sleep(400 + attempt * 200);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Binance 限频重试次数已用尽');
};

function normalizeInterval(granularity) {
  if (!granularity) return '1d';
  const g = String(granularity).toLowerCase();
  if (g.includes('1d')) return '1d';
  if (g.includes('1h')) return '1h';
  if (g.includes('1m')) return '1m';
  if (/^\d+m$/.test(g)) return g;
  if (/^\d+d$/.test(g)) return g;
  if (/^\d+h$/.test(g)) return g;
  return '1d';
}

const clampKlineLimit = limit => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.min(Math.floor(n), MAX_KLINE_LIMIT);
};

export const getTradingPairs = async () => {
  try {
    const res = await publicFetch(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    return symbols
      .filter(s => s.symbol && s.symbol.endsWith('USDT') && s.status === 'TRADING')
      .map(s => ({ symbol: s.symbol }));
  } catch (e) {
    console.error('binance getTradingPairs error', e);
    return [];
  }
};

export const getContracts = async () => {
  try {
    const res = await publicFetch(`${FUTURES_BASE}/fapi/v1/exchangeInfo`);
    const data = await res.json();
    return Array.isArray(data.symbols) ? data.symbols : [];
  } catch (e) {
    console.error('binance getContracts error', e);
    return [];
  }
};

export const getSpotTradingPairs = async () => {
  try {
    const res = await publicFetch(`${SPOT_BASE}/api/v3/exchangeInfo`);
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
  signal,
} = {}) => {
  try {
    const interval = normalizeInterval(granularity);
    const safeLimit = clampKlineLimit(limit);
    let url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const ret = await publicFetch(url, { signal });
    const data = await ret.json();
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
 */
export const getAllFutureDailyKlines = async ({
  symbol,
  signal,
  onPage,
  endTime = Date.now(),
  /** 最多翻页数；缺省不限制。暴100 资格校验用有限页避免老币堵门闩 */
  maxPages = null,
}) => {
  const pageSize = 1000;
  const pageCap =
    Number.isFinite(Number(maxPages)) && Number(maxPages) > 0
      ? Math.floor(Number(maxPages))
      : null;
  const all = new Map();
  let cursor = endTime;
  let page = 0;

  while (cursor > 0) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (pageCap != null && page >= pageCap) break;
    const url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${pageSize}&endTime=${cursor}`;
    const response = await publicFetch(url, { signal });
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error(raw?.msg || 'Binance K线响应异常');
    if (!raw.length) break;

    raw.forEach(c => all.set(Number(c[0]), [c[0], c[1], c[2], c[3], c[4], c[5], c[7]]));
    page += 1;
    onPage?.({ page, loaded: all.size });

    const oldest = Number(raw[0][0]);
    if (raw.length < pageSize || !Number.isFinite(oldest) || oldest >= cursor) break;
    cursor = oldest - 1;
  }

  return [...all.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
};

export const getSpotKlineData = async ({
  symbol,
  granularity,
  limit = 2,
  startTime,
  endTime,
  signal,
} = {}) => {
  try {
    const interval = normalizeInterval(granularity);
    const safeLimit = clampKlineLimit(limit);
    let url = `${SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${safeLimit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const ret = await publicFetch(url, { signal });
    const data = await ret.json();
    return { data };
  } catch (e) {
    console.error('binance getSpotKlineData error', e);
    return { data: [] };
  }
};

export const getFutureTicker = async symbol => {
  try {
    const res = await publicFetch(
      `${FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
    );
    return await res.json();
  } catch (e) {
    console.error('binance getFutureTicker error', e);
    return {};
  }
};

export const getFutureFundingRate = async symbol => {
  const response = await publicFetch(
    `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
  );
  const data = await response.json();
  if (data?.code) {
    throw new Error(data?.msg || 'Binance 资金费率请求失败');
  }
  const fundingRate = Number(data?.lastFundingRate);
  if (!Number.isFinite(fundingRate)) throw new Error('Binance 资金费率响应无效');
  return { symbol, fundingRate, nextFundingTime: Number(data?.nextFundingTime) || null, raw: data };
};

export const getSpotTicker = async symbol => {
  try {
    const res = await publicFetch(`${SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`);
    return await res.json();
  } catch (e) {
    console.error('binance getSpotTicker error', e);
    return {};
  }
};

export function createAuthenticatedClient() {
  return {
    getTradingPairs,
    getSpotTradingPairs,
    getFutureKlineData,
    getAllFutureDailyKlines,
    getSpotKlineData,
    getFutureTicker,
    getSpotTicker,
    getFutureAccount: async () => {
      try {
        const { response } = await signedRequestVerbose({
          method: 'GET',
          base: FUTURES_BASE,
          path: '/fapi/v2/account',
        });
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
  getFutureFundingRate,
};
