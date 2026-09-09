#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const SYMBOL = process.argv[2] || 'BTRUSDT';
const START_DATE = process.argv[3] || '2026-05-26';
const END_DATE = process.argv[4] || '2026-08-24';
const BASE_URL = 'https://fapi.binance.com/fapi/v1/klines';
const intervalMs = 24 * 60 * 60 * 1000;
const startTime = Date.parse(`${START_DATE}T00:00:00.000Z`);
const endTime = Date.parse(`${END_DATE}T23:59:59.999Z`);

if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
  throw new Error(`日期范围无效: ${START_DATE} ~ ${END_DATE}`);
}

const response = await fetch(`${BASE_URL}?symbol=${encodeURIComponent(SYMBOL)}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=1000`);
const data = await response.json();
if (!response.ok || !Array.isArray(data)) {
  throw new Error(`Binance K线请求失败: HTTP ${response.status} ${data?.msg || ''}`);
}

const rows = data.filter(row => Number(row[0]) >= startTime && Number(row[0]) <= endTime);
const normalized = rows.map(row => ({
  openTime: Number(row[0]),
  closeTime: Number(row[6]),
  open: row[1],
  high: row[2],
  low: row[3],
  close: row[4],
  volume: row[5],
  quoteVolume: row[7],
  tradeCount: Number(row[8]),
}));

const dates = normalized.map(row => new Date(row.openTime).toISOString().slice(0, 10));
const duplicates = dates.filter((date, index) => dates.indexOf(date) !== index);
const missing = [];
for (let time = startTime; time <= endTime; time += intervalMs) {
  const date = new Date(time).toISOString().slice(0, 10);
  if (!dates.includes(date)) missing.push(date);
}
const expected = Math.floor((endTime - startTime) / intervalMs) + 1;
const outputDir = path.resolve('src/data/market/binance');
const stem = `${SYMBOL}-1d-${START_DATE}_${END_DATE}`;
const metadata = {
  exchange: 'binance-futures',
  symbol: SYMBOL,
  interval: '1d',
  timezone: 'UTC',
  requestedStart: new Date(startTime).toISOString(),
  requestedEnd: new Date(endTime).toISOString(),
  fetchedAt: new Date().toISOString(),
  count: rows.length,
  expectedCount: expected,
  firstDate: dates[0] || null,
  lastDate: dates[dates.length - 1] || null,
  duplicates,
  missing,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, `${stem}.raw.json`), `${JSON.stringify({ metadata, rows: data }, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, `${stem}.json`), `${JSON.stringify({ metadata, rows: normalized }, null, 2)}\n`);

console.log(JSON.stringify(metadata, null, 2));
if (rows.length !== expected || duplicates.length || missing.length) {
  process.exitCode = 2;
}
