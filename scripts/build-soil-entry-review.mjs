#!/usr/bin/env node
/**
 * 从 archetypes-v0.1-features.json 生成土壤开仓人审分页包。
 * 每页目标 10+10+10；缺则用剩余最多的类型补足。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '../src/data/market/binance/bullish-base-rate');
const features = JSON.parse(fs.readFileSync(path.join(DIR, 'archetypes-v0.1-features.json'), 'utf8'));

const SOIL = [
  { key: 'DROP_QUIET_BOX', label: '深跌缩量闷箱' },
  { key: 'DROP_RECOVERING', label: '深跌后修复中' },
  { key: 'ALREADY_EXTENDED', label: '开仓前已延伸' },
];
const PER_TYPE = 10;
const PAGE_SIZE = 30;

/** 近端优先：标记日倒序；同日按币对稳定排序。人审排期用，不等于「越近越真」。 */
function byJudgeDateDesc(a, b) {
  if (a.judgeDate !== b.judgeDate) return a.judgeDate < b.judgeDate ? 1 : -1;
  return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
}

const pools = {};
const poolSizes = {};
for (const t of SOIL) {
  const rows = features.rows
    .filter(r => r.ruleArchetype === t.key)
    .map(r => ({
      symbol: r.symbol,
      judgeDate: r.judgeDate,
      soilType: t.key,
      soilLabel: t.label,
      maxRet: r.maxRet,
    }));
  rows.sort(byJudgeDateDesc);
  pools[t.key] = rows;
  poolSizes[t.key] = pools[t.key].length;
}

const pages = [];
const cursors = Object.fromEntries(SOIL.map(t => [t.key, 0]));
const remaining = () => SOIL.reduce((n, t) => n + (pools[t.key].length - cursors[t.key]), 0);

while (remaining() > 0) {
  const pageRows = [];
  const taken = Object.fromEntries(SOIL.map(t => [t.key, 0]));
  const fillNotes = [];

  for (const t of SOIL) {
    const pool = pools[t.key];
    let c = cursors[t.key];
    let got = 0;
    while (got < PER_TYPE && c < pool.length) {
      pageRows.push(pool[c]);
      c += 1;
      got += 1;
    }
    cursors[t.key] = c;
    taken[t.key] = got;
  }

  let deficit = PAGE_SIZE - pageRows.length;
  while (deficit > 0 && remaining() > 0) {
    const candidates = SOIL
      .map(t => ({ key: t.key, left: pools[t.key].length - cursors[t.key] }))
      .filter(x => x.left > 0)
      .sort((a, b) => b.left - a.left || a.key.localeCompare(b.key));
    if (!candidates.length) break;
    const pick = candidates[0].key;
    pageRows.push(pools[pick][cursors[pick]]);
    cursors[pick] += 1;
    taken[pick] += 1;
    deficit -= 1;
    fillNotes.push(pick);
  }

  // 页内：先按类型（三型均衡阅读），同型内再按标记日倒序
  const order = Object.fromEntries(SOIL.map((t, i) => [t.key, i]));
  pageRows.sort((a, b) => order[a.soilType] - order[b.soilType] || byJudgeDateDesc(a, b));

  const pageIndex = pages.length;
  pages.push({
    page: pageIndex + 1,
    rows: pageRows.map((r, i) => ({
      key: `${r.symbol}|${r.judgeDate}|${r.soilType}|p${pageIndex + 1}-${i}`,
      ...r,
    })),
    composition: taken,
    filledFrom: fillNotes.length ? [...new Set(fillNotes)] : [],
  });
}

const out = {
  metadata: {
    generatedAt: new Date().toISOString(),
    version: 'soil-entry-review-v0.1',
    source: 'archetypes-v0.1-features.json',
    universeNote: '去重成功日上的土壤三型标签；非全市场土壤观察池',
    sort: 'judgeDate_desc_within_type_then_page_by_10_10_10',
    pageSize: PAGE_SIZE,
    perTypeTarget: PER_TYPE,
    soilTypes: SOIL,
    poolSizes,
    totalRows: pages.reduce((n, p) => n + p.rows.length, 0),
    pageCount: pages.length,
  },
  pages,
};

const outPath = path.join(DIR, 'soil-entry-review-v0.1.json');
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}`);
console.log(JSON.stringify(out.metadata, null, 2));
