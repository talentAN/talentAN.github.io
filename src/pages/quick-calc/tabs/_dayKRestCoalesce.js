/**
 * 暴涨 / 横盘过期补 K 同币合并：
 * - 同 symbol：pending 微任务合并 need=max，再起飞 → 同 tick 双需求只打一枪
 * - 在途 today 时新来 lookback：本枪结束后再开 lookback（无法撤销已发出的 limit=1）
 * - lookback 回包写 range + dayTruth，覆盖暴涨 today 需求
 * - 实际 HTTP 经全局 REST 队 DAY_K_EXPIRE（低于开仓/出场/冷建）
 */

import {
  fetchSurgeDayCandle,
  writeSurgeDayFromCandle,
} from './system_1/_surgeDayCache';
import { fetchAndCacheMonitorCandles } from './low_vol_range_blast/_rangeMonitorCandleCache';
import { getTodayTruth } from '@root/src/container/market/dayTruth';
import {
  enqueueBinanceRestJob,
  bumpBinanceRestJobPriority,
  cancelBinanceRestJob,
  BINANCE_REST_PRIORITY,
} from './_binanceRestQueue';

/** @typedef {1|2} DayKNeed */

export const DAY_K_NEED = Object.freeze({
  TODAY: 1,
  LOOKBACK: 2,
});

const normNeed = need => {
  if (need === 'lookback' || need === DAY_K_NEED.LOOKBACK) return DAY_K_NEED.LOOKBACK;
  return DAY_K_NEED.TODAY;
};

/**
 * @typedef {{
 *   need: DayKNeed,
 *   waiters: Array<{ resolve: Function, reject: Function, need: DayKNeed }>,
 *   followUpWaiters: Array<{ resolve: Function, reject: Function, need: DayKNeed }>,
 *   priceFeed: object|null,
 *   exchange: string,
 *   restPriority: number,
 *   cancelled?: boolean,
 * }} JobEntry
 */

/** @type {Map<string, JobEntry>} 微任务合并窗口 */
const pending = new Map();
/** @type {Map<string, JobEntry>} HTTP 在途 */
const inflight = new Map();
/** @type {Set<string>} */
const scheduled = new Set();

const runFetchBody = async (key, need, { priceFeed, exchange }) => {
  const pair = { exchange: exchange || 'binance', symbol: key };
  if (need >= DAY_K_NEED.LOOKBACK) {
    const candles = await fetchAndCacheMonitorCandles(pair, priceFeed);
    return {
      ok: Boolean(candles),
      need: DAY_K_NEED.LOOKBACK,
      candles,
      today: getTodayTruth(key),
      via: 'lookback',
    };
  }
  const candle = await fetchSurgeDayCandle(key);
  if (candle) {
    writeSurgeDayFromCandle(pair, candle, priceFeed);
  }
  return {
    ok: Boolean(candle),
    need: DAY_K_NEED.TODAY,
    candle,
    today: getTodayTruth(key),
    via: 'today',
  };
};

/**
 * 过期补 K HTTP → REST 队。
 * 同 key `DAY_K:SYM`：后到的更高 priority 会抬升在途/排队任务（OVERDUE 可盖 EXPIRE）。
 */
const runFetch = (key, need, opts, priority = BINANCE_REST_PRIORITY.DAY_K_EXPIRE) =>
  enqueueBinanceRestJob(
    `DAY_K:${key}`,
    () => runFetchBody(key, need, opts),
    { priority }
  );

const settle = (waiters, result, err) => {
  (waiters || []).forEach(w => {
    if (err) w.reject(err);
    else w.resolve(result);
  });
};

const startInflight = key => {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  scheduled.delete(key);

  // 若同币已在飞（极窄竞态），并入在途逻辑
  const flying = inflight.get(key);
  if (flying) {
    entry.waiters.forEach(w => {
      if (w.need <= flying.need) flying.waiters.push(w);
      else flying.followUpWaiters.push(w);
    });
    if (entry.priceFeed) flying.priceFeed = entry.priceFeed;
    return;
  }

  inflight.set(key, entry);

  (async () => {
    let result;
    let err;
    try {
      result = await runFetch(
        key,
        entry.need,
        {
          priceFeed: entry.priceFeed,
          exchange: entry.exchange,
        },
        entry.restPriority || BINANCE_REST_PRIORITY.DAY_K_EXPIRE
      );
    } catch (e) {
      err = e;
    }

    const primary = entry.waiters.splice(0);
    const follow = entry.followUpWaiters.splice(0);
    const feed = entry.priceFeed;
    const ex = entry.exchange;
    inflight.delete(key);

    if (err) {
      settle(primary, null, err);
      settle(follow, null, err);
      return;
    }

    // WS 已 markFresh → cancel：不再跟 lookback
    if (entry.cancelled || result?.cancelled) {
      const cancelled = { ok: false, cancelled: true, need: entry.need };
      settle(primary, cancelled, null);
      settle(follow, cancelled, null);
      return;
    }

    settle(primary, result, null);

    follow.forEach(w => {
      requestDayKRest(key, {
        need: DAY_K_NEED.LOOKBACK,
        priceFeed: feed,
        exchange: ex,
      }).then(w.resolve, w.reject);
    });
  })();
};

/**
 * WS 推送 / markFresh：清 coalesce + 全局 REST 队 `DAY_K:SYM`（含 OVERDUE 抬权）。
 * 已开跑的 HTTP 无法中止，仅取消排队并标记 cancelled。
 */
export const cancelDayKRest = symbol => {
  const key = String(symbol || '').toUpperCase();
  if (!key) return false;
  let removed = cancelBinanceRestJob(`DAY_K:${key}`);

  const pendingJob = pending.get(key);
  if (pendingJob) {
    pending.delete(key);
    scheduled.delete(key);
    const cancelled = { ok: false, cancelled: true, need: pendingJob.need };
    settle(pendingJob.waiters.splice(0), cancelled, null);
    settle(pendingJob.followUpWaiters.splice(0), cancelled, null);
    removed = true;
  }

  const flying = inflight.get(key);
  if (flying) {
    flying.cancelled = true;
    removed = true;
  }
  return removed;
};

const scheduleStart = key => {
  if (scheduled.has(key)) return;
  scheduled.add(key);
  queueMicrotask(() => startInflight(key));
};

/**
 * @param {string} symbol
 * @param {{
 *   need?: DayKNeed|'today'|'lookback',
 *   priceFeed?: object,
 *   exchange?: string,
 *   restPriority?: number,
 * }} [opts]
 */
export const requestDayKRest = (symbol, opts = {}) => {
  const key = String(symbol || '').toUpperCase();
  if (!key) {
    return Promise.reject(new Error('requestDayKRest: empty symbol'));
  }
  const want = normNeed(opts.need);
  const exchange = opts.exchange || 'binance';
  const priceFeed = opts.priceFeed || null;
  const restPriority = Number.isFinite(Number(opts.restPriority))
    ? Number(opts.restPriority)
    : BINANCE_REST_PRIORITY.DAY_K_EXPIRE;

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, need: want };

    const flying = inflight.get(key);
    if (flying) {
      if (priceFeed) flying.priceFeed = priceFeed;
      flying.restPriority = Math.max(
        flying.restPriority || BINANCE_REST_PRIORITY.DAY_K_EXPIRE,
        restPriority
      );
      if (want <= flying.need) flying.waiters.push(waiter);
      else flying.followUpWaiters.push(waiter);
      // 已在飞且 REST 尚未开跑：抬同 key 优先级
      if (restPriority > BINANCE_REST_PRIORITY.DAY_K_EXPIRE) {
        bumpBinanceRestJobPriority(`DAY_K:${key}`, flying.restPriority);
      }
      return;
    }

    let job = pending.get(key);
    if (job) {
      job.need = Math.max(job.need, want);
      job.restPriority = Math.max(
        job.restPriority || BINANCE_REST_PRIORITY.DAY_K_EXPIRE,
        restPriority
      );
      job.waiters.push(waiter);
      if (priceFeed) job.priceFeed = priceFeed;
      return;
    }

    job = {
      need: want,
      waiters: [waiter],
      followUpWaiters: [],
      priceFeed,
      exchange,
      restPriority,
    };
    pending.set(key, job);
    scheduleStart(key);
  });
};
