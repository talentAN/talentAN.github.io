// Minimal Binance adapter implementing the functions our app expects.
// Uses public REST endpoints; these calls do not require API keys for market data.

const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

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
    // Binance returns array of arrays; wrap into { data: [...] } to match bitget shape
    return { data };
  } catch (e) {
    console.error('binance getFutureKlineData error', e);
    return { data: [] };
  }
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

// Create an authenticated client using API key + secret.
export function createAuthenticatedClient({ key, secret } = {}) {
  if (!key || !secret) {
    throw new Error('Binance auth client requires key and secret');
  }

  const sign = query => {
    try {
      // try node crypto
      // eslint-disable-next-line global-require
      const crypto = require('crypto');
      return crypto.createHmac('sha256', secret).update(query).digest('hex');
    } catch (e) {
      // Browser environment: try subtle crypto
      if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        // synchronous HMAC is not available; throw to indicate unsupported in browser
        throw new Error('Signing not supported in browser environment');
      }
      throw e;
    }
  };

  const signedGet = async (base, path, params = {}) => {
    const timestamp = Date.now();
    const qs = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = sign(qs);
    const url = `${base}${path}?${qs}&signature=${signature}`;
    const res = await fetch(url, { headers: { 'X-MBX-APIKEY': key } });
    return res.json ? res.json() : {};
  };

  return {
    // expose public methods
    getTradingPairs,
    getSpotTradingPairs,
    getFutureKlineData,
    getSpotKlineData,
    getFutureTicker,
    getSpotTicker,
    // authenticated example
    getFutureAccount: async () => {
      try {
        return await signedGet(FUTURES_BASE, '/fapi/v2/account');
      } catch (e) {
        console.error('binance getFutureAccount error', e);
        return {};
      }
    },
  };
}

export default {
  getTradingPairs,
  getSpotTradingPairs,
  getFutureKlineData,
  getSpotKlineData,
  getFutureTicker,
  getSpotTicker,
};
