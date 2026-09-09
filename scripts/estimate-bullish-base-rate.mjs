#!/usr/bin/env node
/**
 * 做多宇宙：全量拉取一次 → 写出两份 JSON
 *
 * 1) eligible-entries：合格「币对 × 开仓日」(开仓价=判定日收盘)
 * 2) klines-by-symbol：上述币对的日 K 缓存（含上市缓冲，供后续模式分析）
 * 3) base-rate summary：主基率等汇总
 *
 * 用法：node scripts/estimate-bullish-base-rate.mjs
 * 试跑：node scripts/estimate-bullish-base-rate.mjs --limit=20
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const FUTURES = 'https://fapi.binance.com';
const DAY = 86400000;
const START_DATE = '2022-01-01';
const START_TS = Date.parse(`${START_DATE}T00:00:00.000Z`);
const MIN_LISTING_DAYS = 30;
const HORIZON = 20;
/** 判定日前额外保留的日 K，供后续模式窗（≥100）分析 */
const LOOKBACK_BUFFER = 120;
const TOUCH = 0.5;
const STOP = -0.5;
const DEDUPE_GAP = 20;
const OUT_DIR = path.resolve('src/data/market/binance/bullish-base-rate');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

const fetchJson = async url => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    return res.json();
  }
  throw new Error(`fetch failed ${url}`);
};

const getSymbols = async () => {
  const data = await fetchJson(`${FUTURES}/fapi/v1/exchangeInfo`);
  return (data.symbols || [])
    .filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map(s => s.symbol)
    .sort();
};

/** 拉到足够覆盖 START 前 listing+lookback 的日 K */
const fetchAllDaily = async symbol => {
  const all = new Map();
  let cursor = Date.now();
  const oldestNeeded = START_TS - (MIN_LISTING_DAYS + LOOKBACK_BUFFER + HORIZON + 10) * DAY;

  while (cursor > 0) {
    const url = `${FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=1000&endTime=${cursor}`;
    const raw = await fetchJson(url);
    if (!Array.isArray(raw) || !raw.length) break;
    raw.forEach(c => all.set(Number(c[0]), c));
    const oldest = Number(raw[0][0]);
    if (raw.length < 1000 || !Number.isFinite(oldest) || oldest >= cursor) break;
    if (oldest < oldestNeeded) break;
    cursor = oldest - 1;
    await sleep(100);
  }

  return [...all.values()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(c => ({
      openTime: Number(c[0]),
      date: new Date(Number(c[0])).toISOString().slice(0, 10),
      open: +c[1],
      high: +c[2],
      low: +c[3],
      close: +c[4],
      volume: +c[5],
      quoteVolume: +c[7],
    }));
};

const forwardPath = (bars, i) => {
  const entry = bars[i].close;
  if (!(entry > 0)) return null;
  const target = entry * (1 + TOUCH);
  const stop = entry * (1 + STOP);
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let path = 'neither';

  for (let j = i + 1; j <= i + HORIZON; j += 1) {
    const bar = bars[j];
    if (bar.high > maxHigh) maxHigh = bar.high;
    if (bar.low < minLow) minLow = bar.low;
    const hitT = bar.high >= target;
    const hitS = bar.low <= stop;
    if (path !== 'neither') continue;
    if (hitS && hitT) path = 'stop_first';
    else if (hitS) path = 'stop_first';
    else if (hitT) path = 'target_first';
  }

  return {
    maxRet: maxHigh / entry - 1,
    minRet: minLow / entry - 1,
    path,
    success: maxHigh / entry - 1 >= TOUCH,
    stopFirst: path === 'stop_first',
  };
};

const compactBar = b => [
  b.openTime,
  b.open,
  b.high,
  b.low,
  b.close,
  b.volume,
  b.quoteVolume,
];

await fs.mkdir(OUT_DIR, { recursive: true });

const symbolsAll = await getSymbols();
const symbols = Number.isFinite(LIMIT) && LIMIT > 0 ? symbolsAll.slice(0, LIMIT) : symbolsAll;
console.log(`universe symbols ${symbols.length}/${symbolsAll.length}`);

const entries = [];
const klinesBySymbol = {};
const errors = [];
const byYear = {};
let dedupedSuccess = 0;

for (let s = 0; s < symbols.length; s += 1) {
  const symbol = symbols[s];
  process.stdout.write(`[${s + 1}/${symbols.length}] ${symbol} `);
  try {
    const bars = await fetchAllDaily(symbol);
    if (bars.length < MIN_LISTING_DAYS + HORIZON + 1) {
      console.log(`bars=${bars.length} skip-short`);
      continue;
    }

    const listedAt = bars[0].openTime;
    const listingDaysAtEnd = Math.floor((bars[bars.length - 1].openTime - listedAt) / DAY);
    if (listingDaysAtEnd < MIN_LISTING_DAYS) {
      console.log(`listingDays=${listingDaysAtEnd} skip-new`);
      continue;
    }

    // 缓存 K 线：从「可能用到的最早判定日」再往前 LOOKBACK_BUFFER
    const keepFrom = START_TS - LOOKBACK_BUFFER * DAY;
    const storedBars = bars.filter(b => b.openTime >= keepFrom || b.openTime === listedAt);
    // 保证含首根（上市代理）；若首根早于 keepFrom 也保留从 listedAt 起整段到末
    const forStore = bars[0].openTime < keepFrom
      ? bars
      : storedBars.length ? storedBars : bars;

    let localEntries = 0;
    let localSuccess = 0;
    let lastSuccessTs = null;

    for (let i = 0; i < bars.length; i += 1) {
      if (bars[i].openTime < START_TS) continue;
      if (bars[i].openTime - listedAt < MIN_LISTING_DAYS * DAY) continue;
      if (i + HORIZON >= bars.length) continue;

      const fwd = forwardPath(bars, i);
      if (!fwd) continue;

      const listingDays = Math.floor((bars[i].openTime - listedAt) / DAY);
      entries.push({
        symbol,
        judgeDate: bars[i].date,
        judgeOpenTime: bars[i].openTime,
        entry: bars[i].close,
        listingDays,
        horizon: HORIZON,
        maxRet: fwd.maxRet,
        minRet: fwd.minRet,
        path: fwd.path,
        success: fwd.success,
        stopFirst: fwd.stopFirst,
      });
      localEntries += 1;

      const year = bars[i].date.slice(0, 4);
      if (!byYear[year]) byYear[year] = { n: 0, success: 0, stopFirst: 0 };
      byYear[year].n += 1;
      if (fwd.success) {
        localSuccess += 1;
        byYear[year].success += 1;
        if (lastSuccessTs == null || bars[i].openTime - lastSuccessTs >= DEDUPE_GAP * DAY) {
          dedupedSuccess += 1;
          lastSuccessTs = bars[i].openTime;
        }
      }
      if (fwd.stopFirst) byYear[year].stopFirst += 1;
    }

    if (localEntries > 0) {
      klinesBySymbol[symbol] = {
        listedAt,
        listedDate: bars[0].date,
        barCount: forStore.length,
        /** [openTime, open, high, low, close, volume, quoteVolume] */
        bars: forStore.map(compactBar),
      };
    }

    console.log(`bars=${bars.length} entries=${localEntries} touch=${localSuccess}`);
  } catch (e) {
    console.log('FAIL', e.message);
    errors.push({ symbol, error: e.message });
  }
  await sleep(50);
}

const n = entries.length;
const successCount = entries.filter(e => e.success).length;
const stopFirstCount = entries.filter(e => e.stopFirst).length;
const symbolCount = Object.keys(klinesBySymbol).length;

const definition = {
  version: 'base-rate-v0.1',
  unit: 'symbol_judge_day equal weight',
  exchange: 'binance',
  contractType: 'USDT-M perpetual',
  status: 'TRADING',
  startDate: START_DATE,
  minListingDays: MIN_LISTING_DAYS,
  horizon: HORIZON,
  touch: TOUCH,
  stop: STOP,
  entry: 'judge close',
  lookbackBufferDays: LOOKBACK_BUFFER,
  dedupeGapDays: DEDUPE_GAP,
  barSchema: ['openTime', 'open', 'high', 'low', 'close', 'volume', 'quoteVolume'],
};

const generatedAt = new Date().toISOString();

const eligiblePayload = {
  metadata: {
    generatedAt,
    ...definition,
    symbolsScanned: symbols.length,
    symbolsWithEntries: symbolCount,
    entryCount: n,
  },
  entries,
  errors,
};

const klinesPayload = {
  metadata: {
    generatedAt,
    ...definition,
    symbolCount,
    note: '仅包含至少有一条合格开仓日的币对；bars 含判定日前 lookbackBuffer，供后续模式分析',
  },
  symbols: klinesBySymbol,
};

const summary = {
  metadata: {
    generatedAt,
    ...definition,
    symbolsScanned: symbols.length,
    symbolsWithEntries: symbolCount,
  },
  summary: {
    n,
    successCount,
    baseRate: n ? successCount / n : null,
    stopFirstCount,
    stopFirstRate: n ? stopFirstCount / n : null,
    dedupedSuccessCount: dedupedSuccess,
    dedupedEventRate: n ? dedupedSuccess / n : null,
    byYear: Object.fromEntries(
      Object.entries(byYear).map(([y, v]) => [
        y,
        {
          ...v,
          baseRate: v.n ? v.success / v.n : null,
          stopFirstRate: v.n ? v.stopFirst / v.n : null,
        },
      ])
    ),
  },
  files: {
    eligibleEntries: 'eligible-entries-v0.1.json',
    klinesBySymbol: 'klines-by-symbol-v0.1.json',
  },
  errorCount: errors.length,
};

await fs.writeFile(path.join(OUT_DIR, 'eligible-entries-v0.1.json'), `${JSON.stringify(eligiblePayload)}\n`);
await fs.writeFile(path.join(OUT_DIR, 'klines-by-symbol-v0.1.json'), `${JSON.stringify(klinesPayload)}\n`);
await fs.writeFile(path.join(OUT_DIR, 'base-rate-v0.1-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('\nDONE');
console.log(JSON.stringify(summary.summary, null, 2));
console.log('wrote', OUT_DIR);
