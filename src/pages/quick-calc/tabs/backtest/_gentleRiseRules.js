/**
 * 缓坡稳定上行 · gentle-rise-v0.1
 * 锚点：AGTUSDT 2026-07-06 → 2026-09-20（77 根日 K）实测标定。
 *
 * 「一模一样」不可操作；本口径是锚点外包络：
 * 缓（日对数斜率有上界）∧ 稳（R² / 振幅 / 回撤 / 单日冲击）∧ 持续（≥50 日）∧ 向上。
 */

export const GENTLE_RISE_REF = {
  symbol: 'AGTUSDT',
  from: '2026-07-06',
  to: '2026-09-20',
  /** 锚点实测（UTC 日 K，含起止日） */
  measured: {
    days: 77,
    retWindow: 0.42,
    slopeRet: 0.2909,
    r2: 0.6758,
    rangePct: 0.6367,
    maxDayRet: 0.1415,
    minDayRet: -0.2095,
    dailyLogSlope: 0.00383,
    mdd: -0.2095,
    upFrac: 0.592,
  },
};

export const GENTLE_RISE_V01 = {
  version: 'gentle-rise-v0.1',
  reference: GENTLE_RISE_REF,
  minDays: 50,
  maxDays: 100,
  /** 扫描窗长（含锚点 77） */
  windowLengths: [50, 60, 70, 77, 80, 90, 100],
  /** log(close) OLS R² */
  r2Min: 0.55,
  /**
   * 日对数斜率上下界（「缓和」关键：有上界）
   * 锚点 ≈ 0.00383；下界过滤贴零噪声，上界过滤陡升
   */
  dailyLogSlopeMin: 0.0015,
  dailyLogSlopeMax: 0.008,
  retWindowMin: 0.12,
  retWindowMax: 1.0,
  rangeMax: 0.85,
  maxDayRetMax: 0.22,
  /** 窗内收盘相对峰值最大回撤（负数）；须 ≥ 此值 */
  mddMin: -0.35,
  upFracMin: 0.48,
  /** 窗结束后前向验证天数 */
  forwardHorizons: [10, 20, 30],
};

const mean = values =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Binance 数组行 / 对象行 → 统一 bar */
export const normalizeBars = rows =>
  (rows || [])
    .map(row => {
      if (Array.isArray(row)) {
        return {
          openTime: Number(row[0]),
          date: new Date(Number(row[0])).toISOString().slice(0, 10),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
          quoteVolume: Number(row[6]),
        };
      }
      return {
        openTime: Number(row.openTime),
        date: row.date || new Date(Number(row.openTime)).toISOString().slice(0, 10),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        quoteVolume: Number(row.quoteVolume),
      };
    })
    .filter(bar => Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.openTime - b.openTime);

/**
 * 对 [startIdx, endIdx] 闭区间做缓坡判定。
 * @returns {{ ok, pass, metrics, failReason? }}
 */
export const evaluateGentleRiseWindow = (bars, startIdx, endIdx, rules = GENTLE_RISE_V01) => {
  const n = endIdx - startIdx + 1;
  if (n < rules.minDays || n > rules.maxDays) {
    return { ok: false, pass: false, failReason: 'days_out_of_range', metrics: null };
  }
  if (startIdx < 0 || endIdx >= bars.length) {
    return { ok: false, pass: false, failReason: 'index', metrics: null };
  }

  const win = bars.slice(startIdx, endIdx + 1);
  const closes = win.map(b => b.close);
  if (closes.some(c => !(c > 0))) {
    return { ok: false, pass: false, failReason: 'bad_close', metrics: null };
  }

  const ys = closes.map(Math.log);
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - xMean;
    cov += dx * (ys[i] - yMean);
    varX += dx * dx;
  }
  const slope = varX > 0 ? cov / varX : null;
  if (slope == null || !Number.isFinite(slope)) {
    return { ok: false, pass: false, failReason: 'slope_fail', metrics: null };
  }

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = yMean + slope * (i - xMean);
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const medClose = median(closes);
  const maxHigh = Math.max(...win.map(b => b.high));
  const minLow = Math.min(...win.map(b => b.low));
  const rangePct = medClose > 0 ? (maxHigh - minLow) / medClose : null;
  const retWindow = closes[n - 1] / closes[0] - 1;
  const slopeRet = slope * (n - 1);

  let maxDayRet = -Infinity;
  let minDayRet = Infinity;
  let upDays = 0;
  for (let i = 1; i < n; i += 1) {
    const dayRet = closes[i] / closes[i - 1] - 1;
    if (dayRet > maxDayRet) maxDayRet = dayRet;
    if (dayRet < minDayRet) minDayRet = dayRet;
    if (dayRet > 0) upDays += 1;
  }
  const upFrac = n > 1 ? upDays / (n - 1) : null;

  let peak = closes[0];
  let mdd = 0;
  for (let i = 0; i < n; i += 1) {
    if (closes[i] > peak) peak = closes[i];
    const dd = closes[i] / peak - 1;
    if (dd < mdd) mdd = dd;
  }

  const checks = {
    slopePos: slope > 0,
    r2: r2 >= rules.r2Min,
    dailySlopeLo: slope >= rules.dailyLogSlopeMin,
    dailySlopeHi: slope <= rules.dailyLogSlopeMax,
    retLo: retWindow >= rules.retWindowMin,
    retHi: retWindow <= rules.retWindowMax,
    range: rangePct != null && rangePct <= rules.rangeMax,
    maxDay: Number.isFinite(maxDayRet) && maxDayRet <= rules.maxDayRetMax,
    mdd: mdd >= rules.mddMin,
    upFrac: upFrac != null && upFrac >= rules.upFracMin,
  };
  const pass = Object.values(checks).every(Boolean);
  const failReason = pass
    ? null
    : Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([key]) => key)
        .join(',');

  return {
    ok: true,
    pass,
    failReason,
    metrics: {
      days: n,
      from: win[0].date,
      to: win[n - 1].date,
      fromTs: win[0].openTime,
      toTs: win[n - 1].openTime,
      startClose: closes[0],
      endClose: closes[n - 1],
      slope,
      slopeRet,
      r2,
      rangePct,
      retWindow,
      maxDayRet: Number.isFinite(maxDayRet) ? maxDayRet : null,
      minDayRet: Number.isFinite(minDayRet) ? minDayRet : null,
      mdd,
      upFrac,
    },
  };
};

/** 窗结束后的前向摸高 / 收盘涨幅（相对窗末日收盘） */
export const measureForward = (bars, endIdx, horizons = GENTLE_RISE_V01.forwardHorizons) => {
  const entry = bars[endIdx]?.close;
  const out = {};
  if (!(entry > 0)) return out;

  horizons.forEach(horizon => {
    const last = Math.min(bars.length - 1, endIdx + horizon);
    const available = last - endIdx;
    let maxHigh = -Infinity;
    let lastClose = null;
    for (let j = endIdx + 1; j <= last; j += 1) {
      if (bars[j].high > maxHigh) maxHigh = bars[j].high;
      lastClose = bars[j].close;
    }
    out[`fwd${horizon}`] = {
      horizon,
      available,
      complete: available >= horizon,
      maxHighRet: available > 0 && Number.isFinite(maxHigh) ? maxHigh / entry - 1 : null,
      closeRet: available > 0 && lastClose > 0 ? lastClose / entry - 1 : null,
    };
  });
  return out;
};

/**
 * 单币扫描：各窗长 × 各结束日；同币重叠窗按 R² 贪心去重。
 * @returns {Array} 命中段
 */
export const scanGentleRiseSegments = (barsInput, options = {}) => {
  const rules = { ...GENTLE_RISE_V01, ...(options.rules || {}) };
  const bars = normalizeBars(barsInput);
  const startTs = options.startTs;
  const lengths = (rules.windowLengths || []).filter(
    len => len >= rules.minDays && len <= rules.maxDays,
  );
  if (!bars.length || !lengths.length) return [];

  const candidates = [];
  for (let endIdx = 0; endIdx < bars.length; endIdx += 1) {
    if (Number.isFinite(startTs) && bars[endIdx].openTime < startTs) continue;

    for (let li = 0; li < lengths.length; li += 1) {
      const len = lengths[li];
      const startIdx = endIdx - len + 1;
      if (startIdx < 0) continue;
      const evaluated = evaluateGentleRiseWindow(bars, startIdx, endIdx, rules);
      if (!evaluated.ok || !evaluated.pass) continue;
      candidates.push({
        startIdx,
        endIdx,
        metrics: evaluated.metrics,
        forward: measureForward(bars, endIdx, rules.forwardHorizons),
      });
    }
  }

  candidates.sort((a, b) => (b.metrics.r2 ?? 0) - (a.metrics.r2 ?? 0));
  const kept = [];
  candidates.forEach(item => {
    const overlaps = kept.some(
      other => !(item.endIdx < other.startIdx || item.startIdx > other.endIdx),
    );
    if (!overlaps) kept.push(item);
  });

  kept.sort((a, b) => a.metrics.fromTs - b.metrics.fromTs);
  return kept;
};

/**
 * 强制评估锚点窗（AGT 2026-07-06→09-20）。
 * 用于自检：扫描去重后仍应能对照锚点是否仍落在口径内。
 */
export const evaluateReferenceWindow = barsInput => {
  const bars = normalizeBars(barsInput);
  const startIdx = bars.findIndex(bar => bar.date === GENTLE_RISE_REF.from);
  const endIdx = bars.findIndex(bar => bar.date === GENTLE_RISE_REF.to);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return { ok: false, pass: false, failReason: 'ref_dates_missing', metrics: null, forward: null };
  }
  const evaluated = evaluateGentleRiseWindow(bars, startIdx, endIdx);
  return {
    ...evaluated,
    forward: evaluated.ok ? measureForward(bars, endIdx) : null,
    startIdx,
    endIdx,
  };
};

/** 是否为锚点 AGT 段（日期完全一致） */
export const isReferenceSegment = (symbol, metrics) =>
  String(symbol).toUpperCase() === GENTLE_RISE_REF.symbol
  && metrics?.from === GENTLE_RISE_REF.from
  && metrics?.to === GENTLE_RISE_REF.to;

/**
 * 缓坡后的高精度子集候选（gentle-rise 子 tab）。
 * 全量缓坡为母体；各子集只求高精密度，不求覆盖全部赢家。
 * kind=window：终点日即可判定；kind=path：依赖前向已完整的 fwd10。
 */
export const GENTLE_RISE_SUBSETS = [
  {
    key: 'all',
    slug: '',
    label: '全量',
    kind: 'window',
    oneLiner: '缓坡母体，无额外形态过滤',
    ruleText: '无',
    match: () => true,
  },
  {
    key: 'quiet',
    slug: 'quiet',
    label: 'H-更缓',
    kind: 'window',
    oneLiner: '窗内涨得更克制、振幅更窄（赢家里可拿性最好的形态簇）',
    ruleText: 'ret≤30% ∧ R²≥0.70 ∧ 振幅≤55%',
    match: row =>
      Number(row.retWindow) <= 0.3
      && Number(row.r2) >= 0.7
      && Number(row.rangePct) <= 0.55,
  },
  {
    key: 'low-noise',
    slug: 'low-noise',
    label: 'K-低噪浅撤',
    kind: 'window',
    oneLiner: '高拟合 + 未过度延伸 + 浅回撤 + 单日冲击受控',
    ruleText: 'R²≥0.78 ∧ ret≤45% ∧ 回撤≥−19% ∧ 最大单日≤16%',
    match: row =>
      Number(row.r2) >= 0.78
      && Number(row.retWindow) <= 0.45
      && Number(row.mdd) >= -0.19
      && Number(row.maxDayRet) <= 0.16,
  },
  {
    key: 'fast-blast',
    slug: 'fast-blast',
    label: 'D-快爆发',
    kind: 'path',
    oneLiner: '二段确认：缓坡结束后 10 日内已摸高 ≥100%（非纯窗内规律）',
    ruleText: 'fwd10 完整 ∧ 后10摸高≥100%',
    match: row => {
      const cell = row.forward?.fwd10;
      return Boolean(cell?.complete) && Number(cell.maxHighRet) >= 1;
    },
  },
  {
    key: 'cold-start',
    slug: 'cold-start',
    label: 'E-冷启动',
    kind: 'path',
    oneLiner: '结束后 10 日仍冷（摸高<20%）；看这撮里后30翻倍密度',
    ruleText: 'fwd10 完整 ∧ 后10摸高<20%',
    match: row => {
      const cell = row.forward?.fwd10;
      return Boolean(cell?.complete) && Number(cell.maxHighRet) < 0.2;
    },
  },
  {
    key: 'extended',
    slug: 'extended',
    label: 'G-窗内已延伸',
    kind: 'window',
    oneLiner: '缓坡段本身已经涨了不少，偏续涨/半山',
    ruleText: 'ret≥50% ∧ R²≥0.75',
    match: row => Number(row.retWindow) >= 0.5 && Number(row.r2) >= 0.75,
  },
];

export const GENTLE_RISE_SUBSET_BASE = '/quick-calc/backtest/gentle-rise';

export const resolveGentleRiseSubset = pathname => {
  const clean = String(pathname || '').split('?')[0].replace(/\/$/, '');
  const base = GENTLE_RISE_SUBSET_BASE;
  if (clean === base || clean === `${base}/`) return GENTLE_RISE_SUBSETS[0];
  const slug = clean.startsWith(`${base}/`) ? clean.slice(base.length + 1) : '';
  return GENTLE_RISE_SUBSETS.find(item => item.slug === slug) || GENTLE_RISE_SUBSETS[0];
};

export const filterByGentleRiseSubset = (rows, subset) => {
  if (!subset || subset.key === 'all' || typeof subset.match !== 'function') return rows || [];
  return (rows || []).filter(row => {
    try {
      return subset.match(row);
    } catch {
      return false;
    }
  });
};
