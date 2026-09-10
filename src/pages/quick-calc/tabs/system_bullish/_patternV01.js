/**
 * 横盘抬头前置条件 · pattern-v0.1
 * 规格：./docs/pattern-v0.1.md
 * quoteVolume = USDT 成交额（非标的币数量）
 */

export const PATTERN_V01 = {
  version: 'pattern-v0.1',
  windowDays: 100,
  boxDays: 20,
  boxSearchRatio: 0.75,
  drawdownMax: -0.25,
  boxWidthMax: 0.35,
  boxMedianQRatioMax: 0.85,
  recoveryMin: 0.3,
  nearVolDays: 10,
  nearVolVsBoxMin: 2,
  advanceLookback: 15,
  dStrongRetMin: 0.12,
  dStrongVolRatioMin: 2.5,
  dRunVolRatioMin: 5,
  dRunCompareDays: 5,
  volBaseDays: 20,
};

/** v0.2 = v0.1 土壤 + 近端动能过滤（可交易触发） */
export const PATTERN_V02 = {
  version: 'pattern-v0.2',
  ret5Min: 0.1,
  nearVolVsBoxMin: 3,
};

/** v0.3 = v0.2 + 近5日强预演（暴力放量阳或触发日天量） */
export const PATTERN_V03 = {
  version: 'pattern-v0.3',
  impulseLookback: 5,
  impulseDayRetMin: 0.15,
  impulseVolRatioMin: 5,
  triggerDayVolRatioMin: 8,
};

/** v0.4 = v0.3 + 更高势能（Top/Bottom 对照后的鉴别器） */
export const PATTERN_V04 = {
  version: 'pattern-v0.4',
  ret5Min: 0.2,
  nearVolVsBoxMin: 6,
};

export const GATE_SAMPLES = [
  { symbol: 'BTRUSDT', eventDate: '2026-08-26', judgeDate: '2026-08-25' },
  { symbol: 'TUTUSDT', eventDate: '2026-08-08', judgeDate: '2026-08-07' },
  { symbol: 'ONGUSDT', eventDate: '2026-08-20', judgeDate: '2026-08-19' },
];

/** 合约观察宇宙（与做空 high100 事件池脱钩；先定宇宙与成功，再谈模式） */
export const UNIVERSE_V01 = {
  version: 'universe-v0.1',
  exchange: 'binance',
  contractType: 'USDT-M perpetual',
  status: 'TRADING',
  /** 与回测/做空侧 MIN_LISTING_DAYS 对齐，复用 30 天 */
  minListingDays: 30,
  /** 本版暂不设；后续按近 N 日 quoteVolume 中位数补门槛 */
  minMedianQuoteVolume: null,
};

/**
 * 基率估算口径（与模式无关；禁止用 edge/模式日当基率分母）
 *
 * 单位：合格「币对×判定日」等权
 * 基率：P(20 日摸到 ≥ +50% | 合格判定日)
 */
export const BASE_RATE_V01 = {
  version: 'base-rate-v0.1',
  universe: UNIVERSE_V01.version,
  success: 'success-v0.3',
  /**
   * judge_day：每个合格判定日都进分母（与「随机抽一天开仓」对齐）
   * 不用 edge_day：边缘需要模式定义，会循环论证
   */
  unit: 'symbol_judge_day',
  weight: 'equal',
  /** 判定日须满足：上市天数、起点日、前向窗完整 */
  requireForwardComplete: true,
  /** 并列报同窗先触及 −50% 止损比例（同一分母） */
  reportStopFirst: true,
  /**
   * 辅助：成功「事件率」（同币成功判定日间隔 < primaryHorizon 则去重只留首日）
   * 不替代主基率，只缓解日与日窗口重叠造成的直觉偏差
   */
  reportDedupeEventRate: true,
  dedupeGapDays: 20,
  /** 全市场实测（见 bullish-base-rate/base-rate-v0.1-summary.json） */
  measuredBaseRate: 0.1129,
};

/**
 * 观察土壤三型（已冻结）：只进观察池，不是开仓触发。
 * 开仓时机另定；回测只评开仓触发日。
 * 定义与 scripts/mine-bullish-archetypes.mjs 的 rule 标签对齐。
 */
export const SOIL_V01 = {
  version: 'soil-v0.1',
  role: 'watchlist_only',
  types: [
    {
      key: 'DROP_QUIET_BOX',
      label: '深跌缩量闷箱',
      oneLiner: '深跌后来路 + 缩量窄箱 + 近端仍安静；等破箱/抬头，不当日开仓',
      kind: 'base_build',
    },
    {
      key: 'DROP_RECOVERING',
      label: '深跌后修复中',
      oneLiner: '深跌后已有修复，未到安静/强加速两极；观察突破确认',
      kind: 'base_build',
    },
    {
      key: 'ALREADY_EXTENDED',
      label: '开仓前已延伸',
      oneLiner: '相对低点已大幅修复或近端已大涨；续行/回调观察，避开刚泻完',
      kind: 'continuation_watch',
    },
  ],
  /** 明确不进主土壤 */
  excludedAsPrimarySoil: ['DROP_QUIET', 'DEEP_V', 'DROP_THEN_ACCEL', 'FLAT_THEN_ACCEL', 'OTHER'],
  workflow: 'soil_watchlist → entry_trigger → backtest_entry_only',
};

/** 当前筛选：近 N 日是否出现过主土壤标记日（与 mine-bullish-archetypes 规则对齐） */
export const SOIL_SCAN_V01 = {
  version: 'soil-scan-v0.1',
  windowDays: 100,
  recentDays: 15,
  /** 拉取日线根数：窗 100 + 近 15 + 余量 */
  fetchLimit: 130,
  minPrefixBars: 60,
};

export const PRIMARY_SOIL_KEYS = SOIL_V01.types.map(t => t.key);

const soilTypeLabel = key => SOIL_V01.types.find(t => t.key === key)?.label || key;

/**
 * 判定日前置特征（bars 以判定日为最后一根）。
 * 口径对齐 scripts/mine-bullish-archetypes.mjs → extractFeatures。
 */
export const extractSoilFeatures = barsInput => {
  const bars = normalizeBars(barsInput);
  const windowDays = SOIL_SCAN_V01.windowDays;
  if (bars.length < SOIL_SCAN_V01.minPrefixBars) {
    return { ok: false, error: 'history_short' };
  }
  const pre = bars.length > windowDays ? bars.slice(-windowDays) : bars;
  if (pre.length < SOIL_SCAN_V01.minPrefixBars) {
    return { ok: false, error: 'window_short' };
  }
  const judge = pre[pre.length - 1];

  let troughI = 0;
  for (let i = 1; i < pre.length; i += 1) {
    if (pre[i].low < pre[troughI].low) troughI = i;
  }
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
  const quietBox = boxWidth != null && boxWidth <= 0.35 && windowMedQ > 0 && bestMed / windowMedQ <= 0.85;

  const retN = n => (pre.length > n ? judge.close / pre[pre.length - 1 - n].close - 1 : null);
  const ret5 = retN(5);
  const ret10 = retN(10);

  let bestImpulse = { dayRet: -Infinity, volRatio: 0 };
  for (let i = Math.max(5, pre.length - 15); i < pre.length; i += 1) {
    const base = mean(pre.slice(Math.max(0, i - 20), i).map(b => b.quoteVolume)) || 1;
    const dayRet = pre[i].close / pre[i].open - 1;
    const volRatio = pre[i].quoteVolume / base;
    const score = dayRet * Math.log10(1 + Math.max(0, volRatio));
    const bestScore = bestImpulse.dayRet * Math.log10(1 + Math.max(0, bestImpulse.volRatio));
    if (score > bestScore) bestImpulse = { dayRet, volRatio };
  }
  const strongImpulse = bestImpulse.dayRet >= 0.15 && bestImpulse.volRatio >= 5;

  return {
    ok: true,
    date: judge.date,
    close: judge.close,
    drawdown,
    recovery,
    daysLowToJudge,
    quietBox,
    nearVolVsBox,
    aboveBox,
    ret5,
    ret10,
    strongImpulse,
  };
};

/**
 * 规则分型（与 mine-bullish-archetypes labelRuleArchetype 同序同阈）。
 * 仅当落入主土壤三型时返回 key，否则 null。
 */
export const classifyPrimarySoil = features => {
  if (!features?.ok) return null;
  const deep = features.drawdown <= -0.25;
  const veryDeep = features.drawdown <= -0.4;
  const accel = features.ret5 >= 0.1 && features.nearVolVsBox >= 3
    && (features.strongImpulse || features.ret5 >= 0.2);
  const quiet = (features.nearVolVsBox == null || features.nearVolVsBox < 2)
    && (features.ret5 == null || features.ret5 < 0.1);
  const early = features.recovery < 0.35 && features.daysLowToJudge <= 10;
  const extended = features.recovery >= 1.5 || (features.ret10 != null && features.ret10 >= 0.5);
  const flatBase = features.drawdown > -0.25;

  let key = 'OTHER';
  if (deep && accel) key = 'DROP_THEN_ACCEL';
  else if (veryDeep && early) key = 'DEEP_V';
  else if (deep && quiet && features.quietBox) key = 'DROP_QUIET_BOX';
  else if (deep && quiet) key = 'DROP_QUIET';
  else if (extended && !accel) key = 'ALREADY_EXTENDED';
  else if (flatBase && accel) key = 'FLAT_THEN_ACCEL';
  else if (deep && features.recovery >= 0.3) key = 'DROP_RECOVERING';

  return PRIMARY_SOIL_KEYS.includes(key) ? key : null;
};

/**
 * 在最近 recentDays 根已收盘日上扫描主土壤命中（至少一天即可入选观察池）。
 */
export const findRecentSoilHits = (barsInput, recentDays = SOIL_SCAN_V01.recentDays) => {
  const bars = normalizeBars(barsInput);
  if (bars.length < SOIL_SCAN_V01.minPrefixBars) return [];

  const end = bars.length - 1;
  const start = Math.max(SOIL_SCAN_V01.minPrefixBars - 1, end - recentDays + 1);
  const hits = [];

  for (let i = start; i <= end; i += 1) {
    const features = extractSoilFeatures(bars.slice(0, i + 1));
    const soilType = classifyPrimarySoil(features);
    if (!soilType) continue;
    hits.push({
      date: bars[i].date,
      soilType,
      soilLabel: soilTypeLabel(soilType),
      close: bars[i].close,
      drawdown: features.drawdown,
      recovery: features.recovery,
      ret5: features.ret5,
      nearVolVsBox: features.nearVolVsBox,
    });
  }
  return hits;
};

/** 斜率正观察池：近 N 日温和上行（非裸斜率）；N 默认 30，页面可改 */
export const SLOPE_SCAN_V01 = {
  version: 'slope-scan-v0.1',
  windowDays: 30,
  windowDaysMin: 10,
  windowDaysMax: 120,
  /** log(close) 回归 R² 下限 */
  r2Min: 0.5,
  /** 窗内 (maxHigh−minLow)/medianClose 上限 */
  rangeMax: 0.5,
  /** 窗内收盘涨幅下限（滤贴零噪声） */
  retWindowMin: 0.05,
  /** 近端禁止单日暴拉 */
  spikeLookback: 5,
  spikeDayRetMax: 0.25,
};

/**
 * 近 windowDays 已收盘日：log(close) OLS 斜率>0 ∧ R² ∧ 振幅 ∧ 涨幅 ∧ 无近端暴拉。
 * @param {Array} barsInput 以最后一根为最新已收盘日
 * @param {{ windowDays?: number }} [options]
 */
export const evaluatePositiveSlope = (barsInput, options = {}) => {
  const base = SLOPE_SCAN_V01;
  const windowDays = Math.round(Number(options.windowDays ?? base.windowDays));
  const P = { ...base, windowDays };
  const bars = normalizeBars(barsInput);
  if (!(windowDays >= base.windowDaysMin) || bars.length < windowDays) {
    return { ok: false, pass: false, error: 'history_short', windowDays };
  }

  const win = bars.slice(-windowDays);
  const closes = win.map(b => b.close);
  if (closes.some(c => !(c > 0))) {
    return { ok: false, pass: false, error: 'bad_close', windowDays };
  }

  const n = windowDays;
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
    return { ok: false, pass: false, error: 'slope_fail', windowDays };
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

  let maxDayRet = -Infinity;
  const spikeStart = Math.max(1, n - P.spikeLookback);
  for (let i = spikeStart; i < n; i += 1) {
    const prev = closes[i - 1];
    if (!(prev > 0)) continue;
    const dayRet = closes[i] / prev - 1;
    if (dayRet > maxDayRet) maxDayRet = dayRet;
  }
  if (!Number.isFinite(maxDayRet)) maxDayRet = null;

  const pass = slope > 0
    && r2 >= P.r2Min
    && rangePct != null && rangePct <= P.rangeMax
    && retWindow >= P.retWindowMin
    && (maxDayRet == null || maxDayRet < P.spikeDayRetMax);

  const last = win[n - 1];
  return {
    ok: true,
    pass,
    windowDays: n,
    date: last.date,
    close: last.close,
    slope,
    /** 斜率折合约窗内对数收益 */
    slopeRetWindow: slope * (n - 1),
    r2,
    rangePct,
    retWindow,
    maxDayRet5: maxDayRet,
  };
};

/**
 * 成功事件口径（研究样本标签，不是入场点）
 * 主标签：判定/触发收盘 → 其后 primaryHorizon 日 max(high)/entry − 1 ≥ primaryThreshold（摸到）
 * 可交易性并列：同窗口内是否「先触及」stopLossRet（默认 −50%）止损
 */
export const SUCCESS_V01 = {
  version: 'success-v0.3',
  /** 只统计该日及之后的触发；观察窗仍可用更早 K 线 */
  triggerStartDate: '2022-01-01',
  horizons: [5, 10, 20],
  thresholds: [0.3, 0.5, 1],
  /** 主标签（发现）：20 日摸到 ≥ +50%（相对 entry/判定收盘，不含当日） */
  primaryHorizon: 20,
  primaryThreshold: 0.5,
  /** 并列必报（可交易性）：相对 entry 的止损回撤；先触及止损计 stop_first */
  stopLossRet: -0.5,
  /**
   * 同日既触止损又触目标：日线无法分辨先后，按保守计 stop_first
   * （高估「先止损」比例，避免美化可交易性）
   */
  sameBarAmbiguousAs: 'stop_first',
  /** 连续命中只在首日计一次触发，避免同一段行情重复计票 */
  edgeTriggerOnly: true,
  measure: 'forward_max_high_vs_entry',
  pathMeasure: 'stop_before_target',
};

const num = value => Number(value);
const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** 将 Binance/市场层 K 线规范为统一结构。支持对象行或 [ts,o,h,l,c,baseVol,quoteVol] */
export const normalizeBars = rows => (rows || []).map(row => {
  if (Array.isArray(row)) {
    return {
      openTime: Number(row[0]),
      date: new Date(Number(row[0])).toISOString().slice(0, 10),
      open: num(row[1]),
      high: num(row[2]),
      low: num(row[3]),
      close: num(row[4]),
      volume: num(row[5]),
      quoteVolume: num(row[6]),
    };
  }
  return {
    openTime: Number(row.openTime),
    date: row.date || new Date(Number(row.openTime)).toISOString().slice(0, 10),
    open: num(row.open),
    high: num(row.high),
    low: num(row.low),
    close: num(row.close),
    volume: num(row.volume),
    quoteVolume: num(row.quoteVolume),
  };
}).filter(bar => Number.isFinite(bar.close) && Number.isFinite(bar.quoteVolume));

const volRatioAt = (bars, index, baseDays = PATTERN_V01.volBaseDays) => {
  const base = bars.slice(Math.max(0, index - baseDays), index).map(bar => bar.quoteVolume);
  const baseMean = mean(base);
  if (!(baseMean > 0)) return null;
  return bars[index].quoteVolume / baseMean;
};

/**
 * @param {Array} barsInput 以判定日为最后一根（或更长，将取末窗）
 * @returns 判定明细
 */
export const evaluatePatternV01 = barsInput => {
  const P = PATTERN_V01;
  const bars = normalizeBars(barsInput);
  if (bars.length < P.windowDays) {
    return {
      ok: false,
      error: `K线不足 ${P.windowDays} 根（当前 ${bars.length}）`,
      version: P.version,
    };
  }

  const window = bars.slice(-P.windowDays);
  const judge = window[window.length - 1];

  let troughIndex = 0;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].low < window[troughIndex].low) troughIndex = i;
  }
  const trough = window[troughIndex].low;
  let peak = window[0].high;
  for (let i = 1; i <= troughIndex; i += 1) {
    if (window[i].high > peak) peak = window[i].high;
  }
  const drawdown = peak > 0 ? trough / peak - 1 : null;

  const searchEnd = Math.floor(window.length * P.boxSearchRatio);
  let boxStart = 0;
  let bestMedian = Infinity;
  for (let i = 0; i <= searchEnd - P.boxDays; i += 1) {
    const slice = window.slice(i, i + P.boxDays);
    const med = median(slice.map(bar => bar.quoteVolume));
    if (med != null && med < bestMedian) {
      bestMedian = med;
      boxStart = i;
    }
  }
  const quietBox = window.slice(boxStart, boxStart + P.boxDays);
  const boxHigh = Math.max(...quietBox.map(bar => bar.high));
  const boxLow = Math.min(...quietBox.map(bar => bar.low));
  const boxWidth = boxLow > 0 ? (boxHigh - boxLow) / boxLow : null;
  const boxMedianQ = median(quietBox.map(bar => bar.quoteVolume));
  const boxAvgQ = mean(quietBox.map(bar => bar.quoteVolume));
  const windowMedianQ = median(window.map(bar => bar.quoteVolume));
  const boxMedianQRatio = windowMedianQ > 0 ? boxMedianQ / windowMedianQ : null;

  const nearAvgQ = mean(window.slice(-P.nearVolDays).map(bar => bar.quoteVolume));
  const recovery = trough > 0 ? judge.close / trough - 1 : null;

  const A_drop = drawdown != null && drawdown <= P.drawdownMax;
  const A_flat = drawdown != null && drawdown > P.drawdownMax;
  const B = boxWidth != null && boxWidth <= P.boxWidthMax
    && boxMedianQRatio != null && boxMedianQRatio <= P.boxMedianQRatioMax;
  const C = judge.close > boxHigh;
  const G = recovery != null && recovery >= P.recoveryMin;
  const H = boxAvgQ > 0 && nearAvgQ != null && nearAvgQ >= boxAvgQ * P.nearVolVsBoxMin;

  const advanceStart = Math.max(0, window.length - P.advanceLookback);
  let D_strong = false;
  let D_volume_run = false;
  let dStrongHit = null;
  let dRunHit = null;
  // volRatio 用完整 bars，使基期可延伸到观察窗之前
  const fullOffset = bars.length - window.length;
  for (let i = advanceStart; i < window.length; i += 1) {
    const fullIndex = fullOffset + i;
    const bar = window[i];
    const dayRet = bar.open > 0 ? bar.close / bar.open - 1 : null;
    const ratio = volRatioAt(bars, fullIndex);
    if (dayRet != null && ratio != null && dayRet >= P.dStrongRetMin && ratio >= P.dStrongVolRatioMin) {
      D_strong = true;
      if (!dStrongHit) dStrongHit = { date: bar.date, dayRet, volRatio: ratio };
    }
    if (ratio != null && ratio >= P.dRunVolRatioMin && i >= P.dRunCompareDays) {
      const prior = window[i - P.dRunCompareDays];
      if (bar.close > prior.close) {
        D_volume_run = true;
        if (!dRunHit) dRunHit = { date: bar.date, volRatio: ratio, vsDate: prior.date };
      }
    }
  }
  const D = D_strong || D_volume_run;

  const prior5 = window.length >= 6 ? window[window.length - 6].close : null;
  const ret5 = prior5 > 0 ? judge.close / prior5 - 1 : null;
  const nearVolVsBox = boxAvgQ > 0 && nearAvgQ != null ? nearAvgQ / boxAvgQ : null;
  const M_ret5 = ret5 != null && ret5 >= PATTERN_V02.ret5Min;
  const M_vol = nearVolVsBox != null && nearVolVsBox >= PATTERN_V02.nearVolVsBoxMin;

  // v0.3：近 5 日（含判定日）强预演，或判定日量比极端放大
  let P_impulse = false;
  let impulseHit = null;
  let triggerDayVolRatio = null;
  const impulseStart = Math.max(0, window.length - PATTERN_V03.impulseLookback);
  for (let i = impulseStart; i < window.length; i += 1) {
    const fullIndex = fullOffset + i;
    const bar = window[i];
    const dayRet = bar.open > 0 ? bar.close / bar.open - 1 : null;
    const ratio = volRatioAt(bars, fullIndex);
    if (i === window.length - 1) triggerDayVolRatio = ratio;
    if (
      dayRet != null
      && ratio != null
      && dayRet >= PATTERN_V03.impulseDayRetMin
      && ratio >= PATTERN_V03.impulseVolRatioMin
    ) {
      P_impulse = true;
      if (!impulseHit) impulseHit = { date: bar.date, dayRet, volRatio: ratio, kind: 'strong-day' };
    }
  }
  if (
    !P_impulse
    && triggerDayVolRatio != null
    && triggerDayVolRatio >= PATTERN_V03.triggerDayVolRatioMin
  ) {
    P_impulse = true;
    impulseHit = {
      date: judge.date,
      dayRet: judge.open > 0 ? judge.close / judge.open - 1 : null,
      volRatio: triggerDayVolRatio,
      kind: 'trigger-vol',
    };
  }

  const trunk = B && C && G && H && D;
  const hit_v0_1_drop = trunk && A_drop;
  const hit_v0_1_flat_seat = trunk && A_flat;
  const hit_v0_2_drop = hit_v0_1_drop && M_ret5 && M_vol;
  const hit_v0_3_drop = hit_v0_2_drop && P_impulse;
  const M4_ret5 = ret5 != null && ret5 >= PATTERN_V04.ret5Min;
  const M4_vol = nearVolVsBox != null && nearVolVsBox >= PATTERN_V04.nearVolVsBoxMin;
  const hit_v0_4_drop = hit_v0_3_drop && M4_ret5 && M4_vol;

  return {
    ok: true,
    version: P.version,
    judgeDate: judge.date,
    flags: {
      A_drop,
      A_flat,
      B,
      C,
      G,
      H,
      D,
      D_strong,
      D_volume_run,
      M_ret5,
      M_vol,
      P_impulse,
      M4_ret5,
      M4_vol,
      trunk,
      hit_v0_1_drop,
      hit_v0_1_flat_seat,
      hit_v0_2_drop,
      hit_v0_3_drop,
      hit_v0_4_drop,
    },
    metrics: {
      drawdown,
      troughDate: window[troughIndex].date,
      trough,
      peak,
      box: {
        from: quietBox[0].date,
        to: quietBox[quietBox.length - 1].date,
        high: boxHigh,
        low: boxLow,
        width: boxWidth,
        medianQuoteVolumeUsdt: boxMedianQ,
        avgQuoteVolumeUsdt: boxAvgQ,
        medianQRatio: boxMedianQRatio,
      },
      judgeClose: judge.close,
      closeVsBoxHigh: boxHigh > 0 ? judge.close / boxHigh - 1 : null,
      recovery,
      ret5,
      nearAvgQuoteVolumeUsdt: nearAvgQ,
      nearVolVsBox,
      triggerDayVolRatio,
      dStrongHit,
      dRunHit,
      impulseHit,
    },
  };
};

const forwardStats = (bars, triggerIndex, horizon) => {
  const entry = bars[triggerIndex].close;
  const end = Math.min(bars.length - 1, triggerIndex + horizon);
  const daysAvailable = end - triggerIndex;
  const targetPrice = entry * (1 + SUCCESS_V01.primaryThreshold);
  const stopPrice = entry * (1 + SUCCESS_V01.stopLossRet);

  if (daysAvailable <= 0) {
    return {
      daysAvailable: 0,
      complete: false,
      maxRet: null,
      maxHighDate: null,
      minRet: null,
      path: null,
      hitTarget: false,
      hitStop: false,
    };
  }

  let maxHigh = -Infinity;
  let maxHighDate = null;
  let minLow = Infinity;
  let path = 'neither';
  let hitTarget = false;
  let hitStop = false;

  for (let j = triggerIndex + 1; j <= end; j += 1) {
    const bar = bars[j];
    if (bar.high > maxHigh) {
      maxHigh = bar.high;
      maxHighDate = bar.date;
    }
    if (bar.low < minLow) minLow = bar.low;

    const touchedTarget = bar.high >= targetPrice;
    const touchedStop = bar.low <= stopPrice;
    if (path !== 'neither') continue;

    if (touchedStop && touchedTarget) {
      // 同日双触：日线无先后 → 保守记 stop_first
      path = SUCCESS_V01.sameBarAmbiguousAs === 'target_first' ? 'target_first' : 'stop_first';
      hitStop = true;
      hitTarget = true;
    } else if (touchedStop) {
      path = 'stop_first';
      hitStop = true;
    } else if (touchedTarget) {
      path = 'target_first';
      hitTarget = true;
    }
  }

  if (path === 'neither') {
    hitTarget = maxHigh >= targetPrice;
    hitStop = minLow <= stopPrice;
  } else if (path === 'stop_first') {
    hitStop = true;
    hitTarget = maxHigh >= targetPrice;
  } else if (path === 'target_first') {
    hitTarget = true;
    hitStop = minLow <= stopPrice;
  }

  return {
    daysAvailable,
    complete: daysAvailable >= horizon,
    maxRet: maxHigh / entry - 1,
    maxHighDate,
    minRet: minLow / entry - 1,
    path,
    hitTarget,
    hitStop,
    targetPrice,
    stopPrice,
  };
};

export const evaluateForwardFromEntry = forwardStats;

/**
 * 单币：枚举所有合格判定日的前向结果（基率分母单位）
 * 上市代理 = 该币 K 线首根；前向不完整的日不进分母。
 */
export const collectJudgeDayOutcomes = (barsInput, options = {}) => {
  const bars = normalizeBars(barsInput);
  const startDate = options.triggerStartDate ?? SUCCESS_V01.triggerStartDate;
  const horizon = options.horizon ?? SUCCESS_V01.primaryHorizon;
  const minListingDays = options.minListingDays ?? UNIVERSE_V01.minListingDays;
  const outcomes = [];
  if (bars.length < minListingDays + horizon + 1) return outcomes;

  const listedAt = bars[0].openTime;
  const listingMs = minListingDays * 24 * 60 * 60 * 1000;

  for (let i = 0; i < bars.length; i += 1) {
    if (startDate && bars[i].date < startDate) continue;
    if (!(bars[i].openTime - listedAt >= listingMs)) continue;
    if (i + horizon >= bars.length) continue; // 前向不完整：不进分母
    const forward = forwardStats(bars, i, horizon);
    if (!forward.complete) continue;
    outcomes.push({
      date: bars[i].date,
      entry: bars[i].close,
      forward,
      success: forward.maxRet >= SUCCESS_V01.primaryThreshold,
      stopFirst: forward.path === 'stop_first',
    });
  }
  return outcomes;
};

/** 汇总基率；可选同币成功日去重事件率（间隔 < dedupeGapDays） */
export const summarizeBaseRate = (outcomes, options = {}) => {
  const dedupeGapDays = options.dedupeGapDays ?? BASE_RATE_V01.dedupeGapDays;
  const n = outcomes.length;
  const successes = outcomes.filter(item => item.success);
  const stopFirst = outcomes.filter(item => item.stopFirst);

  let dedupedSuccess = 0;
  let lastSuccessTs = null;
  const dayMs = 24 * 60 * 60 * 1000;
  successes.forEach(item => {
    const ts = Date.parse(`${item.date}T00:00:00.000Z`);
    if (lastSuccessTs == null || ts - lastSuccessTs >= dedupeGapDays * dayMs) {
      dedupedSuccess += 1;
      lastSuccessTs = ts;
    }
  });

  return {
    version: BASE_RATE_V01.version,
    unit: BASE_RATE_V01.unit,
    n,
    successCount: successes.length,
    /** 主基率：P(20d 摸到 ≥50% | 合格判定日) */
    baseRate: n ? successes.length / n : null,
    stopFirstCount: stopFirst.length,
    stopFirstRate: n ? stopFirst.length / n : null,
    dedupedSuccessCount: dedupedSuccess,
    /** 辅助：去重后的成功事件密度（仍以全部合格日为分母） */
    dedupedEventRate: n ? dedupedSuccess / n : null,
  };
};

/**
 * 在单币日线上回放触发日。
 * @param {Array} barsInput
 * @param {{ edgeTriggerOnly?: boolean, triggerStartDate?: string, hitFlag?: 'hit_v0_1_drop'|'hit_v0_2_drop' }} [options]
 */
export const collectTriggersV01 = (barsInput, options = {}) => {
  const edgeTriggerOnly = options.edgeTriggerOnly ?? SUCCESS_V01.edgeTriggerOnly;
  const triggerStartDate = options.triggerStartDate ?? SUCCESS_V01.triggerStartDate;
  const hitFlag = options.hitFlag || 'hit_v0_1_drop';
  const bars = normalizeBars(barsInput);
  const triggers = [];
  let prevHit = false;

  for (let i = PATTERN_V01.windowDays - 1; i < bars.length; i += 1) {
    const result = evaluatePatternV01(bars.slice(0, i + 1));
    const hit = Boolean(result.flags?.[hitFlag]);
    const isTrigger = hit && (!edgeTriggerOnly || !prevHit);
    prevHit = hit;
    if (!isTrigger || !result.ok) continue;
    if (triggerStartDate && bars[i].date < triggerStartDate) continue;

    const forward = {};
    SUCCESS_V01.horizons.forEach(horizon => {
      forward[`d${horizon}`] = forwardStats(bars, i, horizon);
    });

    triggers.push({
      date: bars[i].date,
      entry: bars[i].close,
      forward,
      flags: result.flags,
      metrics: result.metrics,
      patternVersion: hitFlag === 'hit_v0_2_drop' ? PATTERN_V02.version : PATTERN_V01.version,
    });
  }

  return triggers;
};

/** 一次回放同时收集 v0.1..v0.4 触发（共用判定，edge 分别计数） */
export const collectTriggersCompare = (barsInput, options = {}) => {
  const edgeTriggerOnly = options.edgeTriggerOnly ?? SUCCESS_V01.edgeTriggerOnly;
  const triggerStartDate = options.triggerStartDate ?? SUCCESS_V01.triggerStartDate;
  const bars = normalizeBars(barsInput);
  const buckets = { v01: [], v02: [], v03: [], v04: [] };
  const prev = { v01: false, v02: false, v03: false, v04: false };
  const versions = [
    { key: 'v01', flag: 'hit_v0_1_drop', version: PATTERN_V01.version },
    { key: 'v02', flag: 'hit_v0_2_drop', version: PATTERN_V02.version },
    { key: 'v03', flag: 'hit_v0_3_drop', version: PATTERN_V03.version },
    { key: 'v04', flag: 'hit_v0_4_drop', version: PATTERN_V04.version },
  ];

  const pushTrigger = (list, index, result, version) => {
    const forward = {};
    SUCCESS_V01.horizons.forEach(horizon => {
      forward[`d${horizon}`] = forwardStats(bars, index, horizon);
    });
    list.push({
      date: bars[index].date,
      entry: bars[index].close,
      forward,
      flags: result.flags,
      metrics: result.metrics,
      patternVersion: version,
    });
  };

  for (let i = PATTERN_V01.windowDays - 1; i < bars.length; i += 1) {
    const result = evaluatePatternV01(bars.slice(0, i + 1));
    if (!result.ok) {
      versions.forEach(item => { prev[item.key] = false; });
      continue;
    }

    const afterStart = !(triggerStartDate && bars[i].date < triggerStartDate);
    versions.forEach(item => {
      const hit = Boolean(result.flags[item.flag]);
      const trig = hit && (!edgeTriggerOnly || !prev[item.key]);
      prev[item.key] = hit;
      if (afterStart && trig) pushTrigger(buckets[item.key], i, result, item.version);
    });
  }

  return buckets;
};

/** 汇总触发列表的成功率（仅统计 forward 窗口完整的样本） */
export const summarizeTriggersV01 = triggers => {
  const summary = {
    version: SUCCESS_V01.version,
    triggerCount: triggers.length,
    byHorizon: {},
  };

  SUCCESS_V01.horizons.forEach(horizon => {
    const key = `d${horizon}`;
    const complete = triggers.filter(item => item.forward[key]?.complete);
    const rates = {};
    SUCCESS_V01.thresholds.forEach(threshold => {
      const wins = complete.filter(item => item.forward[key].maxRet >= threshold);
      rates[`ge${Math.round(threshold * 100)}`] = {
        threshold,
        complete: complete.length,
        wins: wins.length,
        rate: complete.length ? wins.length / complete.length : null,
      };
    });
    const rets = complete.map(item => item.forward[key].maxRet).filter(Number.isFinite).sort((a, b) => a - b);
    const stopFirst = complete.filter(item => item.forward[key].path === 'stop_first');
    const targetFirst = complete.filter(item => item.forward[key].path === 'target_first');
    const neither = complete.filter(item => item.forward[key].path === 'neither');
    summary.byHorizon[key] = {
      horizon,
      complete: complete.length,
      incomplete: triggers.length - complete.length,
      rates,
      avgMaxRet: rets.length ? mean(rets) : null,
      medianMaxRet: rets.length ? median(rets) : null,
      path: {
        stopLossRet: SUCCESS_V01.stopLossRet,
        targetRet: SUCCESS_V01.primaryThreshold,
        stopFirst: stopFirst.length,
        targetFirst: targetFirst.length,
        neither: neither.length,
        /** 先触及 −50% 止损的比例（完整窗口分母） */
        stopFirstRate: complete.length ? stopFirst.length / complete.length : null,
        targetFirstRate: complete.length ? targetFirst.length / complete.length : null,
      },
    };
  });

  return summary;
};
