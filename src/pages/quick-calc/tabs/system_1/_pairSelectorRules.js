import { SPIKE_CONFIG, HOLD_CONFIG } from '@root/src/consts/pairSelectorConfig';

/**
 * 规则函数默认使用虚拟币参数；传入 cfg 可复用同一套逻辑跑其他市场（如美股）。
 * cfg.volumeRatio / cfg.volumeMaDays 为可选：有则要求触发日量比达标，虚拟币不传则行为不变。
 */

/** 当日 quoteVol / 前 maDays 根 quoteVol 均值（不含当日）；历史不足返回 null */
export const getVolumeRatio = (candles, idx, maDays = 10) => {
  if (idx < maDays) return null;
  let sum = 0;
  for (let i = idx - maDays; i < idx; i++) {
    const v = parseFloat(candles[i][6]);
    if (!(v >= 0)) return null;
    sum += v;
  }
  const ma = sum / maDays;
  if (!(ma > 0)) return null;
  return parseFloat(candles[idx][6]) / ma;
};

/** 在 K 线中查找单日涨幅达到 SPIKE 阈值的第一根暴涨 K，返回日期与涨跌幅 */
export const getSingleDaySpike = (candles, cfg = SPIKE_CONFIG) => {
  // 带量比时 candles 含 MA 历史，只在最近 windowDays 内搜；否则扫全部（虚拟币原行为）
  const start =
    cfg.volumeRatio != null && cfg.windowDays != null
      ? Math.max(0, candles.length - cfg.windowDays)
      : 0;
  const needVol = cfg.volumeRatio != null;
  const maDays = cfg.volumeMaDays ?? 10;

  for (let i = start; i < candles.length; i++) {
    const open = parseFloat(candles[i][1]);
    const close = parseFloat(candles[i][4]);
    if (!(open > 0) || (close - open) / open < cfg.riseRatio) continue;
    let volRatio = null;
    if (needVol) {
      volRatio = getVolumeRatio(candles, i, maDays);
      if (volRatio == null || volRatio < cfg.volumeRatio) continue;
    }
    return {
      date: new Date(Number(candles[i][0])).toISOString().slice(0, 10),
      open,
      close,
      rise: (((close - open) / open) * 100).toFixed(1),
      volRatio: volRatio != null ? +volRatio.toFixed(2) : null,
      idx: i,
    };
  }

  return null;
};

/** 判断窗口内最高价是否相对首日开盘价涨幅达到 peak 阈值，满足则返回峰值信号 */
export const getWindowPeakSignal = (candles, cfg = SPIKE_CONFIG) => {
  if (!candles.length) return null;

  const start =
    cfg.volumeRatio != null && cfg.windowDays != null
      ? Math.max(0, candles.length - cfg.windowDays)
      : 0;
  const window = candles.slice(start);
  if (!window.length) return null;

  const firstOpen = parseFloat(window[0][1]);
  let maxHigh = -Infinity;
  let maxHighIdx = start;
  window.forEach((c, j) => {
    const h = parseFloat(c[2]);
    if (h > maxHigh) {
      maxHigh = h;
      maxHighIdx = start + j;
    }
  });
  if (!(firstOpen > 0) || maxHigh < firstOpen * (1 + cfg.peakRatio)) {
    return null;
  }

  let volRatio = null;
  if (cfg.volumeRatio != null) {
    volRatio = getVolumeRatio(candles, maxHighIdx, cfg.volumeMaDays ?? 10);
    if (volRatio == null || volRatio < cfg.volumeRatio) return null;
  }

  return {
    date: new Date(Number(candles[candles.length - 1][0])).toISOString().slice(0, 10),
    firstOpen,
    maxHigh,
    ratio: (((maxHigh - firstOpen) / firstOpen) * 100).toFixed(1),
    volRatio: volRatio != null ? +volRatio.toFixed(2) : null,
  };
};

/** 从倒数第二根 K 往前找最近一根单日涨幅达 HOLD 阈值的暴涨 K */
export const findLatestSpikeCandidate = (candles, cfg = HOLD_CONFIG) => {
  const needVol = cfg.volumeRatio != null;
  const maDays = cfg.volumeMaDays ?? 10;
  // 带 MA 历史时只在最近 klineLimit 内搜；虚拟币 candles≈klineLimit，minIdx=0
  const minIdx = cfg.klineLimit != null ? Math.max(0, candles.length - cfg.klineLimit) : 0;

  for (let j = candles.length - 2; j >= minIdx; j--) {
    const open = parseFloat(candles[j][1]);
    const close = parseFloat(candles[j][4]);
    if (!(open > 0) || (close - open) / open < cfg.riseRatio) continue;
    let volRatio = null;
    if (needVol) {
      volRatio = getVolumeRatio(candles, j, maDays);
      if (volRatio == null || volRatio < cfg.volumeRatio) continue;
    }
    return {
      idx: j,
      date: new Date(Number(candles[j][0])).toISOString().slice(0, 10),
      open,
      close,
      rise: (((close - open) / open) * 100).toFixed(1),
      volRatio: volRatio != null ? +volRatio.toFixed(2) : null,
    };
  }

  return null;
};

/** 从近到远查找连续 4 天内最高价相对首日开盘价涨幅达阈值的窗口 */
export const findFourDayRunWindow = (candles, cfg = HOLD_CONFIG) => {
  const needVol = cfg.volumeRatio != null;
  const maDays = cfg.volumeMaDays ?? 10;
  const minIdx = cfg.klineLimit != null ? Math.max(0, candles.length - cfg.klineLimit) : 0;

  for (let start = candles.length - 5; start >= minIdx; start--) {
    const window = candles.slice(start, start + 4);
    if (window.length < 4) continue;

    const firstOpen = parseFloat(window[0][1]);
    let maxHigh = -Infinity;
    let maxHighOffset = 0;
    window.forEach((c, j) => {
      const h = parseFloat(c[2]);
      if (h > maxHigh) {
        maxHigh = h;
        maxHighOffset = j;
      }
    });
    if (maxHigh < firstOpen * (1 + cfg.fourDayRunRatio)) continue;

    let volRatio = null;
    if (needVol) {
      volRatio = getVolumeRatio(candles, start + maxHighOffset, maDays);
      if (volRatio == null || volRatio < cfg.volumeRatio) continue;
    }

    return {
      startIdx: start,
      basePrice: Math.max(...window.map(c => parseFloat(c[4]))), // 4 天内最高收盘价
      volRatio: volRatio != null ? +volRatio.toFixed(2) : null,
    };
  }

  return null;
};

/**
 * 计算 HOLD 模式基准价：暴涨 / 连续4天 两条路径独立判断。
 * 当前价需落在 [基准价 × priceRatio, 基准价 × maxPriceRatio] 区间内。
 * maxPriceRatio 缺省为无上限（虚拟币行为），美股用它排除"已走成新趋势"的标的。
 */
export const getHoldReference = (candles, cfg = HOLD_CONFIG) => {
  const lastCandle = candles[candles.length - 1];
  const currentPrice = parseFloat(lastCandle[4]);
  const spikeSignal = findLatestSpikeCandidate(candles, cfg);
  const fourDayRun = findFourDayRunWindow(candles, cfg);

  const maxRatio = cfg.maxPriceRatio ?? Infinity;
  const inBand = baseline =>
    baseline != null &&
    currentPrice >= baseline * cfg.priceRatio &&
    currentPrice <= baseline * maxRatio;

  const spikeBaseline = spikeSignal?.close ?? null;
  const fourDayBaseline = fourDayRun?.basePrice ?? null;
  const spikeHit = inBand(spikeBaseline);
  const fourDayHit = inBand(fourDayBaseline);

  if (!spikeHit && !fourDayHit) {
    return null;
  }

  if (spikeHit) {
    return {
      currentPrice,
      baseline: spikeBaseline,
      spikeClose: spikeBaseline,
      threshold: spikeBaseline * cfg.priceRatio,
      daysAgo: candles.length - 1 - spikeSignal.idx,
      trigger: fourDayHit ? '两者' : '暴涨',
      referenceDate: spikeSignal.date,
      referenceRise: spikeSignal.rise,
      volRatio: spikeSignal.volRatio ?? fourDayRun?.volRatio ?? null,
    };
  }

  return {
    currentPrice,
    baseline: fourDayBaseline,
    spikeClose: null,
    threshold: fourDayBaseline * cfg.priceRatio,
    daysAgo: candles.length - 1 - fourDayRun.startIdx,
    trigger: '连续4天',
    referenceDate: new Date(Number(candles[fourDayRun.startIdx][0])).toISOString().slice(0, 10),
    referenceRise: null,
    volRatio: fourDayRun.volRatio ?? null,
  };
};
