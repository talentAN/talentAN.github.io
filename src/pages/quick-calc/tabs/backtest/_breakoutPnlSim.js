import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';

/** 每笔名义本金（USDT），1 倍杠杆 */
export const PNL_NOTIONAL_USDT = 10;
export const PNL_LEVERAGE = 1;
/** 持仓满该交易日数仍有余仓 → 第 N 日收盘强平 */
export const PNL_MAX_HOLD_DAYS = 30;
/** 兼容旧默认：追踪回撤 */
export const PNL_TRAIL_CALLBACK = 0.15;
export const PNL_DEFAULT_INTERVAL = '5m';
export const PNL_DEFAULT_EXECUTION_MODE = 'conservative';
/** 兼容旧默认：单档平仓占开仓量比例 */
export const PNL_PARTIAL_FRAC = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const BITGET_MAX_SPAN_MS = 90 * DAY_MS;
const INTRADAY_PAGE_LIMIT = 200;
const SUPPORTED_INTRADAY_INTERVALS = new Set(['5m', '1m']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const finite = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeBars = candles =>
  (candles || [])
    .map(row => {
      if (!Array.isArray(row) || row.length < 5) return null;
      const openTime = Number(row[0]);
      const open = finite(row[1]);
      const high = finite(row[2]);
      const low = finite(row[3]);
      const close = finite(row[4]);
      if (!Number.isFinite(openTime) || !(high > 0) || !(low > 0) || !(close > 0)) return null;
      return {
        openTime,
        open,
        high,
        low,
        close,
        date: new Date(openTime).toISOString().slice(0, 10),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);

const markerStartMs = row => {
  const markerTs = Number(row.markerTs);
  if (Number.isFinite(markerTs)) return markerTs;
  return moment.utc(row.markerDate, 'YYYY-MM-DD').startOf('day').valueOf();
};

/**
 * 拉取标记日（含）起最多 maxDays+2 根日 K，供收益回测。
 * Bitget 跨度分段，避免 >90 天 400。
 */
export const fetchForwardDailyBars = async (row, maxDays = PNL_MAX_HOLD_DAYS) => {
  const startTime = markerStartMs(row);
  const endTime = startTime + (maxDays + 2) * DAY_MS;
  const exchange = row.exchange;

  if (exchange !== 'bitget') {
    const res = await getFutureKlineData(
      {
        symbol: row.symbol,
        granularity: '1Dutc',
        limit: maxDays + 5,
        startTime,
        endTime,
      },
      exchange
    );
    return normalizeBars(res?.data);
  }

  const byTs = new Map();
  let chunkEnd = endTime;
  while (chunkEnd > startTime) {
    const chunkStart = Math.max(startTime, chunkEnd - BITGET_MAX_SPAN_MS + 1);
    const res = await getFutureKlineData(
      {
        symbol: row.symbol,
        granularity: '1Dutc',
        limit: 100,
        startTime: chunkStart,
        endTime: chunkEnd,
      },
      'bitget'
    );
    const chunk = Array.isArray(res?.data) ? res.data : [];
    chunk.forEach(c => byTs.set(Number(c[0]), c));
    if (!chunk.length || chunkStart <= startTime) break;
    chunkEnd = chunkStart - 1;
    await sleep(40);
  }
  return normalizeBars([...byTs.values()]);
};

/** 拉取标记日起 maxDays 日内的细粒度 K 线，支持 5m 批量回测和 1m 复核。 */
export const fetchForwardIntradayBars = async (
  row,
  interval = PNL_DEFAULT_INTERVAL,
  maxDays = PNL_MAX_HOLD_DAYS
) => {
  if (!SUPPORTED_INTRADAY_INTERVALS.has(interval)) throw new Error(`不支持的回测粒度：${interval}`);
  const startTime = markerStartMs(row);
  const endTime = startTime + maxDays * DAY_MS + DAY_MS;
  const stepMs = Number(interval.slice(0, -1)) * MINUTE_MS;
  const byTs = new Map();
  const ingest = raw => (Array.isArray(raw) ? raw : []).forEach(c => byTs.set(Number(c[0]), c));
  const chunkMs = Math.min(BITGET_MAX_SPAN_MS, (INTRADAY_PAGE_LIMIT - 1) * stepMs);

  let t0 = startTime;
  while (t0 < endTime) {
    const t1 = Math.min(endTime, t0 + chunkMs);
    const res = await getFutureKlineData(
      { symbol: row.symbol, granularity: interval, limit: INTRADAY_PAGE_LIMIT, startTime: t0, endTime: t1 },
      row.exchange
    );
    ingest(res?.data);
    if (t1 >= endTime) break;
    t0 = t1 + 1;
    await sleep(interval === '1m' ? 80 : 40);
  }
  return normalizeBars([...byTs.values()]);
};

/** 兼容外部调用方，旧名称仍使用默认 5m 粒度。 */
export const fetchForwardHourlyBars = (row, maxDays = PNL_MAX_HOLD_DAYS) =>
  fetchForwardIntradayBars(row, PNL_DEFAULT_INTERVAL, maxDays);

/**
 * 归一化一组回测参数（UI 百分比 → 内部小数）。
 * 止盈 closeFrac = 占开仓总量比例（非剩余仓）。
 * slArmGain>0 时启用：涨幅达 slArmGain 后，全仓止损价 = entry×(1+slPriceGain)
 * trailArmGain>0 且 trailCallback>0 时启用追踪。
 */
export const normalizePnlPlan = (raw = {}) => {
  const tp1Gain = finite(raw.tp1Gain ?? raw.tp1);
  const tp2Gain = finite(raw.tp2Gain ?? raw.tp2);
  const tp3Gain = finite(raw.tp3Gain ?? raw.tp3);
  const tp1Close = finite(raw.tp1Close) ?? PNL_PARTIAL_FRAC * 100;
  const tp2Close = finite(raw.tp2Close) ?? PNL_PARTIAL_FRAC * 100;
  const tp3Close = finite(raw.tp3Close) ?? PNL_PARTIAL_FRAC * 100;
  const slArm = finite(raw.slArm);
  const slPrice = finite(raw.slPrice);
  const trailArm = finite(raw.trailArm);
  const trailCb = finite(raw.trailCb) ?? PNL_TRAIL_CALLBACK * 100;

  return {
    id: raw.id,
    tp1Gain,
    tp1Close,
    tp2Gain,
    tp2Close,
    tp3Gain,
    tp3Close,
    slArm,
    slPrice,
    trailArm,
    trailCb,
    tps: [
      { gain: (tp1Gain ?? 0) / 100, close: (tp1Close ?? 0) / 100 },
      { gain: (tp2Gain ?? 0) / 100, close: (tp2Close ?? 0) / 100 },
      { gain: (tp3Gain ?? 0) / 100, close: (tp3Close ?? 0) / 100 },
    ],
    slArmGain: slArm != null && slArm > 0 ? slArm / 100 : null,
    slPriceGain: slPrice != null && Number.isFinite(slPrice) ? slPrice / 100 : null,
    trailArmGain: trailArm != null && trailArm > 0 ? trailArm / 100 : null,
    trailCallback: trailCb != null && trailCb > 0 ? trailCb / 100 : null,
  };
};

export const isValidPnlPlan = plan => {
  const p = plan?.tps ? plan : normalizePnlPlan(plan);
  const [a, b, c] = p.tps || [];
  if (!a || !b || !c) return false;
  if (!(a.gain > 0) || !(b.gain > a.gain) || !(c.gain > b.gain)) return false;
  if (!(a.close > 0) || !(b.close > 0) || !(c.close > 0)) return false;
  if (p.slArmGain != null && p.slPriceGain == null) return false;
  if (p.trailArmGain != null && !(p.trailCallback > 0)) return false;
  return true;
};

const hourLabel = bar => {
  if (!bar) return '';
  const d = new Date(bar.openTime);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${bar.date} ${hh}:00Z`;
};

/**
 * 单笔上破开多模拟：
 * - 入场：标记日，价 = 区间上沿，名义 10U，1x
 * - 三档 / 全仓止损：按日 K
 * - 追踪武装后：按小时 K 更新峰值并判定回撤平仓
 * - 满 30 个交易日仍有余仓 → 第 30 日收盘价强平
 *
 * @param {object} row
 * @param {object|number[]} planOrGains
 * @param {Array} forwardDailyBars
 * @param {Array} [forwardHourlyBars]
 */
export const simulateBreakoutLongTrade = (
  row,
  planOrGains,
  forwardDailyBars,
  forwardIntradayBars = [],
  options = {}
) => {
  let plan;
  if (Array.isArray(planOrGains)) {
    plan = normalizePnlPlan({
      tp1Gain: planOrGains[0] * 100,
      tp2Gain: planOrGains[1] * 100,
      tp3Gain: planOrGains[2] * 100,
      tp1Close: PNL_PARTIAL_FRAC * 100,
      tp2Close: PNL_PARTIAL_FRAC * 100,
      tp3Close: PNL_PARTIAL_FRAC * 100,
      trailArm: planOrGains[2] * 100,
      trailCb: PNL_TRAIL_CALLBACK * 100,
    });
  } else {
    plan = normalizePnlPlan(planOrGains || {});
  }

  const entry = Number(row.rangeHigh);
  if (!(entry > 0) || !isValidPnlPlan(plan)) {
    return { ok: false, reason: 'invalid_params' };
  }
  if (row.breakDir !== 'up') {
    return { ok: false, reason: 'not_up_break' };
  }

  const bars = (forwardDailyBars || []).filter(b => !row.markerDate || b.date >= row.markerDate);
  if (!bars.length) return { ok: false, reason: 'no_bars' };

  const executionMode = options.executionMode || PNL_DEFAULT_EXECUTION_MODE;
  const intraday = (forwardIntradayBars || [])
    .filter(h => {
      if (!Number.isFinite(h.openTime)) return false;
      if (row.markerTs != null && Number.isFinite(Number(row.markerTs))) return h.openTime >= Number(row.markerTs);
      if (row.markerDate) return h.date >= row.markerDate;
      return true;
    })
    .sort((a, b) => a.openTime - b.openTime);
  const ambiguousBars = [];
  const useIntradayBars = intraday.length > 0;
  if (options.requireIntraday && !useIntradayBars) return { ok: false, reason: 'no_intraday_bars' };

  const qty0 = (PNL_NOTIONAL_USDT * PNL_LEVERAGE) / entry;
  let remaining = qty0;
  let peakAfterTrail = entry;
  let trailOn = false;
  let slOn = false;
  let tpIdx = 0;
  let intradayCursor = 0;
  const closes = [];
  let openCount = 1;
  let closeCount = 0;
  let pnl = 0;

  const takePartial = (price, fracOfOriginal, reason, date) => {
    const size = Math.min(remaining, qty0 * fracOfOriginal);
    if (!(size > 0) || !(price > 0)) return;
    const legPnl = size * (price - entry);
    pnl += legPnl;
    remaining -= size;
    closeCount += 1;
    closes.push({ date, price, size, pnl: legPnl, reason });
  };

  const takeRest = (price, reason, date) => {
    if (!(remaining > 0) || !(price > 0)) return;
    const legPnl = remaining * (price - entry);
    pnl += legPnl;
    closeCount += 1;
    closes.push({ date, price, size: remaining, pnl: legPnl, reason });
    remaining = 0;
  };

  const processIntradayBar = bar => {
    if (remaining <= 0) return;
    const targets = plan.tps.filter((_, index) => index >= tpIdx).map(leg => entry * (1 + leg.gain));
    const hitTp = targets.findIndex(target => bar.high >= target);
    const slPrice = slOn && plan.slPriceGain != null ? entry * (1 + plan.slPriceGain) : null;
    const trailPrice = trailOn && plan.trailCallback > 0 ? peakAfterTrail * (1 - plan.trailCallback) : null;
    const hitSl = slPrice != null && bar.low <= slPrice;
    const hitTrail = trailPrice != null && bar.low <= trailPrice;
    const hasAmbiguity = (hitSl || hitTrail) && hitTp >= 0;
    if (hasAmbiguity) ambiguousBars.push({ date: hourLabel(bar), sl: hitSl, trail: hitTrail, tp: hitTp + 1 });

    // 多头保守口径：同一根 K 线同时命中时，先按低点方向的出场处理。
    if (executionMode === 'conservative' && (hitSl || hitTrail)) {
      if (hitSl) takeRest(slPrice, 'sl', hourLabel(bar));
      else takeRest(trailPrice, 'trail', hourLabel(bar));
      return;
    }
    if (executionMode === 'optimistic' && hitTp >= 0) {
      const leg = plan.tps[tpIdx + hitTp];
      takePartial(targets[hitTp], leg.close, `tp${tpIdx + hitTp + 1}`, hourLabel(bar));
      tpIdx += hitTp + 1;
      if (remaining <= 1e-12) {
        remaining = 0;
        return;
      }
    }
    if (hitSl || hitTrail) {
      if (hitSl) takeRest(slPrice, 'sl', hourLabel(bar));
      else takeRest(trailPrice, 'trail', hourLabel(bar));
      return;
    } 
    if (hitTp >= 0 && remaining > 0) {
      const leg = plan.tps[tpIdx];
      takePartial(targets[0], leg.close, `tp${tpIdx + 1}`, hourLabel(bar));
      tpIdx += 1;
    }

    if (remaining > 0 && plan.slArmGain != null && plan.slPriceGain != null && bar.high >= entry * (1 + plan.slArmGain)) {
      slOn = true;
    }
    if (remaining > 0 && !trailOn && plan.trailArmGain != null && plan.trailCallback != null && bar.high >= entry * (1 + plan.trailArmGain)) {
      trailOn = true;
      peakAfterTrail = Math.max(peakAfterTrail, bar.high);
    } else if (remaining > 0 && trailOn) {
      peakAfterTrail = Math.max(peakAfterTrail, bar.high);
    }
  };

  const holdBars = bars.slice(0, PNL_MAX_HOLD_DAYS);
  for (let i = 0; i < holdBars.length && remaining > 0; i++) {
    const bar = holdBars[i];
    const nextDayOpen = holdBars[i + 1]?.openTime ?? bar.openTime + DAY_MS;
    if (useIntradayBars) {
      while (intradayCursor < intraday.length && intraday[intradayCursor].openTime < nextDayOpen) {
        processIntradayBar(intraday[intradayCursor]);
        intradayCursor += 1;
        if (remaining <= 0) break;
      }
    } else {
      processIntradayBar(bar);
    }
    if (remaining > 0 && i + 1 >= PNL_MAX_HOLD_DAYS) takeRest(bar.close, 'timeout', bar.date);
  }

  if (remaining > 0 && holdBars.length) {
    const last = holdBars[Math.min(holdBars.length, PNL_MAX_HOLD_DAYS) - 1];
    takeRest(last.close, holdBars.length >= PNL_MAX_HOLD_DAYS ? 'timeout' : 'incomplete', last.date);
  }

  return {
    ok: true,
    symbol: row.symbol,
    exchange: row.exchange,
    markerDate: row.markerDate,
    entry,
    qty0,
    openCount,
    closeCount,
    pnl,
    closes,
    holdDays: Math.min(holdBars.length, PNL_MAX_HOLD_DAYS),
    dataInterval: options.dataInterval || (useIntradayBars ? PNL_DEFAULT_INTERVAL : 'daily'),
    executionMode,
    ambiguousBars: ambiguousBars.length,
    trailUsedHourly: false,
  };
};

/**
 * 对上破样本批量收益回测（单组）。
 */
export const runBreakoutPnlBacktest = async (rows, gainsPct, opts = {}) => {
  const multi = await runBreakoutPnlBacktestMulti(
    rows,
    [
      {
        id: 1,
        tp1Gain: gainsPct.tp1 ?? gainsPct.tp1Gain,
        tp2Gain: gainsPct.tp2 ?? gainsPct.tp2Gain,
        tp3Gain: gainsPct.tp3 ?? gainsPct.tp3Gain,
        tp1Close: gainsPct.tp1Close ?? PNL_PARTIAL_FRAC * 100,
        tp2Close: gainsPct.tp2Close ?? PNL_PARTIAL_FRAC * 100,
        tp3Close: gainsPct.tp3Close ?? PNL_PARTIAL_FRAC * 100,
        slArm: gainsPct.slArm,
        slPrice: gainsPct.slPrice,
        trailArm: gainsPct.trailArm ?? gainsPct.tp3 ?? gainsPct.tp3Gain,
        trailCb: gainsPct.trailCb ?? PNL_TRAIL_CALLBACK * 100,
      },
    ],
    opts
  );
  return multi.results[0] || null;
};

const emptyPnlAgg = () => ({
  openCount: 0,
  closeCount: 0,
  totalPnl: 0,
  traded: 0,
  failed: 0,
  details: [],
});

/**
 * 多组参数一次拉日 K + 细粒度 K、分别结算。
 */
export const runBreakoutPnlBacktestMulti = async (rows, paramSets, opts = {}) => {
  const { onProgress, signal, dataInterval = PNL_DEFAULT_INTERVAL, executionMode = PNL_DEFAULT_EXECUTION_MODE } = opts;
  const sets = (paramSets || [])
    .map((p, index) => normalizePnlPlan({ ...p, id: p.id ?? index + 1 }))
    .filter(isValidPnlPlan);

  const upRows = (rows || []).filter(r => r.breakDir === 'up' && Number(r.rangeHigh) > 0);
  const aggs = sets.map(p => ({
    params: p,
    ...emptyPnlAgg(),
    sampleUp: upRows.length,
  }));

  if (!sets.length) {
    return { results: [], sampleUp: upRows.length };
  }

  const anyTrail = sets.some(p => p.trailArmGain != null && p.trailCallback != null);

  for (let i = 0; i < upRows.length; i++) {
    if (signal?.aborted) break;
    const row = upRows[i];
    onProgress?.({ done: i, total: upRows.length, symbol: row.symbol });
    let dailyBars = null;
    let intradayBars = [];
    try {
      dailyBars = await fetchForwardDailyBars(row, PNL_MAX_HOLD_DAYS);
      if (anyTrail) {
        intradayBars = await fetchForwardIntradayBars(row, dataInterval, PNL_MAX_HOLD_DAYS);
      }
    } catch (e) {
      aggs.forEach(a => {
        a.failed += 1;
      });
      continue;
    }

    sets.forEach((p, si) => {
      const sim = simulateBreakoutLongTrade(row, p, dailyBars, intradayBars, {
        dataInterval,
        executionMode,
      });
      const agg = aggs[si];
      if (!sim.ok) {
        agg.failed += 1;
        return;
      }
      agg.openCount += sim.openCount;
      agg.closeCount += sim.closeCount;
      agg.totalPnl += sim.pnl;
      agg.traded += 1;
      agg.details.push(sim);
    });

    if (i % 8 === 7) await sleep(80);
  }

  onProgress?.({ done: upRows.length, total: upRows.length, symbol: '' });

  return {
    sampleUp: upRows.length,
    results: aggs.map(a => ({
      params: a.params,
      sampleUp: a.sampleUp,
      traded: a.traded,
      failed: a.failed,
      openCount: a.openCount,
      closeCount: a.closeCount,
      openCloseCount: a.openCount + a.closeCount,
      totalPnl: a.totalPnl,
      dataInterval,
      executionMode,
      ambiguousBars: a.details.reduce((sum, detail) => sum + (detail.ambiguousBars || 0), 0),
      avgPnlPerTrade: a.traded > 0 ? a.totalPnl / a.traded : null,
      details: a.details,
    })),
  };
};