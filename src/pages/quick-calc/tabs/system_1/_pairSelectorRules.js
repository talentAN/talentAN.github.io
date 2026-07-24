import { SPIKE_CONFIG, HOLD_CONFIG } from '@root/src/consts/pairSelectorConfig';

/** 在 K 线中查找单日涨幅达到 SPIKE 阈值的第一根暴涨 K，返回日期与涨跌幅 */
export const getSingleDaySpike = candles => {
  const spike = candles.find(c => {
    const open = parseFloat(c[1]);
    const close = parseFloat(c[4]);
    return open > 0 && (close - open) / open >= SPIKE_CONFIG.riseRatio;
  });

  if (!spike) return null;

  const open = parseFloat(spike[1]);
  const close = parseFloat(spike[4]);
  return {
    date: new Date(Number(spike[0])).toISOString().slice(0, 10),
    open,
    close,
    rise: (((close - open) / open) * 100).toFixed(1),
  };
};

/** 判断窗口内最高价是否相对首日开盘价涨幅达到 peak 阈值，满足则返回峰值信号 */
export const getWindowPeakSignal = candles => {
  if (!candles.length) return null;

  const firstOpen = parseFloat(candles[0][1]);
  const maxHigh = Math.max(...candles.map(c => parseFloat(c[2])));
  if (!(firstOpen > 0) || maxHigh < firstOpen * (1 + SPIKE_CONFIG.peakRatio)) {
    return null;
  }

  return {
    date: new Date(Number(candles[candles.length - 1][0])).toISOString().slice(0, 10),
    firstOpen,
    maxHigh,
    ratio: (((maxHigh - firstOpen) / firstOpen) * 100).toFixed(1),
  };
};

/** 从倒数第二根 K 往前找最近一根单日涨幅达 HOLD 阈值的暴涨 K */
export const findLatestSpikeCandidate = candles => {
  for (let j = candles.length - 2; j >= 0; j--) {
    const open = parseFloat(candles[j][1]);
    const close = parseFloat(candles[j][4]);
    if (open > 0 && (close - open) / open >= HOLD_CONFIG.riseRatio) {
      const spikeOpen = parseFloat(candles[j][1]);
      const spikeClose = parseFloat(candles[j][4]);
      return {
        idx: j,
        date: new Date(Number(candles[j][0])).toISOString().slice(0, 10),
        open: spikeOpen,
        close: spikeClose,
        rise: (((spikeClose - spikeOpen) / spikeOpen) * 100).toFixed(1),
      };
    }
  }

  return null;
};

/** 从近到远查找连续 4 天内最高价相对首日开盘价涨幅达阈值的窗口 */
export const findFourDayRunWindow = candles => {
  for (let start = candles.length - 5; start >= 0; start--) {
    const window = candles.slice(start, start + 4);
    if (window.length < 4) continue;

    const firstOpen = parseFloat(window[0][1]);
    const maxHigh = Math.max(...window.map(c => parseFloat(c[2])));
    if (maxHigh >= firstOpen * (1 + HOLD_CONFIG.fourDayRunRatio)) {
      return {
        startIdx: start,
        basePrice: Math.max(...window.map(c => parseFloat(c[4]))),
      };
    }
  }

  return null;
};

/** 计算 HOLD 模式的基准价与阈值：优先用暴涨 K，否则用 4 天连续上涨窗口 */
export const getHoldReference = candles => {
  const lastCandle = candles[candles.length - 1];
  const currentPrice = parseFloat(lastCandle[4]);
  const spikeSignal = findLatestSpikeCandidate(candles);
  const fourDayRun = findFourDayRunWindow(candles);

  if (!spikeSignal && !fourDayRun) {
    return null;
  }

  let baseline = null;
  let daysAgo = null;
  let trigger = '当前价';
  let referenceDate = null;
  let referenceRise = null;

  if (spikeSignal) {
    baseline = spikeSignal.close;
    for (let j = spikeSignal.idx + 1; j <= candles.length - 2; j++) {
      const nextClose = parseFloat(candles[j][4]);
      if (nextClose > baseline) baseline = nextClose;
    }

    daysAgo = candles.length - 1 - spikeSignal.idx;
    referenceDate = spikeSignal.date;
    referenceRise = spikeSignal.rise;
  } else {
    baseline = fourDayRun.basePrice;
    daysAgo = candles.length - 1 - fourDayRun.startIdx;
    referenceDate = new Date(Number(candles[fourDayRun.startIdx][0])).toISOString().slice(0, 10);
    trigger = '连续4天';
  }

  return {
    currentPrice,
    baseline,
    threshold: baseline * HOLD_CONFIG.priceRatio,
    daysAgo,
    trigger,
    referenceDate,
    referenceRise,
  };
};
