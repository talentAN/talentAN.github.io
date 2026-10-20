/**
 * Binance REST 任务队列（暴涨 + 横盘最终统一入口）。
 *
 * ── 优先级表（数字越大越先跑；同级按入队先后 FIFO）──────────────
 *   DAY_K_COLD     2000  共用冷建 lookback 日 K ← 已迁入（最高）
 *   SURGE_OPEN     1000  暴涨开仓（校验 + 下单）← 已迁入
 *   SURGE_EXIT      900  暴涨空头出场挂撤 ← 已迁入
 *   DAY_K_OVERDUE   850  补K入队后墙钟≥45s 仍未清
 *   RANGE_EXIT      800  横盘出场止盈/止损/追踪 ← 已迁入
 *   RANGE_OPEN      200  横盘近带开仓 / 清理撤单 ← 已迁入（低于 EXIT，不同权）
 *   DAY_K_EXPIRE     50  过期补 K（today / lookback）← 已迁入
 *   DEFAULT          10  未归类 REST 兜底 ← 已迁入（交易队 OTHER 转发）
 *
 * 规则：
 * - 单泵按优先级串行；执行中 acquireBinanceHighPriority，挡背景补 K
 * - 同 key 去重：合并 waiter，换最新 run，抬高 priority，保留首次 enqueuedAt
 * - 入队不占高优，避免积压饿死低优先 REST
 * - 冷建最高：切日/启动冷建若与交易同窗，先排空 DAY_K_COLD
 */

import {
  acquireBinanceHighPriority,
  releaseBinanceHighPriority,
  getBinanceHighPriorityDepth,
} from './_marketFetchGate';

/** @typedef {keyof typeof BINANCE_REST_PRIORITY} BinanceRestPriorityName */

/**
 * 全局 REST 优先级（越大越先）。
 * 新增任务类型时先改此表，再挂 enqueue。
 */
export const BINANCE_REST_PRIORITY = Object.freeze({
  /** 共用冷建 200 日 K（最高：挡住开仓/出场） */
  DAY_K_COLD: 2000,
  /** 暴涨开仓：校验 + 阶梯空单 */
  SURGE_OPEN: 1000,
  /** 暴涨空头出场（止盈/追踪等） */
  SURGE_EXIT: 900,
  /** 补K入队≥45s 未清（低于 SURGE_EXIT，高于 RANGE_EXIT） */
  DAY_K_OVERDUE: 850,
  /** 横盘持仓出场（止盈/止损/追踪） */
  RANGE_EXIT: 800,
  /** 横盘近带开仓 / 开多清理（低于 RANGE_EXIT，不同权） */
  RANGE_OPEN: 200,
  /** 过期补日 K（today / lookback） */
  DAY_K_EXPIRE: 50,
  /** 未归类 REST 兜底 */
  DEFAULT: 10,
});

/**
 * 由 job key 推断优先级（可被 opts.priority 覆盖）。
 * @param {string} key
 */
export const restPriorityOfKey = key => {
  const k = String(key || '').toUpperCase();
  if (k.startsWith('DAY_K_COLD:') || k.startsWith('COLD:')) {
    return BINANCE_REST_PRIORITY.DAY_K_COLD;
  }
  if (k.startsWith('SURGE_OPEN:')) return BINANCE_REST_PRIORITY.SURGE_OPEN;
  if (k.startsWith('SURGE_EXIT:')) return BINANCE_REST_PRIORITY.SURGE_EXIT;
  if (k.startsWith('DAY_K_OVERDUE:') || k.startsWith('EXPIRE_HOT:')) {
    return BINANCE_REST_PRIORITY.DAY_K_OVERDUE;
  }
  if (k.startsWith('RANGE_EXIT:')) return BINANCE_REST_PRIORITY.RANGE_EXIT;
  if (k.startsWith('RANGE:')) return BINANCE_REST_PRIORITY.RANGE_OPEN;
  if (k.startsWith('DAY_K:') || k.startsWith('EXPIRE:')) {
    return BINANCE_REST_PRIORITY.DAY_K_EXPIRE;
  }
  return BINANCE_REST_PRIORITY.DEFAULT;
};

/**
 * @typedef {{
 *   key: string,
 *   priority: number,
 *   enqueuedAt: number,
 *   run: (meta: { key: string, enqueuedAt: number }) => Promise<any>,
 *   waiters: Array<{ resolve: Function, reject: Function }>,
 * }} RestJob
 */

/** @type {RestJob[]} */
const pending = [];
let pumping = false;
let currentKey = '';

const pickNextJob = () => {
  if (!pending.length) return null;
  let bestIdx = 0;
  for (let i = 1; i < pending.length; i += 1) {
    const a = pending[i];
    const b = pending[bestIdx];
    if (
      a.priority > b.priority ||
      (a.priority === b.priority && a.enqueuedAt < b.enqueuedAt)
    ) {
      bestIdx = i;
    }
  }
  return pending.splice(bestIdx, 1)[0];
};

export const getBinanceRestQueueDepth = () =>
  pending.length + (pumping ? 1 : 0);

export const getBinanceRestQueueSnapshot = () => {
  const headKeys = pending
    .slice()
    .sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    .slice(0, 5)
    .map(j => j.key);
  return {
    depth: getBinanceRestQueueDepth(),
    pending: pending.length,
    pumping,
    currentJobKey: currentKey || '',
    highPriorityDepth: getBinanceHighPriorityDepth(),
    headKeys,
  };
};

export const hasBinanceRestQueueWork = () =>
  pending.length > 0 || pumping || getBinanceHighPriorityDepth() > 0;

/**
 * @param {string} key 去重键，如 SURGE_OPEN:BTCUSDT
 * @param {(meta: { key: string, enqueuedAt: number }) => Promise<any>} run
 * @param {{ priority?: number }} [opts]
 * @returns {Promise<any>}
 */
export const enqueueBinanceRestJob = (key, run, opts = {}) => {
  const jobKey = String(key || '').toUpperCase();
  if (!jobKey || typeof run !== 'function') {
    return Promise.reject(new Error('binance rest job invalid'));
  }
  const priority =
    Number.isFinite(Number(opts.priority)) && Number(opts.priority) > 0
      ? Number(opts.priority)
      : restPriorityOfKey(jobKey);

  return new Promise((resolve, reject) => {
    const existing = pending.find(j => j.key === jobKey);
    if (existing) {
      existing.run = run;
      existing.priority = Math.max(existing.priority, priority);
      existing.waiters.push({ resolve, reject });
      return;
    }

    pending.push({
      key: jobKey,
      priority,
      enqueuedAt: Date.now(),
      run,
      waiters: [{ resolve, reject }],
    });
    pump();
  });
};

/** 仅抬升已在 pending 的同 key 优先级（不改 run、不加 waiter） */
export const bumpBinanceRestJobPriority = (key, priority) => {
  const jobKey = String(key || '').toUpperCase();
  const p = Number(priority);
  if (!jobKey || !(p > 0)) return false;
  const existing = pending.find(j => j.key === jobKey);
  if (!existing) return false;
  existing.priority = Math.max(existing.priority, p);
  return true;
};

/**
 * 从 pending 移除同 key（含 DAY_K_OVERDUE 抬权后的 DAY_K:SYM）。
 * 已在跑的当前 job 无法中止 HTTP，仅清排队。
 * @returns {boolean} 是否移除了 pending 项
 */
export const cancelBinanceRestJob = key => {
  const jobKey = String(key || '').toUpperCase();
  if (!jobKey) return false;
  const idx = pending.findIndex(j => j.key === jobKey);
  if (idx < 0) return false;
  const [job] = pending.splice(idx, 1);
  job.waiters.forEach(w => w.resolve({ cancelled: true }));
  return true;
};

const runJob = async job => {
  let result;
  let err;
  acquireBinanceHighPriority();
  try {
    result = await job.run({ key: job.key, enqueuedAt: job.enqueuedAt });
  } catch (e) {
    err = e;
  } finally {
    releaseBinanceHighPriority();
  }
  if (err) job.waiters.forEach(w => w.reject(err));
  else job.waiters.forEach(w => w.resolve(result));
};

const pump = async () => {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.length) {
      const job = pickNextJob();
      if (!job) break;
      currentKey = job.key;
      try {
        await runJob(job);
      } finally {
        currentKey = '';
      }
    }
  } finally {
    pumping = false;
    currentKey = '';
    if (pending.length) pump();
  }
};
