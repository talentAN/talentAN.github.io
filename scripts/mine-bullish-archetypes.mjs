#!/usr/bin/env node
/**
 * 从成功开仓日归纳候选分型（发现阶段）
 * 输入：eligible-entries + klines-by-symbol
 * 输出：features / archetypes summary / 每型样例
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve('src/data/market/binance/bullish-base-rate');
const WINDOW = 100;
const DEDUPE_GAP = 20;
const DAY = 86400000;

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo];
  return s[lo] * (hi - i) + s[hi] * (i - lo);
};
const summarize = arr => {
  const s = arr.filter(Number.isFinite);
  if (!s.length) return null;
  return {
    n: s.length,
    p25: quantile(s, 0.25),
    median: median(s),
    p75: quantile(s, 0.75),
    mean: mean(s),
  };
};

const parseBars = compact => compact.map(c => ({
  openTime: c[0],
  date: new Date(c[0]).toISOString().slice(0, 10),
  open: c[1],
  high: c[2],
  low: c[3],
  close: c[4],
  volume: c[5],
  quoteVolume: c[6],
}));

const extractFeatures = (bars, judgeOpenTime) => {
  const idx = bars.findIndex(b => b.openTime === judgeOpenTime);
  if (idx < 0) return { ok: false, error: 'judge_bar_missing' };
  if (idx + 1 < 40) return { ok: false, error: 'history_short' };

  const pre = bars.slice(Math.max(0, idx - WINDOW + 1), idx + 1);
  if (pre.length < 60) return { ok: false, error: 'window_short' };
  const judge = pre[pre.length - 1];

  let troughI = 0;
  for (let i = 1; i < pre.length; i += 1) if (pre[i].low < pre[troughI].low) troughI = i;
  const trough = pre[troughI];
  let peak = pre[0].high;
  for (let i = 1; i <= troughI; i += 1) peak = Math.max(peak, pre[i].high);
  const drawdown = trough.low / peak - 1;
  const recovery = judge.close / trough.low - 1;
  const daysLowToJudge = pre.length - 1 - troughI;

  const searchEnd = Math.floor(pre.length * 0.75);
  let boxStart = 0;
  let bestMed = Infinity;
  for (let i = 0; i <= Math.max(0, searchEnd - 20); i += 1) {
    const med = median(pre.slice(i, i + 20).map(b => b.quoteVolume));
    if (med != null && med < bestMed) {
      bestMed = med;
      boxStart = i;
    }
  }
  const box = pre.slice(boxStart, boxStart + 20);
  const boxHigh = Math.max(...box.map(b => b.high));
  const boxLow = Math.min(...box.map(b => b.low));
  const boxWidth = boxLow > 0 ? (boxHigh - boxLow) / boxLow : null;
  const boxAvgQ = mean(box.map(b => b.quoteVolume));
  const windowMedQ = median(pre.map(b => b.quoteVolume));
  const nearAvgQ = mean(pre.slice(-10).map(b => b.quoteVolume));
  const nearVolVsBox = boxAvgQ > 0 ? nearAvgQ / boxAvgQ : null;
  const aboveBox = boxHigh > 0 ? judge.close / boxHigh - 1 : null;
  let firstAbove = -1;
  for (let i = boxStart + 20; i < pre.length; i += 1) {
    if (pre[i].close > boxHigh) {
      firstAbove = i;
      break;
    }
  }
  const daysSinceLeaveBox = firstAbove >= 0 ? pre.length - 1 - firstAbove : null;
  const quietBox = boxWidth != null && boxWidth <= 0.35 && windowMedQ > 0 && bestMed / windowMedQ <= 0.85;

  const retN = n => (pre.length > n ? judge.close / pre[pre.length - 1 - n].close - 1 : null);
  const ret5 = retN(5);
  const ret10 = retN(10);
  const ret20 = retN(20);

  let bestImpulse = { dayRet: -Infinity, volRatio: 0, date: null };
  for (let i = Math.max(5, pre.length - 15); i < pre.length; i += 1) {
    const base = mean(pre.slice(Math.max(0, i - 20), i).map(b => b.quoteVolume)) || 1;
    const dayRet = pre[i].close / pre[i].open - 1;
    const volRatio = pre[i].quoteVolume / base;
    const score = dayRet * Math.log10(1 + Math.max(0, volRatio));
    const bestScore = bestImpulse.dayRet * Math.log10(1 + Math.max(0, bestImpulse.volRatio));
    if (score > bestScore) bestImpulse = { dayRet, volRatio, date: pre[i].date };
  }
  const strongImpulse = bestImpulse.dayRet >= 0.15 && bestImpulse.volRatio >= 5;

  // 近 20 日振幅（相对均价）
  const last20 = pre.slice(-20);
  const mid = mean(last20.map(b => (b.high + b.low) / 2));
  const range20 = mid > 0 ? (Math.max(...last20.map(b => b.high)) - Math.min(...last20.map(b => b.low))) / mid : null;

  return {
    ok: true,
    drawdown,
    recovery,
    daysLowToJudge,
    boxWidth,
    quietBox,
    nearVolVsBox,
    aboveBox,
    daysSinceLeaveBox,
    ret5,
    ret10,
    ret20,
    range20,
    bestImpulseDayRet: bestImpulse.dayRet,
    bestImpulseVolRatio: bestImpulse.volRatio,
    strongImpulse,
  };
};

/** 可解释规则分型（阈值取成功样本经验分位附近，发现用） */
const labelRuleArchetype = f => {
  if (!f?.ok) return 'UNLABELED';
  const deep = f.drawdown <= -0.25;
  const veryDeep = f.drawdown <= -0.4;
  const accel = f.ret5 >= 0.1 && f.nearVolVsBox >= 3 && (f.strongImpulse || f.ret5 >= 0.2);
  const quiet = (f.nearVolVsBox == null || f.nearVolVsBox < 2) && (f.ret5 == null || f.ret5 < 0.1);
  const early = f.recovery < 0.35 && f.daysLowToJudge <= 10;
  const extended = f.recovery >= 1.5 || (f.ret10 != null && f.ret10 >= 0.5);
  const flatBase = f.drawdown > -0.25;

  if (deep && accel) return 'DROP_THEN_ACCEL';
  if (veryDeep && early) return 'DEEP_V';
  if (deep && quiet && f.quietBox) return 'DROP_QUIET_BOX';
  if (deep && quiet) return 'DROP_QUIET';
  if (extended && !accel) return 'ALREADY_EXTENDED';
  if (flatBase && accel) return 'FLAT_THEN_ACCEL';
  if (deep && f.recovery >= 0.3) return 'DROP_RECOVERING';
  return 'OTHER';
};

/** 简易 k-means（标准化特征） */
const FEATURE_KEYS = ['drawdown', 'recovery', 'ret5', 'nearVolVsBox', 'daysLowToJudge', 'aboveBox', 'range20'];

const kmeans = (rows, k, maxIter = 40) => {
  const usable = rows.filter(r => FEATURE_KEYS.every(key => Number.isFinite(r.features[key])));
  if (usable.length < k * 5) return { ok: false, error: 'too_few' };

  const stats = {};
  FEATURE_KEYS.forEach(key => {
    const vals = usable.map(r => r.features[key]);
    const mu = mean(vals);
    const sd = Math.sqrt(mean(vals.map(v => (v - mu) ** 2))) || 1;
    stats[key] = { mu, sd };
  });
  const vec = r => FEATURE_KEYS.map(key => (r.features[key] - stats[key].mu) / stats[key].sd);

  // init: pick spaced percentiles by recovery
  const byRec = [...usable].sort((a, b) => a.features.recovery - b.features.recovery);
  let centers = Array.from({ length: k }, (_, i) => vec(byRec[Math.floor((i + 0.5) * byRec.length / k)]));

  let assign = new Array(usable.length).fill(0);
  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    usable.forEach((r, i) => {
      const v = vec(r);
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const d = c.reduce((s, x, j) => s + (x - v[j]) ** 2, 0);
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      });
      if (assign[i] !== best) changed = true;
      assign[i] = best;
    });
    const next = centers.map(() => FEATURE_KEYS.map(() => 0));
    const counts = centers.map(() => 0);
    usable.forEach((r, i) => {
      const v = vec(r);
      const a = assign[i];
      counts[a] += 1;
      v.forEach((x, j) => { next[a][j] += x; });
    });
    centers = next.map((c, ci) => (counts[ci] ? c.map(x => x / counts[ci]) : centers[ci]));
    if (!changed) break;
  }

  usable.forEach((r, i) => { r.kmeansCluster = assign[i]; });
  return { ok: true, k, stats, assignCounts: centers.map((_, i) => assign.filter(a => a === i).length) };
};

const nameCluster = members => {
  const d = summarize(members.map(m => m.features.drawdown));
  const r = summarize(members.map(m => m.features.recovery));
  const r5 = summarize(members.map(m => m.features.ret5));
  const nv = summarize(members.map(m => m.features.nearVolVsBox));
  const dl = summarize(members.map(m => m.features.daysLowToJudge));
  const medD = d?.median ?? 0;
  const medR = r?.median ?? 0;
  const medR5 = r5?.median ?? 0;
  const medNv = nv?.median ?? 0;
  const medDl = dl?.median ?? 0;

  if (medD <= -0.35 && medDl <= 12 && medR < 0.6) return 'K_DEEP_V';
  if (medD <= -0.3 && medR5 >= 0.12 && medNv >= 2.5) return 'K_DROP_ACCEL';
  if (medD <= -0.3 && medR5 < 0.08 && medNv < 2.2) return 'K_DROP_QUIET';
  if (medR >= 1.2 && medR5 < 0.15) return 'K_EXTENDED';
  if (medD > -0.25 && medR5 >= 0.1) return 'K_FLAT_ACCEL';
  if (medD <= -0.25 && medR >= 0.5) return 'K_DROP_RECOVER';
  return 'K_MIXED';
};

console.log('loading eligible-entries…');
const eligible = JSON.parse(await fs.readFile(path.join(DIR, 'eligible-entries-v0.1.json'), 'utf8'));
console.log('loading klines…');
const klinesPack = JSON.parse(await fs.readFile(path.join(DIR, 'klines-by-symbol-v0.1.json'), 'utf8'));

const success = eligible.entries.filter(e => e.success);
success.sort((a, b) => (a.symbol === b.symbol ? a.judgeOpenTime - b.judgeOpenTime : a.symbol < b.symbol ? -1 : 1));

const deduped = [];
const lastBySymbol = new Map();
for (const e of success) {
  const prev = lastBySymbol.get(e.symbol);
  if (prev != null && e.judgeOpenTime - prev < DEDUPE_GAP * DAY) continue;
  lastBySymbol.set(e.symbol, e.judgeOpenTime);
  deduped.push(e);
}
console.log(`success ${success.length} → deduped ${deduped.length}`);

const barCache = new Map();
const getBars = symbol => {
  if (barCache.has(symbol)) return barCache.get(symbol);
  const pack = klinesPack.symbols[symbol];
  if (!pack) {
    barCache.set(symbol, null);
    return null;
  }
  const bars = parseBars(pack.bars);
  barCache.set(symbol, bars);
  return bars;
};

const rows = [];
let featureFail = 0;
for (let i = 0; i < deduped.length; i += 1) {
  const e = deduped[i];
  if (i % 500 === 0) process.stdout.write(`features ${i}/${deduped.length}\r`);
  const bars = getBars(e.symbol);
  if (!bars) {
    featureFail += 1;
    continue;
  }
  const features = extractFeatures(bars, e.judgeOpenTime);
  if (!features.ok) {
    featureFail += 1;
    continue;
  }
  const ruleArchetype = labelRuleArchetype(features);
  rows.push({
    symbol: e.symbol,
    judgeDate: e.judgeDate,
    judgeOpenTime: e.judgeOpenTime,
    entry: e.entry,
    maxRet: e.maxRet,
    path: e.path,
    year: e.judgeDate.slice(0, 4),
    features,
    ruleArchetype,
  });
}
console.log(`\nfeatured ${rows.length} fail ${featureFail}`);

const km = kmeans(rows, 5);
if (km.ok) console.log('kmeans5 counts', km.assignCounts);

const ruleCounts = {};
rows.forEach(r => { ruleCounts[r.ruleArchetype] = (ruleCounts[r.ruleArchetype] || 0) + 1; });

const featureKeysReport = [
  'drawdown', 'recovery', 'daysLowToJudge', 'boxWidth', 'nearVolVsBox',
  'aboveBox', 'daysSinceLeaveBox', 'ret5', 'ret10', 'ret20', 'range20',
  'bestImpulseDayRet', 'bestImpulseVolRatio',
];

const buildTypeReport = (key, members) => {
  const dist = {};
  featureKeysReport.forEach(fk => {
    dist[fk] = summarize(members.map(m => m.features[fk]));
  });
  const quietBoxRate = members.filter(m => m.features.quietBox).length / members.length;
  const strongImpulseRate = members.filter(m => m.features.strongImpulse).length / members.length;
  // 样例：按 maxRet 取中高位，分散年份
  const sorted = [...members].sort((a, b) => b.maxRet - a.maxRet);
  const samples = [];
  const usedYears = new Set();
  for (const m of sorted) {
    if (samples.length >= 8) break;
    if (samples.length < 4 || !usedYears.has(m.year)) {
      samples.push({
        symbol: m.symbol,
        judgeDate: m.judgeDate,
        maxRet: m.maxRet,
        drawdown: m.features.drawdown,
        recovery: m.features.recovery,
        ret5: m.features.ret5,
        nearVolVsBox: m.features.nearVolVsBox,
        daysLowToJudge: m.features.daysLowToJudge,
        ruleArchetype: m.ruleArchetype,
        kmeansCluster: m.kmeansCluster,
      });
      usedYears.add(m.year);
    }
  }
  return {
    key,
    n: members.length,
    share: members.length / rows.length,
    quietBoxRate,
    strongImpulseRate,
    distributions: dist,
    samples,
  };
};

const ruleReports = Object.keys(ruleCounts)
  .sort((a, b) => ruleCounts[b] - ruleCounts[a])
  .map(key => buildTypeReport(key, rows.filter(r => r.ruleArchetype === key)));

const kmeansReports = [];
if (km.ok) {
  for (let c = 0; c < 5; c += 1) {
    const members = rows.filter(r => r.kmeansCluster === c);
    if (!members.length) continue;
    const autoName = nameCluster(members);
    const report = buildTypeReport(`cluster_${c}_${autoName}`, members);
    report.autoName = autoName;
    report.ruleMix = members.reduce((acc, m) => {
      acc[m.ruleArchetype] = (acc[m.ruleArchetype] || 0) + 1;
      return acc;
    }, {});
    kmeansReports.push(report);
  }
  kmeansReports.sort((a, b) => b.n - a.n);
}

/** 候选分型：以规则型为主（可解释），k-means 作对照 */
const candidates = ruleReports
  .filter(r => r.key !== 'OTHER' && r.key !== 'UNLABELED')
  .map(r => {
    const d = r.distributions;
    let oneLiner = '';
    if (r.key === 'DROP_THEN_ACCEL') {
      oneLiner = '深跌后来路 + 近端已放量加速（ret5/近量/预演偏强）';
    } else if (r.key === 'DEEP_V') {
      oneLiner = '深跌且刚离低点不久，修复尚浅';
    } else if (r.key === 'DROP_QUIET_BOX') {
      oneLiner = '深跌后缩量窄箱闷着，近端动能弱';
    } else if (r.key === 'DROP_QUIET') {
      oneLiner = '深跌后近端仍安静（未必有合格窄箱）';
    } else if (r.key === 'ALREADY_EXTENDED') {
      oneLiner = '相对低点已大幅修复/近10日已大涨，开仓前已延伸';
    } else if (r.key === 'FLAT_THEN_ACCEL') {
      oneLiner = '无明显深跌，近端加速抬头';
    } else if (r.key === 'DROP_RECOVERING') {
      oneLiner = '深跌后已有修复，但未达「安静」或「强加速」两极';
    } else oneLiner = r.key;

    return {
      key: r.key,
      oneLiner,
      n: r.n,
      shareOfDedupeSuccess: r.share,
      medians: {
        drawdown: d.drawdown?.median,
        recovery: d.recovery?.median,
        ret5: d.ret5?.median,
        nearVolVsBox: d.nearVolVsBox?.median,
        daysLowToJudge: d.daysLowToJudge?.median,
        aboveBox: d.aboveBox?.median,
      },
      quietBoxRate: r.quietBoxRate,
      strongImpulseRate: r.strongImpulseRate,
      samples: r.samples.slice(0, 5),
      draftTriggerHint: {
        DROP_THEN_ACCEL: 'drawdown≤-25% ∧ recovery≥30% ∧ ret5≥10% ∧ nearVol≥3x ∧ (强预演或ret5≥20%)',
        DEEP_V: 'drawdown≤-40% ∧ daysLow≤10 ∧ recovery<35%',
        DROP_QUIET_BOX: 'drawdown≤-25% ∧ quietBox ∧ nearVol<2x ∧ ret5<10%',
        DROP_QUIET: 'drawdown≤-25% ∧ nearVol<2x ∧ ret5<10%',
        ALREADY_EXTENDED: '(recovery≥150% ∨ ret10≥50%) ∧ 非加速型',
        FLAT_THEN_ACCEL: 'drawdown>-25% ∧ ret5≥10% ∧ nearVol≥3x',
        DROP_RECOVERING: 'drawdown≤-25% ∧ recovery≥30% ∧ 未落入加速/安静',
      }[r.key] || null,
    };
  });

const out = {
  metadata: {
    generatedAt: new Date().toISOString(),
    source: {
      eligible: 'eligible-entries-v0.1.json',
      klines: 'klines-by-symbol-v0.1.json',
    },
    windowDays: WINDOW,
    dedupeGapDays: DEDUPE_GAP,
    successRaw: success.length,
    successDeduped: deduped.length,
    featured: rows.length,
    featureFail,
    baseRateAnchor: 0.1129,
    note: '本文件仅为成功日上的分型发现；纯度须在全合格判定日上回测后才成立',
  },
  ruleArchetypeCounts: ruleCounts,
  candidates,
  ruleReports,
  kmeans: {
    k: 5,
    ok: km.ok,
    reports: kmeansReports,
  },
};

const outFeatured = {
  metadata: out.metadata,
  rows: rows.map(r => ({
    symbol: r.symbol,
    judgeDate: r.judgeDate,
    entry: r.entry,
    maxRet: r.maxRet,
    ruleArchetype: r.ruleArchetype,
    kmeansCluster: r.kmeansCluster ?? null,
    features: r.features,
  })),
};

await fs.writeFile(path.join(DIR, 'archetypes-v0.1-summary.json'), `${JSON.stringify(out, null, 2)}\n`);
await fs.writeFile(path.join(DIR, 'archetypes-v0.1-features.json'), `${JSON.stringify(outFeatured)}\n`);

console.log('\n=== rule counts ===');
console.log(ruleCounts);
console.log('\n=== candidates ===');
candidates.forEach(c => {
  console.log(
    `${c.key}\tn=${c.n}\tshare=${(c.shareOfDedupeSuccess * 100).toFixed(1)}%` +
    `\tdd=${(c.medians.drawdown * 100).toFixed(0)}%` +
    `\trec=${(c.medians.recovery * 100).toFixed(0)}%` +
    `\tret5=${(c.medians.ret5 * 100).toFixed(0)}%` +
    `\tnv=${c.medians.nearVolVsBox?.toFixed(1)}x`
  );
});
console.log('wrote', path.join(DIR, 'archetypes-v0.1-summary.json'));
