// 阶梯开仓回测：标记日确认后一次性挂出全部限价空单，成交后不再手动加仓

export const DEFAULT_LADDER = {
  capital: 10000,
  levels: [
    { mult: 2.0, notional: 120 },
    { mult: 2.4, notional: 140 },
    { mult: 3.0, notional: 160 },
    { mult: 4.0, notional: 180 },
  ],
  stopMult: 5.0,
  targetMult: 1.4,
  windowDays: 90,
  exitOnNewHigh: true,
};

export const EXIT_TYPES = {
  target: '止盈',
  stop: '止损',
  newHigh: '结构失效',
  open: '未结束',
  none: '未成交',
};

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isoDate = timestamp => new Date(Number(timestamp)).toISOString().slice(0, 10);

// 单个标记日跑一遍阶梯：逐日撮合挂单，同日内先判止损再判止盈（对空单取最坏顺序）
export const simulateLadder = (marker, cfg = DEFAULT_LADDER) => {
  const base = { key: marker.key, symbol: marker.symbol, exchange: marker.exchange, markerDate: marker.markerDate };
  const open = finite(marker.markerOpen);
  const candles = marker.followCandles;
  if (!(open > 0) || !Array.isArray(candles) || candles.length === 0) {
    return { ...base, exitType: 'none', filled: 0, pnl: 0 };
  }

  const stopPrice = open * cfg.stopMult;
  const targetPrice = open * cfg.targetMult;
  const markerHigh = finite(marker.markerHigh);
  const fills = [];
  const pending = cfg.levels.map(level => ({ ...level, price: open * level.mult }));

  let exitType = 'none';
  let exitPrice = null;
  let exitIndex = null;
  let maxHigh = null;

  const limit = Math.min(candles.length, cfg.windowDays + 1);
  for (let index = 0; index < limit; index++) {
    const high = finite(candles[index][2]);
    const low = finite(candles[index][3]);
    const close = finite(candles[index][4]);
    if (high == null || low == null) continue;

    for (let i = pending.length - 1; i >= 0; i--) {
      if (high >= pending[i].price) {
        fills.push(pending[i]);
        pending.splice(i, 1);
      }
    }
    if (fills.length === 0) continue;

    maxHigh = maxHigh == null ? high : Math.max(maxHigh, high);

    if (high >= stopPrice) {
      exitType = 'stop';
      exitPrice = stopPrice;
      exitIndex = index;
      break;
    }
    if (low <= targetPrice) {
      exitType = 'target';
      exitPrice = targetPrice;
      exitIndex = index;
      break;
    }
    // 收盘站上标记日最高价：注意力没消退，按结构失效离场
    if (cfg.exitOnNewHigh && markerHigh != null && close != null && close > markerHigh && index > 0) {
      exitType = 'newHigh';
      exitPrice = close;
      exitIndex = index;
      break;
    }
  }

  if (fills.length === 0) return { ...base, exitType: 'none', filled: 0, pnl: 0 };

  if (exitType === 'none') {
    exitType = 'open';
    const last = candles[Math.min(limit, candles.length) - 1];
    exitPrice = finite(last[4]);
    exitIndex = Math.min(limit, candles.length) - 1;
  }

  const notional = fills.reduce((sum, f) => sum + f.notional, 0);
  const qty = fills.reduce((sum, f) => sum + f.notional / f.price, 0);
  const avgEntry = notional / qty;
  const pnl = qty * (avgEntry - exitPrice);
  const peakLoss = maxHigh != null ? qty * (avgEntry - maxHigh) : null;

  return {
    ...base,
    markerOpen: open,
    filled: fills.length,
    notional,
    avgEntry,
    avgEntryMult: avgEntry / open,
    exitType,
    exitPrice,
    exitMult: exitPrice / open,
    exitDate: exitIndex != null && candles[exitIndex] ? isoDate(candles[exitIndex][0]) : null,
    holdDays: exitIndex,
    pnl,
    pnlPct: (pnl / cfg.capital) * 100,
    peakLoss: peakLoss != null ? Math.min(peakLoss, 0) : null,
    maxHighMult: maxHigh != null ? maxHigh / open : null,
  };
};

export const runLadder = (markers, cfg = DEFAULT_LADDER) =>
  (markers || []).map(marker => simulateLadder(marker, cfg));

export const summarizeLadder = (rows, cfg = DEFAULT_LADDER) => {
  const traded = rows.filter(row => row.filled > 0);
  const closed = traded.filter(row => row.exitType !== 'open');
  const wins = closed.filter(row => row.pnl > 0);
  const pnl = traded.reduce((sum, row) => sum + row.pnl, 0);
  const losses = closed.filter(row => row.pnl <= 0);
  const grossWin = wins.reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = losses.reduce((sum, row) => sum + row.pnl, 0);
  const peakLosses = traded.map(row => row.peakLoss).filter(v => Number.isFinite(v));

  return {
    total: rows.length,
    traded: traded.length,
    untriggered: rows.length - traded.length,
    closed: closed.length,
    open: traded.length - closed.length,
    target: traded.filter(row => row.exitType === 'target').length,
    stop: traded.filter(row => row.exitType === 'stop').length,
    newHigh: traded.filter(row => row.exitType === 'newHigh').length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    pnl,
    pnlPct: (pnl / cfg.capital) * 100,
    avgPnl: traded.length ? pnl / traded.length : null,
    worst: closed.length ? Math.min(...closed.map(row => row.pnl)) : null,
    best: closed.length ? Math.max(...closed.map(row => row.pnl)) : null,
    profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null,
    peakLoss: peakLosses.length ? Math.min(...peakLosses) : null,
  };
};
