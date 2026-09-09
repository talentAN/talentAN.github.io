#!/usr/bin/env node
import fs from 'node:fs/promises';

const input = process.argv[2] || 'src/data/market/binance/BTRUSDT-1d-2026-05-26_2026-08-24.json';
const output = process.argv[3] || 'src/data/market/binance/BTRUSDT-1d-2026-05-26_2026-08-24.explanation.json';
const payload = JSON.parse(await fs.readFile(input, 'utf8'));
const rows = payload.rows || [];

const N = {
  short: 5,
  trend: 20,
  long: 60,
  atr: 14,
  box: 20,
  adx: 14,
};
const LONG_FLAT_RETURN_THRESHOLD = 0.05;
const LONG_FLAT_SLOPE_THRESHOLD = Math.log(1 + LONG_FLAT_RETURN_THRESHOLD) / (N.long - 1);

const num = value => Number(value);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const stdev = values => {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(mean(values.map(value => (value - avg) ** 2)));
};
const sliceValues = (values, end, length) => values.slice(Math.max(0, end - length + 1), end + 1);
const highest = values => values.length ? Math.max(...values) : null;
const lowest = values => values.length ? Math.min(...values) : null;
const percentile = (values, value) => {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length || !Number.isFinite(value)) return null;
  return clean.filter(item => item <= value).length / clean.length;
};

const closes = rows.map(row => num(row.close));
const highs = rows.map(row => num(row.high));
const lows = rows.map(row => num(row.low));
const volumes = rows.map(row => num(row.volume));
const quoteVolumes = rows.map(row => num(row.quoteVolume));
const logCloses = closes.map(Math.log);

const regressionSlope = (values, end, length) => {
  if (end + 1 < length) return null;
  const series = values.slice(end - length + 1, end + 1);
  const xMean = (length - 1) / 2;
  const yMean = mean(series);
  const numerator = series.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0);
  const denominator = series.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);
  return denominator ? numerator / denominator : null;
};

const ema = (values, period) => {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = mean(values.slice(0, period));
  result[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    result[index] = previous;
  }
  return result;
};

const trueRanges = rows.map((row, index) => {
  const high = highs[index];
  const low = lows[index];
  const previousClose = index > 0 ? closes[index - 1] : null;
  return previousClose == null ? high - low : Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
});

const wilder = (values, period) => {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let current = mean(values.slice(0, period));
  result[period - 1] = current;
  for (let index = period; index < values.length; index += 1) {
    current = (current * (period - 1) + values[index]) / period;
    result[index] = current;
  }
  return result;
};

const atr = wilder(trueRanges, N.atr);
const ema20 = ema(closes, N.trend);
const ema5 = ema(closes, N.short);
const ema60 = ema(closes, N.long);

const plusDm = Array(rows.length).fill(0);
const minusDm = Array(rows.length).fill(0);
for (let index = 1; index < rows.length; index += 1) {
  const up = highs[index] - highs[index - 1];
  const down = lows[index - 1] - lows[index];
  plusDm[index] = up > down && up > 0 ? up : 0;
  minusDm[index] = down > up && down > 0 ? down : 0;
}
const smoothedAtr = wilder(trueRanges, N.adx);
const smoothedPlus = wilder(plusDm, N.adx);
const smoothedMinus = wilder(minusDm, N.adx);
const dx = rows.map((_, index) => {
  if (!(smoothedAtr[index] > 0) || smoothedPlus[index] == null || smoothedMinus[index] == null) return null;
  const plusDi = 100 * smoothedPlus[index] / smoothedAtr[index];
  const minusDi = 100 * smoothedMinus[index] / smoothedAtr[index];
  return plusDi + minusDi ? 100 * Math.abs(plusDi - minusDi) / (plusDi + minusDi) : 0;
});
const adx = wilder(dx.map(value => value ?? 0), N.adx);

const features = rows.map((row, index) => {
  const close = closes[index];
  const previousClose = index > 0 ? closes[index - 1] : null;
  const dailyReturn = previousClose ? close / previousClose - 1 : null;
  const open = num(row.open);
  const bodySize = Math.abs(close - open);
  const bodyRatio = open ? bodySize / open : null;
  const upperShadow = highs[index] - Math.max(open, close);
  const lowerShadow = Math.min(open, close) - lows[index];
  const closePosition = highs[index] > lows[index] ? (close - lows[index]) / (highs[index] - lows[index]) : null;
  const trendSlope = regressionSlope(logCloses, index, N.trend);
  const longSlope = regressionSlope(logCloses, index, N.long);
  const slope5 = regressionSlope(logCloses, index, N.short);
  const boxHighValues = highs.slice(Math.max(0, index - N.box), index);
  const boxLowValues = lows.slice(Math.max(0, index - N.box), index);
  const bbValues = sliceValues(closes, index, N.trend);
  const bbMean = mean(bbValues);
  const bbStd = stdev(bbValues);
  const bbWidth = bbMean && bbStd != null ? 4 * bbStd / bbMean : null;
  const historicalWidths = rows.slice(0, index + 1).map((_, i) => {
    const values = sliceValues(closes, i, N.trend);
    const avg = mean(values);
    const deviation = stdev(values);
    return avg && deviation != null ? 4 * deviation / avg : null;
  });
  const ema20Slope = index >= 5 && ema20[index] != null && ema20[index - 5] != null
    ? Math.log(ema20[index] / ema20[index - 5]) / 5
    : null;
  const ema60Slope = index >= 5 && ema60[index] != null && ema60[index - 5] != null
    ? Math.log(ema60[index] / ema60[index - 5]) / 5
    : null;
  const longReturn = index >= N.long ? close / closes[index - N.long] - 1 : null;
  const boxHigh = highest(boxHighValues);
  const boxLow = lowest(boxLowValues);
  const atrPct = atr[index] != null && close > 0 ? atr[index] / close : null;
  const widthPercentile = percentile(historicalWidths, bbWidth);
  const quoteVolumeMedian = mean(sliceValues(quoteVolumes, index - 1, N.box));
  const quoteVolumeRatio = quoteVolumeMedian > 0 ? quoteVolumes[index] / quoteVolumeMedian : null;
  const weakDownOrFlat = longSlope != null && longSlope <= LONG_FLAT_SLOPE_THRESHOLD;
  const consolidation = trendSlope != null && Math.abs(trendSlope) <= 0.002 &&
    widthPercentile != null && widthPercentile <= 0.4 && adx[index] != null && adx[index] < 25;
  const higherClose = index >= 5 && close > closes[index - 5];
  const upsideTransition = ema20Slope != null && ema20Slope > 0 && higherClose &&
    boxHigh != null && close > boxHigh;
  const breakout = boxHigh != null && atr[index] != null && close > boxHigh + 0.2 * atr[index];
  const trendConfirmed = ema20[index] != null && ema60[index] != null && ema20[index] > ema60[index] &&
    ema20Slope != null && ema20Slope > 0 && adx[index] != null && adx[index] > 20;
  const score = [
    weakDownOrFlat,
    consolidation,
    bbWidth != null && widthPercentile != null && widthPercentile <= 0.3,
    ema20Slope != null && ema20Slope > 0,
    higherClose,
    breakout,
    quoteVolumeRatio != null && quoteVolumeRatio >= 1.2,
    ema20[index] != null && ema60[index] != null && ema20[index] > ema60[index],
    adx[index] != null && adx[index] > 20,
  ].filter(Boolean).length;
  let state = 'INSUFFICIENT_DATA';
  if (longSlope != null) state = 'WEAK_DOWN_OR_FLAT';
  if (state !== 'INSUFFICIENT_DATA' && consolidation) state = 'CONSOLIDATION';
  if (state === 'CONSOLIDATION' && upsideTransition) state = 'UPSIDE_TRANSITION';
  if (trendConfirmed && breakout) state = 'CONFIRMED_UPTREND';

  return {
    date: new Date(row.openTime).toISOString().slice(0, 10),
    state,
    l0: {
      raw: {
        openTime: row.openTime,
        closeTime: row.closeTime,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        quoteVolume: row.quoteVolume,
        tradeCount: row.tradeCount,
      },
    },
    l1: {
      measurements: {
        dailyReturn,
        bodySize,
        bodyRatio,
        upperShadow,
        lowerShadow,
        closePosition,
        trueRange: trueRanges[index],
        atr: atr[index],
        atrPct,
        ema5: ema5[index],
        ema20: ema20[index],
        ema60: ema60[index],
        slope5,
        slope20: trendSlope,
        slope60: longSlope,
        ema20Slope,
        ema60Slope,
        longReturn60: longReturn,
        rollingHigh20: highest(boxHighValues),
        rollingLow20: lowest(boxLowValues),
        boxHigh20: boxHigh,
        boxLow20: boxLow,
        boxWidthPct: boxLow ? (boxHigh - boxLow) / boxLow : null,
        bollingerWidth: bbWidth,
        bollingerWidthPercentile: widthPercentile,
        adx: adx[index],
        quoteVolumeRatio20: quoteVolumeRatio,
        quoteVolume: quoteVolumes[index],
      },
    },
    l2: {
      judgements: {
        longDirection: longSlope == null || longReturn == null ? 'UNKNOWN' : longReturn < -LONG_FLAT_RETURN_THRESHOLD ? 'DOWN' : longReturn <= LONG_FLAT_RETURN_THRESHOLD ? 'FLAT' : 'UP',
        volatilityState: widthPercentile == null ? 'UNKNOWN' : widthPercentile <= 0.3 ? 'CONTRACTING' : widthPercentile >= 0.7 ? 'EXPANDING' : 'NORMAL',
        emaAlignment: ema20[index] == null || ema60[index] == null ? 'UNKNOWN' : ema20[index] > ema60[index] ? 'BULLISH' : 'NOT_BULLISH',
        emaTurningUp: ema20Slope != null && ema20Slope > 0,
        boxState: boxHigh == null || boxLow == null ? 'UNKNOWN' : breakout ? 'BREAKOUT_UP' : 'INSIDE_BOX',
        breakout: { value: breakout, reason: boxHigh == null || atr[index] == null ? 'insufficient data' : `close ${close} vs prior box high ${boxHigh} + 0.2 ATR` },
        quoteVolumeConfirmation: quoteVolumeRatio != null && quoteVolumeRatio >= 1.2,
        priceStructure: higherClose ? 'HIGHER_THAN_5D_AGO' : 'NOT_HIGHER_THAN_5D_AGO',
      },
    },
    l3: {
      state,
      score,
      evidence: [
        weakDownOrFlat && '长期方向为弱下行或横盘',
        consolidation && '低波动盘整条件成立',
        ema20Slope != null && ema20Slope > 0 && 'EMA20 斜率转正',
        breakout && '收盘突破前一日之前的20日箱体上沿',
        trendConfirmed && '均线结构与 ADX 确认上行',
      ].filter(Boolean),
      missing: [
        !consolidation && '缺少完整盘整条件',
        !breakout && '尚未确认箱体突破',
        !trendConfirmed && '尚未确认趋势强度和均线结构',
      ].filter(Boolean),
    },
    date: new Date(row.openTime).toISOString().slice(0, 10),
  };
});

const outputPayload = {
  metadata: {
    source: input,
    generatedAt: new Date().toISOString(),
    ruleVersion: 'bullish-state-v2-l0-l3',
    parameters: N,
    thresholds: {
      longDirectionFlatReturnThreshold: LONG_FLAT_RETURN_THRESHOLD,
      longDirectionSlopeThreshold: LONG_FLAT_SLOPE_THRESHOLD,
      consolidationSlopeAbsMax: 0.002,
      consolidationWidthPercentileMax: 0.4,
      consolidationAdxMax: 25,
      breakoutAtrMultiple: 0.2,
      volumeRatioMin: 1.2,
    },
    futureDataPolicy: 'boxHigh excludes current bar; pivots are not used in v1; features only use current and prior bars',
  },
  rows: features,
};
await fs.writeFile(output, `${JSON.stringify(outputPayload, null, 2)}\n`);
const stateCounts = features.reduce((counts, row) => {
  counts[row.l3.state] = (counts[row.l3.state] || 0) + 1;
  return counts;
}, {});
const candidates = features.filter(row => row.l3.state === 'UPSIDE_TRANSITION' || row.l3.state === 'CONFIRMED_UPTREND');
console.log(JSON.stringify({ output, count: features.length, stateCounts, candidates: candidates.map(row => ({ date: row.date, state: row.l3.state, score: row.l3.score })) }, null, 2));
