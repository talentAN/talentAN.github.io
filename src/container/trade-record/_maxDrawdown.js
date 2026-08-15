/**
 * 持仓期最大回撤（%）：开仓→平仓区间内，相对开仓价的最大不利偏离百分比
 *
 * 做多：(开仓均价 − 区间最低价) / 开仓均价 × 100
 * 做空：(区间最高价 − 开仓均价) / 开仓均价 × 100
 *
 * 按 record.exchange 选择 Bitget / Binance K 线源。
 */

import { EXCHANGE, resolveExchange } from './_schema';

const BITGET_CANDLES_URL = 'https://api.bitget.com/api/v2/mix/market/candles';
const BITGET_HISTORY_URL = 'https://api.bitget.com/api/v2/mix/market/history-candles';
const BINANCE_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PAGE_LIMIT = 200; // Bitget history-candles 上限 200
const BINANCE_PAGE_LIMIT = 1500;

function pickGranularity(holdMs) {
  const hours = holdMs / 3600000;
  if (hours <= 8) return '1m';
  if (hours <= 48) return '5m';
  if (hours <= 14 * 24) return '15m';
  if (hours <= 60 * 24) return '1H';
  return '4H';
}

function granMs(granularity) {
  const map = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1H': 60 * 60 * 1000,
    '4H': 4 * 60 * 60 * 1000,
    '1D': 24 * 60 * 60 * 1000,
  };
  return map[granularity] || 60 * 1000;
}

/** Bitget 粒度 → Binance interval（避免 binance normalize 把 15m 误判成 1m） */
function toBinanceInterval(granularity) {
  const map = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
  };
  return map[granularity] || '15m';
}

async function fetchBitgetPage(baseUrl, { symbol, granularity, startTime, endTime }) {
  const params = new URLSearchParams({
    symbol,
    granularity,
    productType: 'USDT-FUTURES',
    limit: String(PAGE_LIMIT),
    startTime: String(startTime),
    endTime: String(endTime),
  });
  const res = await fetch(`${baseUrl}?${params}`);
  const json = await res.json();
  if (json.code !== '00000' || !Array.isArray(json.data)) return [];
  return json.data
    .map(row => ({
      ts: Number(row[0]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
    }))
    .filter(c => !Number.isNaN(c.ts) && !Number.isNaN(c.high) && !Number.isNaN(c.low));
}

async function fetchBitgetCandles({ symbol, granularity, startTime, endTime }) {
  const all = [];
  let cursorEnd = endTime;
  const step = granMs(granularity);

  // history-candles 在 [start,end] 内返回「最靠近 end」的 limit 根，需从平仓时刻向前翻页
  for (let page = 0; page < 80 && cursorEnd > startTime; page++) {
    let batch = await fetchBitgetPage(BITGET_CANDLES_URL, {
      symbol,
      granularity,
      startTime,
      endTime: cursorEnd,
    });
    if (batch.length === 0) {
      batch = await fetchBitgetPage(BITGET_HISTORY_URL, {
        symbol,
        granularity,
        startTime,
        endTime: cursorEnd,
      });
    }
    if (batch.length === 0) break;

    batch.sort((a, b) => a.ts - b.ts);
    all.push(...batch);

    const oldest = batch[0].ts;
    if (oldest <= startTime) break;
    const nextEnd = oldest - step;
    if (nextEnd >= cursorEnd) break;
    cursorEnd = nextEnd;
    if (batch.length < PAGE_LIMIT) break;
  }

  const map = new Map();
  all.forEach(c => map.set(c.ts, c));
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

async function fetchBinanceCandles({ symbol, granularity, startTime, endTime }) {
  const interval = toBinanceInterval(granularity);
  const step = granMs(granularity);
  const all = [];
  let cursorStart = startTime;

  for (let page = 0; page < 80 && cursorStart < endTime; page++) {
    const params = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursorStart),
      endTime: String(endTime),
      limit: String(BINANCE_PAGE_LIMIT),
    });
    const res = await fetch(`${BINANCE_KLINES_URL}?${params}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    const batch = data
      .map(row => ({
        ts: Number(row[0]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
      }))
      .filter(c => !Number.isNaN(c.ts) && !Number.isNaN(c.high) && !Number.isNaN(c.low));

    if (!batch.length) break;
    all.push(...batch);

    const newest = batch[batch.length - 1].ts;
    const nextStart = newest + step;
    if (nextStart <= cursorStart) break;
    cursorStart = nextStart;
    if (batch.length < BINANCE_PAGE_LIMIT) break;
  }

  const map = new Map();
  all.forEach(c => map.set(c.ts, c));
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

async function fetchCandlesForRecord(record, { granularity, startTime, endTime }) {
  const exchange = resolveExchange(record);
  const params = { symbol: record.symbol, granularity, startTime, endTime };
  if (exchange === EXCHANGE.BINANCE) {
    return fetchBinanceCandles(params);
  }
  return fetchBitgetCandles(params);
}

/**
 * @param {object} record 标准交易记录
 * @returns {Promise<number|null>} 最大回撤 %（≥0），失败返回 null
 */
export async function computeMaxDrawdownPct(record) {
  if (!record || record.type === 'summery') return null;

  const symbol = record.symbol;
  const ctime = Number(record.ctime);
  const utime = Number(record.utime);
  const openAvg = parseFloat(record.openAvgPrice);
  const side = record.holdSide;

  if (!symbol || !ctime || !utime || utime < ctime) return null;
  if (Number.isNaN(openAvg) || openAvg <= 0) return null;
  if (side !== 'long' && side !== 'short') return null;

  if (utime === ctime) return 0;

  const holdMs = utime - ctime;
  const granularity = pickGranularity(holdMs);
  const candles = await fetchCandlesForRecord(record, {
    granularity,
    startTime: ctime,
    endTime: utime,
  });

  const g = granMs(granularity);
  const inHold = candles.filter(c => c.ts + g > ctime && c.ts < utime);
  if (inHold.length === 0) return null;

  let adversePct = 0;
  if (side === 'long') {
    const minLow = Math.min(...inHold.map(c => c.low));
    adversePct = Math.max(0, ((openAvg - minLow) / openAvg) * 100);
  } else {
    const maxHigh = Math.max(...inHold.map(c => c.high));
    adversePct = Math.max(0, ((maxHigh - openAvg) / openAvg) * 100);
  }

  return Math.round(adversePct * 100) / 100;
}

/** @deprecated 使用 computeMaxDrawdownPct */
export const computeMaxDrawdownR = computeMaxDrawdownPct;

/**
 * 为缺少 maxDrawdown 的记录补全（可强制覆盖）
 */
export async function fillMaxDrawdowns(records, opts = {}) {
  const { force = false, onProgress } = opts;
  const out = [];

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 'summery' || r.ignore) {
      out.push(r);
      continue;
    }
    const has =
      r.maxDrawdown != null &&
      String(r.maxDrawdown).trim() !== '' &&
      !Number.isNaN(parseFloat(r.maxDrawdown));
    if (has && !force) {
      out.push({ ...r, exchange: resolveExchange(r) });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const dd = await computeMaxDrawdownPct(r);
      out.push(
        dd == null
          ? { ...r, exchange: resolveExchange(r) }
          : { ...r, exchange: resolveExchange(r), maxDrawdown: String(dd) }
      );
      onProgress?.({ index: i, total: records.length, symbol: r.symbol, maxDrawdown: dd });
    } catch (e) {
      console.warn(`maxDrawdown 计算失败 ${r.symbol} ${r.positionId}`, e);
      out.push({ ...r, exchange: resolveExchange(r) });
      onProgress?.({ index: i, total: records.length, symbol: r.symbol, error: e });
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  return out;
}
