/**
 * 一次性脚本：根据 Bitget K 线回填 contract-record/all.json 的 maxDrawdown（%）
 * 用法：node scripts/fill-max-drawdown.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../contract-record/all.json');

const CANDLES_URL = 'https://api.bitget.com/api/v2/mix/market/candles';
const HISTORY_URL = 'https://api.bitget.com/api/v2/mix/market/history-candles';
const PAGE_LIMIT = 200;

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
  };
  return map[granularity] || 60 * 1000;
}

async function fetchPage(baseUrl, { symbol, granularity, startTime, endTime }) {
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

  // history-candles 在区间内返回最靠近 end 的 limit 根，从平仓向前翻页
  for (let page = 0; page < 80 && cursorEnd > startTime; page++) {
    let batch = await fetchPage(CANDLES_URL, {
      symbol,
      granularity,
      startTime,
      endTime: cursorEnd,
    });
    if (batch.length === 0) {
      batch = await fetchPage(HISTORY_URL, {
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

async function computeMaxDrawdownPct(record) {
  const symbol = record.symbol;
  const ctime = Number(record.ctime);
  const utime = Number(record.utime);
  const openAvg = parseFloat(record.openAvgPrice);
  const side = record.holdSide;

  if (!symbol || !ctime || !utime || utime < ctime) return null;
  if (!(openAvg > 0)) return null;
  if (side !== 'long' && side !== 'short') return null;
  if (utime === ctime) return 0;

  const granularity = pickGranularity(utime - ctime);
  const candles = await fetchBitgetCandles({
    symbol,
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

async function main() {
  const records = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 'summery' || r.ignore) continue;

    process.stdout.write(`[${i + 1}/${records.length}] ${r.symbol} ${r.holdSide} ... `);
    try {
      const dd = await computeMaxDrawdownPct(r);
      if (dd == null) {
        console.log('skip(no kline)');
        fail++;
      } else {
        r.maxDrawdown = String(dd);
        console.log(`DD=${dd}%`);
        ok++;
      }
    } catch (e) {
      console.log(`err ${e.message}`);
      fail++;
    }
    await new Promise(res => setTimeout(res, 80));
  }

  fs.writeFileSync(FILE, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  console.log(`\nDone. filled=${ok} fail/skip=${fail} → ${FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
