// Simple market adapter to allow multiple exchange implementations.
// Default exchange is 'bitget'. Other exchanges can be registered via registerExchange.

import * as bitgetApi from '../bitget/api';
import * as binanceApi from '../binance/api';

const exchanges = {
  bitget: bitgetApi,
  binance: binanceApi,
};

let defaultExchange = 'bitget';

export function registerExchange(name, apiModule) {
  exchanges[name] = apiModule;
}

export function setDefaultExchange(name) {
  if (!exchanges[name]) throw new Error(`Exchange ${name} not registered`);
  defaultExchange = name;
}

function resolveApi(exchange) {
  const key = exchange || defaultExchange;
  const api = exchanges[key];
  if (!api) throw new Error(`No API registered for exchange: ${key}`);
  return api;
}

export async function getTradingPairs(opts = {}, exchange) {
  const api = resolveApi(exchange);
  if (typeof api.getTradingPairs !== 'function') throw new Error('getTradingPairs not implemented');
  return api.getTradingPairs(opts);
}

export async function getFutureKlineData(opts = {}, exchange) {
  const api = resolveApi(exchange);
  if (typeof api.getFutureKlineData !== 'function')
    throw new Error('getFutureKlineData not implemented');
  return api.getFutureKlineData(opts);
}

export async function getFutureTicker(opts = {}, exchange) {
  const api = resolveApi(exchange);
  if (typeof api.getFutureTicker !== 'function') throw new Error('getFutureTicker not implemented');
  return api.getFutureTicker(opts);
}

export async function getSpotTicker(opts = {}, exchange) {
  const api = resolveApi(exchange);
  if (typeof api.getSpotTicker !== 'function') throw new Error('getSpotTicker not implemented');
  return api.getSpotTicker(opts);
}

export function getRegisteredExchanges() {
  return Object.keys(exchanges);
}

export function getTradeUrl(symbol, exchangeName = defaultExchange, marketType = 'future') {
  const ex = (exchangeName || '').toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  // Normalize full symbol like BTCUSDT
  const full = sym.endsWith('USDT') ? sym : `${sym}USDT`;

  if (ex.startsWith('binance')) {
    // Binance futures link
    return `https://www.binance.com/en/futures/${full}`;
  }

  // Default to bitget pattern
  if (ex.startsWith('bitget')) {
    return `https://www.bitget.com/zh-CN/futures/usdt/${full}`;
  }

  // Fallback: no-exchange-specific link — point to Binance futures by default
  return `https://www.binance.com/en/futures/${full}`;
}

export default {
  registerExchange,
  setDefaultExchange,
  getTradingPairs,
  getFutureKlineData,
  getFutureTicker,
  getSpotTicker,
};
