import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';

/** 每笔名义本金（USDT），1 倍杠杆 */
export const PNL_NOTIONAL_USDT = 10;
export const PNL_LEVERAGE = 1;
/** 持仓满该交易日数仍有余仓 → 第 N 日收盘强平 */
export const PNL_MAX_HOLD_DAYS = 30;
/** 兼容旧默认：追踪回撤 */
export const PNL_TRAIL_CALLBACK = 0.15;
/** 兼容旧默认：单档平仓占开仓量比例 */
export const PNL_PARTIAL_FRAC = 0.25;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BITGET_MAX_SPAN_MS = 90 * DAY_MS;
/** Bitget / 通用：单次小时 K 拉取条数 */
const HOURLY_PAGE_LIMIT = 200;
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

/**
 * 拉取标记日起 maxDays 日内的小时 K（追踪止盈用）。
 * Binance: 1H；Bitget: 1H，按时段分页。
 */
export const fetchForwardHourlyBars = async (row, maxDays = PNL_MAX_HOLD_DAYS) => {
  const startTime = markerStartMs(row);
  const endTime = startTime + maxDays * DAY_MS + DAY_MS;
  const exchange = row.exchange;
  const byTs = new Map();

  const ingest = raw => {
    (Array.isArray(raw) ? raw : []).forEach(c => byTs.set(Number(c[0]), c));
  };

  if (exchange !== 'bitget') {
    // Binance 单次可较大；仍按时段切，避免漏数
    const chunkMs = (HOURLY_PAGE_LIMIT - 1) * HOUR_MS;
    let t0 = startTime;
    while (t0 < endTime) {
      const t1 = Math.min(endTime, t0 + chunkMs);
      const res = await getFutureKlineData(
        {
          symbol: row.symbol,
          granularity: '1H',
          limit: HOURLY_PAGE_LIMIT,
          startTime: t0,
          endTime: t1,
        },
        exchange
      );
      ingest(res?.data);
      if (t1 >= endTime) break;
      t0 = t1 + 1;
      await sleep(40);
    }
    return normalizeBars([...byTs.values()]);
  }

  // Bitget：跨度 ≤90 天，且 limit 有限 → 按小时窗分页
  const chunkMs = Math.min(BITGET_MAX_SPAN_MS, (HOURLY_PAGE_LIMIT - 1) * HOUR_MS);
  let t0 = startTime;
  while (t0 < endTime) {
    const t1 = Math.min(endTime, t0 + chunkMs);
    const res = await getFutureKlineData(
      {
        symbol: row.symbol,
        granularity: '1H',
        limit: HOURLY_PAGE_LIMIT,
        startTime: t0,
        endTime: t1,
      },
      'bitget'
    );
    ingest(res?.data);
    if (t1 >= endTime) break;
    t0 = t1 + 1;
    await sleep(40);
  }
  return normalizeBars([...byTs.values()]);
};

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
  forwardHourlyBars = []
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

  const hours = (forwardHourlyBars || [])
    .filter(h => {
      if (!Number.isFinite(h.openTime)) return false;
      if (row.markerTs != null && Number.isFinite(Number(row.markerTs))) {
        return h.openTime >= Number(row.markerTs);
      }
      if (row.markerDate) return h.date >= row.markerDate;
      return true;
    })
    .sort((a, b) => a.openTime - b.openTime);

  const qty0 = (PNL_NOTIONAL_USDT * PNL_LEVERAGE) / entry;
  let remaining = qty0;
  let peakAfterTrail = entry;
  let trailOn = false;
  let slOn = false;
  let tpIdx = 0;
  let hourCursor = 0;
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

  /** 从 hourCursor 起，处理 openTime < untilOpenTime 的小时 K 上的追踪 */
  const runTrailOnHoursUntil = untilOpenTime => {
    if (!trailOn || !(plan.trailCallback > 0) || remaining <= 0) return;
    while (hourCursor < hours.length && hours[hourCursor].openTime < untilOpenTime) {
      const h = hours[hourCursor];
      hourCursor += 1;
      peakAfterTrail = Math.max(peakAfterTrail, h.high);
      const stop = peakAfterTrail * (1 - plan.trailCallback);
      if (h.low <= stop) {
        takeRest(stop, 'trail', hourLabel(h));
        return;
      }
    }
  };

  /** 无小时 K 时：用当日日 K 兜底判定追踪 */
  const runTrailOnDailyFallback = bar => {
    if (!trailOn || !(plan.trailCallback > 0) || remaining <= 0) return;
    peakAfterTrail = Math.max(peakAfterTrail, bar.high);
    const stop = peakAfterTrail * (1 - plan.trailCallback);
    if (bar.low <= stop) {
      takeRest(stop, 'trail', bar.date);
    }
  };

  const holdBars = bars.slice(0, PNL_MAX_HOLD_DAYS);
  const useHourlyTrail = hours.length > 0;

  for (let i = 0; i < holdBars.length; i++) {
    const bar = holdBars[i];
    const dayIndex = i + 1;
    const nextDayOpen = holdBars[i + 1]?.openTime ?? bar.openTime + DAY_MS;

    // 1) 分档止盈（日 K）
    while (tpIdx < plan.tps.length && remaining > 0) {
      const leg = plan.tps[tpIdx];
      const target = entry * (1 + leg.gain);
      if (bar.high < target) break;
      takePartial(target, leg.close, `tp${tpIdx + 1}`, bar.date);
      tpIdx += 1;
    }
    if (remaining <= 1e-12) {
      remaining = 0;
      break;
    }

    // 2) 武装止损（日 K）
    if (plan.slArmGain != null && plan.slPriceGain != null && bar.high >= entry * (1 + plan.slArmGain)) {
      slOn = true;
    }

    // 3) 武装追踪（日 K 达涨幅；真正平仓看小时 K）
    if (
      !trailOn &&
      plan.trailArmGain != null &&
      plan.trailCallback != null &&
      bar.high >= entry * (1 + plan.trailArmGain)
    ) {
      trailOn = true;
      const armLevel = entry * (1 + plan.trailArmGain);
      if (useHourlyTrail) {
        // 推进到当日，找到首根触及武装涨幅的小时 K，再从此根起跑追踪
        while (hourCursor < hours.length && hours[hourCursor].openTime < bar.openTime) {
          hourCursor += 1;
        }
        let armedHour = null;
        while (hourCursor < hours.length && hours[hourCursor].openTime < nextDayOpen) {
          const h = hours[hourCursor];
          if (h.high >= armLevel) {
            armedHour = h;
            peakAfterTrail = Math.max(peakAfterTrail, h.high);
            break;
          }
          hourCursor += 1;
        }
        if (armedHour) {
          // 从武装当根继续（含当根低点可能已打到追踪止损）
          const stop = peakAfterTrail * (1 - plan.trailCallback);
          if (armedHour.low <= stop) {
            takeRest(stop, 'trail', hourLabel(armedHour));
          } else {
            hourCursor += 1;
            runTrailOnHoursUntil(nextDayOpen);
          }
        } else {
          // 日 K 显示触及但小时未对齐：当日高点武装，用日 K 兜底
          peakAfterTrail = Math.max(peakAfterTrail, bar.high);
          runTrailOnDailyFallback(bar);
        }
      } else {
        peakAfterTrail = Math.max(peakAfterTrail, bar.high);
        runTrailOnDailyFallback(bar);
      }
    } else if (trailOn && remaining > 0) {
      if (useHourlyTrail) runTrailOnHoursUntil(nextDayOpen);
      else runTrailOnDailyFallback(bar);
    }

    if (remaining <= 1e-12) {
      remaining = 0;
      break;
    }

    // 4) 全仓止损（日 K）
    if (remaining > 0 && slOn && plan.slPriceGain != null) {
      const slPrice = entry * (1 + plan.slPriceGain);
      if (bar.low <= slPrice) {
        takeRest(slPrice, 'sl', bar.date);
        break;
      }
    }

    // 5) 满 30 日：第 30 根日 K 收盘价强平
    if (dayIndex >= PNL_MAX_HOLD_DAYS && remaining > 0) {
      takeRest(bar.close, 'timeout', bar.date);
      break;
    }
  }

  // 行情不足 30 日：最后一根收盘了结（样本未走完）
  if (remaining > 0 && holdBars.length) {
    if (holdBars.length >= PNL_MAX_HOLD_DAYS) {
      const day30 = holdBars[PNL_MAX_HOLD_DAYS - 1];
      takeRest(day30.close, 'timeout', day30.date);
    } else {
      const last = holdBars[holdBars.length - 1];
      takeRest(last.close, 'incomplete', last.date);
    }
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
    trailUsedHourly: useHourlyTrail,
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
 * 多组参数一次拉日 K + 小时 K、分别结算。
 */
export const runBreakoutPnlBacktestMulti = async (rows, paramSets, opts = {}) => {
  const { onProgress, signal } = opts;
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
    let hourlyBars = [];
    try {
      dailyBars = await fetchForwardDailyBars(row, PNL_MAX_HOLD_DAYS);
      if (anyTrail) {
        try {
          hourlyBars = await fetchForwardHourlyBars(row, PNL_MAX_HOLD_DAYS);
        } catch {
          hourlyBars = [];
        }
      }
    } catch (e) {
      aggs.forEach(a => {
        a.failed += 1;
      });
      continue;
    }

    sets.forEach((p, si) => {
      const sim = simulateBreakoutLongTrade(row, p, dailyBars, hourlyBars);
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
      avgPnlPerTrade: a.traded > 0 ? a.totalPnl / a.traded : null,
      details: a.details,
    })),
  };
};
