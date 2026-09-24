/**
 * 低波动横盘暴涨 · v0.5
 *
 * 口径：
 * - 币对：Binance + Bitget 合并，同 symbol 保留 Binance
 * - K 线：UTC 日 K，仅用 ≥ startDate（默认 2022-01-01）
 * - 横盘区间 [start, end]：持续天数 > minDaysExclusive（默认 25，即至少 26 根），
 *   且区间内最高价 ≤ 区间内最低价 × maxRangeMult（默认 2）
 * - 同一起点取最长合法终点（区间越长越好）；同一标记日保留最长区间
 * - 标记日：区间结束后，首次 high > 上沿 或 low < 下沿 的交易日
 * - 成功：标记日之后 followDays（默认 30）根日 K 内，最高价 > 上沿 × successMult（默认 1.2，即相对上沿涨幅 > 20%）
 *   ——一旦达标即可提前记成功；未满窗口且尚未达标 → 待观察；窗口走完仍未达标 → 失败
 * - 分布：走出区间后 followDays 内最高价相对区间上沿的涨幅 (fwdHigh/rangeHigh - 1)
 */

export const LOW_VOL_RANGE_BLAST_V01 = {
  version: 'low-vol-range-blast-v0.5',
  label: '低波动横盘暴涨',
  defaultStartDate: '2022-01-01',
  /** 持续天数须严格大于该值 */
  minDaysExclusive: 25,
  maxRangeMult: 2,
  followDays: 30,
  /** 标记日后最高价须严格超过 上沿 × 该倍数 → 成功（1.2 = 相对上沿涨幅 > 20%） */
  successMult: 1.2,
  notePattern: /下沿\/上沿\/最高\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\s*[·•]\s*周期\s*(\d+)\s*天)?/,
};

export const parseLowVolRangeBlastNote = (note = '') => {
  const match = String(note).match(LOW_VOL_RANGE_BLAST_V01.notePattern);
  if (!match) {
    return { low: null, high: null, highPoint: null, periodDays: null };
  }
  return {
    low: Number(match[1]),
    high: Number(match[2]),
    highPoint: Number(match[3]),
    periodDays: match[4] ? Number(match[4]) : null,
  };
};

const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isoDate = timestamp => new Date(Number(timestamp)).toISOString().slice(0, 10);

const startDateToTs = dateStr => {
  if (!dateStr) return null;
  const ts = Date.parse(`${dateStr}T00:00:00.000Z`);
  return Number.isFinite(ts) ? ts : null;
};

/** Binance / Bitget 日 K 数组行 → { openTime, open, high, low, close } */
export const normalizeDailyBars = (candles, startTs = null) =>
  (candles || [])
    .map(row => {
      if (!Array.isArray(row) || row.length < 5) return null;
      const openTime = Number(row[0]);
      const open = finite(row[1]);
      const high = finite(row[2]);
      const low = finite(row[3]);
      const close = finite(row[4]);
      if (!Number.isFinite(openTime) || !(high > 0) || !(low > 0)) return null;
      if (startTs != null && openTime < startTs) return null;
      return { openTime, open, high, low, close, date: isoDate(openTime) };
    })
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);

/**
 * 扫描单币对：产出标记日样本（同一 markDate 只保留最长横盘区间）
 */
export const findLowVolRangeBlastMarkers = (candles, pair, rules = LOW_VOL_RANGE_BLAST_V01) => {
  const startTs = startDateToTs(rules.defaultStartDate) ?? Date.UTC(2022, 0, 1);
  const minExclusive = Number(rules.minDaysExclusive) || 25;
  const maxRangeMult = Number(rules.maxRangeMult) || 2;
  const followDays = Number(rules.followDays) || 30;
  const successMult = Number(rules.successMult) || 1.5;

  const bars = normalizeDailyBars(candles, startTs);
  if (bars.length <= minExclusive) return [];

  /** @type {Map<number, object>} markIdx → row */
  const bestByMark = new Map();

  for (let i = 0; i < bars.length; i++) {
    let minL = Infinity;
    let maxH = -Infinity;
    let bestJ = -1;

    for (let j = i; j < bars.length; j++) {
      minL = Math.min(minL, bars[j].low);
      maxH = Math.max(maxH, bars[j].high);
      if (!(minL > 0) || maxH > maxRangeMult * minL) break;
      if (j - i + 1 > minExclusive) bestJ = j;
    }
    if (bestJ < 0) continue;

    // 用 [i, bestJ] 重算边界（循环里最后一次 break 前的 min/max 可能已含失败日）
    minL = Infinity;
    maxH = -Infinity;
    for (let t = i; t <= bestJ; t++) {
      minL = Math.min(minL, bars[t].low);
      maxH = Math.max(maxH, bars[t].high);
    }

    let markIdx = -1;
    let breakDir = null;
    for (let k = bestJ + 1; k < bars.length; k++) {
      if (bars[k].high > maxH) {
        markIdx = k;
        breakDir = 'up';
        break;
      }
      if (bars[k].low < minL) {
        markIdx = k;
        breakDir = 'down';
        break;
      }
    }
    if (markIdx < 0) continue;

    const days = bestJ - i + 1;
    const prev = bestByMark.get(markIdx);
    if (prev && prev.days >= days) continue;

    const follow = bars.slice(markIdx + 1, markIdx + 1 + followDays);
    const highs = follow.map(b => b.high).filter(v => Number.isFinite(v));
    const fwdHigh = highs.length ? Math.max(...highs) : null;
    const complete = follow.length === followDays;
    const gainVsRangeHigh =
      fwdHigh != null && maxH > 0 ? fwdHigh / maxH - 1 : null;
    const hitSuccess = fwdHigh != null && fwdHigh > maxH * successMult;
    // 达标可提前成功；未满窗且未达标 → 待观察；满窗仍未达标 → 失败
    let status = 'pending';
    if (hitSuccess) status = 'success';
    else if (complete) status = 'failed';

    const rangeSpan = maxH - minL;
    const endClose = bars[bestJ].close;
    /** 区间末日收盘在盒子中的相对位置：0=下沿，1=上沿 */
    const preBreakPos =
      rangeSpan > 0 && Number.isFinite(endClose) ? (endClose - minL) / rangeSpan : null;

    const markBar = bars[markIdx];
    const markClose = markBar.close;
    /** 上破且收盘站上上沿 / 下破且收盘跌破下沿 */
    const closeConfirm =
      breakDir === 'up'
        ? markClose != null && markClose > maxH
        : breakDir === 'down'
          ? markClose != null && markClose < minL
          : false;
    /** 标记日收盘相对上沿（上破更有意义）：close/rangeHigh - 1 */
    const breakCloseVsHigh =
      markClose != null && maxH > 0 ? markClose / maxH - 1 : null;

    bestByMark.set(markIdx, {
      key: `${pair.exchange}:${pair.symbol}:${bars[markIdx].openTime}`,
      exchange: pair.exchange,
      symbol: pair.symbol,
      rangeFrom: bars[i].date,
      rangeTo: bars[bestJ].date,
      rangeFromTs: bars[i].openTime,
      rangeToTs: bars[bestJ].openTime,
      days,
      rangeLow: minL,
      rangeHigh: maxH,
      rangeMult: maxH / minL,
      markerDate: markBar.date,
      markerTs: markBar.openTime,
      breakDir,
      preBreakPos,
      closeConfirm,
      breakCloseVsHigh,
      markClose,
      followDays: follow.length,
      fwdHigh,
      gainVsRangeHigh,
      status,
    });
  }

  return [...bestByMark.values()];
};

/**
 * 实盘筛选：找「仍在横盘盒子里」的币对。
 * - 横盘口径同回测（天数 > minDaysExclusive，最高 ≤ 最低 × maxRangeMult，同起点取最长）
 * - 额外：区间终点须落在最近 recentDays 根日 K 内（默认 3）——即最近三天至少有一天仍属于该横盘
 * - 每币对只保留最长一条；不要求已突破
 */
export const findActiveLowVolRanges = (
  candles,
  pair,
  rules = LOW_VOL_RANGE_BLAST_V01,
  opts = {}
) => {
  const recentDays = Number(opts.recentDays) > 0 ? Number(opts.recentDays) : 3;
  const startTs = startDateToTs(rules.defaultStartDate) ?? Date.UTC(2022, 0, 1);
  const minExclusive = Number(rules.minDaysExclusive) || 25;
  const maxRangeMult = Number(rules.maxRangeMult) || 2;

  const bars = normalizeDailyBars(candles, startTs);
  if (bars.length <= minExclusive) return [];

  const recentStartIdx = Math.max(0, bars.length - recentDays);
  let best = null;

  for (let i = 0; i < bars.length; i++) {
    let minL = Infinity;
    let maxH = -Infinity;
    let bestJ = -1;

    for (let j = i; j < bars.length; j++) {
      minL = Math.min(minL, bars[j].low);
      maxH = Math.max(maxH, bars[j].high);
      if (!(minL > 0) || maxH > maxRangeMult * minL) break;
      if (j - i + 1 > minExclusive) bestJ = j;
    }
    if (bestJ < 0 || bestJ < recentStartIdx) continue;

    minL = Infinity;
    maxH = -Infinity;
    for (let t = i; t <= bestJ; t++) {
      minL = Math.min(minL, bars[t].low);
      maxH = Math.max(maxH, bars[t].high);
    }

    const days = bestJ - i + 1;
    if (best && best.days >= days) continue;

    const last = bars[bars.length - 1];
    const rangeSpan = maxH - minL;
    const lastClose = last?.close;
    const posInRange =
      rangeSpan > 0 && Number.isFinite(lastClose) ? (lastClose - minL) / rangeSpan : null;

    // 最近三天里有几天整根 K 都在盒子内
    let inBoxDays = 0;
    for (let k = recentStartIdx; k < bars.length; k++) {
      if (bars[k].high <= maxH && bars[k].low >= minL) inBoxDays += 1;
    }

    best = {
      key: `${pair.exchange}:${pair.symbol}:${bars[i].openTime}`,
      exchange: pair.exchange,
      symbol: pair.symbol,
      rangeFrom: bars[i].date,
      rangeTo: bars[bestJ].date,
      rangeFromTs: bars[i].openTime,
      rangeToTs: bars[bestJ].openTime,
      days,
      rangeLow: minL,
      rangeHigh: maxH,
      rangeMult: maxH / minL,
      lastDate: last?.date || '',
      lastClose,
      posInRange,
      inBoxDays,
      recentDays,
    };
  }

  return best ? [best] : [];
};

/** 走出区间后相对上沿涨幅分布（仅 complete 样本） */
export const FWD_GAIN_BUCKETS = [
  { key: 'lt0', label: '<0%', match: g => g < 0 },
  { key: 'b0_20', label: '0–20%', match: g => g >= 0 && g < 0.2 },
  { key: 'b20_50', label: '20–50%', match: g => g >= 0.2 && g < 0.5 },
  { key: 'b50_100', label: '50–100%', match: g => g >= 0.5 && g < 1 },
  { key: 'b100_200', label: '100–200%', match: g => g >= 1 && g < 2 },
  { key: 'b200_400', label: '200–400%', match: g => g >= 2 && g < 4 },
  { key: 'gte400', label: '≥400%', match: g => g >= 4 },
];

export const bucketFwdGainVsRangeHigh = rows => {
  const samples = (rows || []).filter(
    row => row.followDays === (LOW_VOL_RANGE_BLAST_V01.followDays || 30) && Number.isFinite(row.gainVsRangeHigh)
  );
  const total = samples.length;
  if (!total) {
    return { total: 0, buckets: FWD_GAIN_BUCKETS.map(b => ({ ...b, count: 0, pct: 0 })) };
  }
  const buckets = FWD_GAIN_BUCKETS.map(bucket => {
    const count = samples.filter(row => bucket.match(row.gainVsRangeHigh)).length;
    return { ...bucket, count, pct: (count / total) * 100 };
  });
  return { total, buckets };
};

export const summarizeLowVolRangeBlast = rows => {
  const list = rows || [];
  const completed = list.filter(row => row.status !== 'pending');
  const success = completed.filter(row => row.status === 'success').length;
  return {
    total: list.length,
    completed: completed.length,
    pending: list.length - completed.length,
    success,
    failed: completed.length - success,
    successRate: completed.length ? (success / completed.length) * 100 : null,
  };
};
