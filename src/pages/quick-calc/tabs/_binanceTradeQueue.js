/**
 * Binance 交易高优队列（暴100 + 横盘共用）：
 * - 下单前校验、挂撤单均入此队
 * - 入队即占用高优名额 → shouldThrottleBinanceBackground 让路过期补 K / 补 H
 * - 同 key 去重：合并 waiter，执行最新 run；enqueuedAt 保持首次入队时刻
 * - 双通道并行：
 *   · OPEN 道：仅 SURGE_OPEN（暴涨开仓），不与横盘/出场互相堵
 *   · OTHER 道：EXIT + RANGE
 * - OTHER 道内优先级：EXIT > RANGE（同优先 FIFO）
 */
import {
  acquireBinanceHighPriority,
  releaseBinanceHighPriority,
  getBinanceHighPriorityDepth,
} from './_marketFetchGate';

/** 数字越大越先跑（仅 OTHER 道内比较；OPEN 道独立泵）。 */
export const TRADE_JOB_PRIORITY = {
  SURGE_OPEN: 100,
  EXIT: 80,
  RANGE: 10,
};

const priorityOfKey = key => {
  const k = String(key || '').toUpperCase();
  if (k.startsWith('SURGE_OPEN:')) return TRADE_JOB_PRIORITY.SURGE_OPEN;
  if (k.startsWith('SURGE_EXIT:') || k.startsWith('RANGE_EXIT:')) {
    return TRADE_JOB_PRIORITY.EXIT;
  }
  if (k.startsWith('RANGE:')) return TRADE_JOB_PRIORITY.RANGE;
  return TRADE_JOB_PRIORITY.RANGE;
};

const isOpenLaneKey = key => String(key || '').toUpperCase().startsWith('SURGE_OPEN:');

/**
 * @typedef {{
 *   key: string,
 *   priority: number,
 *   enqueuedAt: number,
 *   run: (meta: { key: string, enqueuedAt: number }) => Promise<any>,
 *   waiters: Array<{ resolve: Function, reject: Function }>,
 * }} TradeJob
 */

/** @type {TradeJob[]} */
const pendingOpen = [];
/** @type {TradeJob[]} */
const pendingOther = [];
let pumpingOpen = false;
let pumpingOther = false;
let currentOpenKey = '';
let currentOtherKey = '';

const laneOf = key => (isOpenLaneKey(key) ? pendingOpen : pendingOther);

export const getBinanceTradeQueueDepth = () =>
  pendingOpen.length +
  pendingOther.length +
  (pumpingOpen ? 1 : 0) +
  (pumpingOther ? 1 : 0);

export const getBinanceTradeQueueSnapshot = () => {
  const headKeys = [...pendingOpen, ...pendingOther]
    .slice()
    .sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    .slice(0, 5)
    .map(j => j.key);
  const running = [currentOpenKey, currentOtherKey].filter(Boolean);
  return {
    depth: getBinanceTradeQueueDepth(),
    pending: pendingOpen.length + pendingOther.length,
    pendingOpen: pendingOpen.length,
    pendingOther: pendingOther.length,
    pumping: pumpingOpen || pumpingOther,
    pumpingOpen,
    pumpingOther,
    currentJobKey: running.join(' + ') || '',
    highPriorityDepth: getBinanceHighPriorityDepth(),
    headKeys,
  };
};

export const hasBinanceTradeQueueWork = () =>
  pendingOpen.length > 0 ||
  pendingOther.length > 0 ||
  pumpingOpen ||
  pumpingOther ||
  getBinanceHighPriorityDepth() > 0;

/** @param {TradeJob[]} lane */
const pickNextJob = lane => {
  if (!lane.length) return null;
  let bestIdx = 0;
  for (let i = 1; i < lane.length; i += 1) {
    const a = lane[i];
    const b = lane[bestIdx];
    if (a.priority > b.priority || (a.priority === b.priority && a.enqueuedAt < b.enqueuedAt)) {
      bestIdx = i;
    }
  }
  return lane.splice(bestIdx, 1)[0];
};

/**
 * @param {string} key 去重键：SURGE_OPEN: / SURGE_EXIT: / RANGE: / RANGE_EXIT:
 * @param {(meta: { key: string, enqueuedAt: number }) => Promise<any>} run
 * @param {{ priority?: number }} [opts]
 * @returns {Promise<any>}
 */
export const enqueueBinanceTradeJob = (key, run, opts = {}) => {
  const jobKey = String(key || '').toUpperCase();
  if (!jobKey || typeof run !== 'function') {
    return Promise.reject(new Error('binance trade job invalid'));
  }
  const priority =
    Number.isFinite(Number(opts.priority)) && Number(opts.priority) > 0
      ? Number(opts.priority)
      : priorityOfKey(jobKey);
  const lane = laneOf(jobKey);

  return new Promise((resolve, reject) => {
    const existing = lane.find(j => j.key === jobKey);
    if (existing) {
      // 只换 run / 抬优先；enqueuedAt 保持首次入队，避免「入队+Ns」被行情重入刷歪
      existing.run = run;
      existing.priority = Math.max(existing.priority, priority);
      existing.waiters.push({ resolve, reject });
      return;
    }

    acquireBinanceHighPriority();
    lane.push({
      key: jobKey,
      priority,
      enqueuedAt: Date.now(),
      run,
      waiters: [{ resolve, reject }],
    });
    if (isOpenLaneKey(jobKey)) pumpOpen();
    else pumpOther();
  });
};

const runJob = async job => {
  let result;
  let err;
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

const pumpOpen = async () => {
  if (pumpingOpen) return;
  pumpingOpen = true;
  try {
    while (pendingOpen.length) {
      const job = pickNextJob(pendingOpen);
      if (!job) break;
      currentOpenKey = job.key;
      try {
        await runJob(job);
      } finally {
        currentOpenKey = '';
      }
    }
  } finally {
    pumpingOpen = false;
    currentOpenKey = '';
    if (pendingOpen.length) pumpOpen();
  }
};

const pumpOther = async () => {
  if (pumpingOther) return;
  pumpingOther = true;
  try {
    while (pendingOther.length) {
      const job = pickNextJob(pendingOther);
      if (!job) break;
      currentOtherKey = job.key;
      try {
        await runJob(job);
      } finally {
        currentOtherKey = '';
      }
    }
  } finally {
    pumpingOther = false;
    currentOtherKey = '';
    if (pendingOther.length) pumpOther();
  }
};

/** @deprecated 兼容旧名 */
export const enqueueSurgeOrderJob = enqueueBinanceTradeJob;
export const getSurgeOrderQueueDepth = getBinanceTradeQueueDepth;
export const hasSurgeOrderQueueWork = hasBinanceTradeQueueWork;
