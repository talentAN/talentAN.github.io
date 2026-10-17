/**
 * 暴涨100 事件引擎（冷建完成后跑）：
 * - bookTicker → 滚高日K桶 → 节流判定是否告警/开空
 * - 推送过期 → 入 REST 日K补队列；WS 回来则出队
 * - 账户镜像 / 定时扫 → 空头止盈轻判，缺单才重挂
 */

import {
  shouldThrottleBinanceBackground,
  getBinanceBanRemaining,
} from '../_marketFetchGate';
import { isBinanceAccountMirrorRestInflight } from '@root/src/container/binance/accountMirror';
import {
  getSurgeInfoFromCache,
  touchSurgeDayFromFeed,
  fetchSurgeDayCandle,
  writeSurgeDayFromCandle,
  surgeUtcDayKey,
} from './_surgeDayCache';
import {
  evaluateShortExitLight,
  runSurgeShortExitForSymbol,
  runSurgeShortExitRound,
  getShortPositionFromMirror,
} from './_surgeShortExit';
import {
  enqueueBinanceTradeJob,
  getBinanceTradeQueueSnapshot,
} from '../_binanceTradeQueue';

/** 普通币：多久没 push 算过期，进补K队列 */
const FRESH_TTL_MS = 10_000;
/** 普通币过期 TTL 的随机抖动上限，避免齐刷 */
const FRESH_JITTER_MS = 10_000;
/** 近阈值币：更短的过期 TTL */
const NEAR_TTL_MS = 5_000;
/** 近阈值币过期抖动上限 */
const NEAR_JITTER_MS = 5_000;
/** 同币开仓判定最小间隔 */
const OPEN_THROTTLE_MS = 350;
/** 同币空头轻判最小间隔 */
const EXIT_LIGHT_THROTTLE_MS = 350;
/** 引擎主 tick 周期（扫过期队列等） */
const TICK_MS = 500;
/** 空头出场定时全表兜底间隔 */
const EXIT_SWEEP_MS = 45_000;
/** 账户镜像变更后延迟再跑出场，合并抖动 */
const EXIT_ACCOUNT_DEBOUNCE_MS = 800;
/** ratio ≥ 告警阈值×此系数 → 视为近阈值（用更短 TTL） */
const NEAR_RATIO_OF_THRESHOLD = 0.9;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 按币对哈希出稳定抖动，打散齐刷 */
const hashJitter = (symbol, maxMs) => {
  const s = String(symbol || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return maxMs > 0 ? h % (maxMs + 1) : 0;
};

/** 补K队列优先级：近阈值 > 缺缓存 > 普通过期 */
const PRI = {
  NEAR: 3,
  MISS: 2,
  NORMAL: 1,
};

/**
 * @param {{
 *   pctRef: { current: number },
 *   autoOrderPctRef: { current: number },
 *   autoOrderEnabledRef: { current: boolean },
 *   aborted: () => boolean,
 *   priceFeed: object,
 *   onStatus?: (s: string) => void,
 *   onQueueStatus?: (s: string) => void,
 *   onStats?: (s: object) => void,
 *   applyHit: (info: object) => object|null,
 *   clearHit: (pair: {exchange:string,symbol:string}) => void,
 *   handleAutoOrder: (info: object) => Promise<object|null>,
 *   notifyBatchResult: (freshHits: object[], orderEvents: object[]) => void,
 *   syncAlerts: () => object[],
 *   onExitResult?: (result: object) => void,
 * }} deps
 */
export const createSurgeEventEngine = deps => {
  const state = {
    /** 引擎是否在跑 */
    running: false,
    /** SYMBOL → { exchange, symbol } 监控全集 */
    pairsBySymbol: new Map(),
    /**
     * 每币运行时：过期相位、上次开仓/轻判时间、档位、重挂 inflight
     * @type {Map<string, {
     *   phase: 'fresh'|'queued'|'fetching',
     *   expireAt: number,
     *   lastOpenAt: number,
     *   lastExitLightAt: number,
     *   lastBandKey: string|null,
     *   exitHeavyInflight: boolean,
     * }>}
     */
    symbols: new Map(),
    /** 待 REST 补日K 的队列：SYMBOL → { symbol, priority, enqueuedAt } */
    queue: new Map(),
    /** 是否正有一条补K REST 在飞（串行） */
    restInflight: false,
    /** 主 tick 定时器句柄 */
    tickTimer: null,
    /** 空头定时扫句柄 */
    sweepTimer: null,
    /** 账户变更 debounce 定时器 */
    accountDebounce: null,
    /** 账户扫/定时扫串行链，避免 tip 刷屏 */
    exitRoundTail: Promise.resolve(),
    /** 累计处理的行情事件数 */
    eventCount: 0,
    /** 累计开仓判定次数 */
    openChecks: 0,
    /** 累计补K完成次数 */
    restDone: 0,
    /** 最近一次补K完成时间 */
    lastRestAt: null,
    /** 最近一次补K的币 */
    lastRestSymbol: '',
    /** 最近一次行情事件时间 */
    lastEventAt: null,
    /** 本覆盖轮已见过 bookTicker 的币 */
    seenThisRound: new Set(),
    /** 全表各见一次后的累计轮次 */
    coverageRounds: 0,
  };

  const coverageSnapshot = () => {
    const pairTotal = state.pairsBySymbol.size;
    const pendingCount = Math.max(0, pairTotal - state.seenThisRound.size);
    /** @type {string[]} */
    let pendingSymbols = [];
    if (pendingCount > 0 && pendingCount <= 10) {
      pendingSymbols = [];
      state.pairsBySymbol.forEach((_, sym) => {
        if (!state.seenThisRound.has(sym)) pendingSymbols.push(sym);
      });
      pendingSymbols.sort();
    }
    return {
      coverageRounds: state.coverageRounds,
      pendingCount,
      pairTotal,
      pendingSymbols,
    };
  };

  const emitStats = () => {
    deps.onStats?.({
      eventCount: state.eventCount,
      openChecks: state.openChecks,
      restDone: state.restDone,
      queueDepth: state.queue.size,
      lastRestAt: state.lastRestAt,
      lastRestSymbol: state.lastRestSymbol,
      lastEventAt: state.lastEventAt,
      tracked: state.symbols.size,
      tradeQueue: getBinanceTradeQueueSnapshot(),
      ...coverageSnapshot(),
    });
  };

  /** bookTicker 触达计入覆盖轮；全表齐了则 +1 轮并清空本轮已见 */
  const markSeenBatch = symbols => {
    const total = state.pairsBySymbol.size;
    if (!(total > 0)) return false;
    let changed = false;
    (symbols || []).forEach(raw => {
      const key = String(raw || '').toUpperCase();
      if (!state.pairsBySymbol.has(key)) return;
      if (state.seenThisRound.has(key)) return;
      state.seenThisRound.add(key);
      changed = true;
    });
    if (!changed) return false;
    if (state.seenThisRound.size >= total) {
      state.coverageRounds += 1;
      state.seenThisRound.clear();
    }
    return true;
  };

  const emitQueueStatus = () => {
    if (!state.queue.size && !state.restInflight) {
      deps.onQueueStatus?.('');
      return;
    }
    const head = [...state.queue.values()].sort(
      (a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt
    )[0];
    const restHint = state.restInflight
      ? `REST ${state.lastRestSymbol || '…'}`
      : head
        ? `待补 ${head.symbol}`
        : '';
    deps.onQueueStatus?.(
      `过期补K 队列 ${state.queue.size}${restHint ? ` · ${restHint}` : ''}`
    );
  };

  const thresholdRatio = () => 1 + (Number(deps.pctRef.current) || 0) / 100;

  const isNearThreshold = symbol => {
    const pair = state.pairsBySymbol.get(symbol);
    if (!pair) return false;
    const info = getSurgeInfoFromCache(pair, deps.priceFeed);
    if (!info) return true;
    return info.ratio >= thresholdRatio() * NEAR_RATIO_OF_THRESHOLD;
  };

  const freshTtlFor = symbol => {
    if (isNearThreshold(symbol)) {
      return NEAR_TTL_MS + hashJitter(symbol, NEAR_JITTER_MS);
    }
    return FRESH_TTL_MS + hashJitter(symbol, FRESH_JITTER_MS);
  };

  const ensureSym = symbol => {
    const key = String(symbol || '').toUpperCase();
    let row = state.symbols.get(key);
    if (!row) {
      row = {
        phase: 'fresh',
        expireAt: 0,
        lastOpenAt: 0,
        lastExitLightAt: 0,
        lastBandKey: null,
        exitHeavyInflight: false,
      };
      state.symbols.set(key, row);
    }
    return row;
  };

  const markFresh = symbol => {
    const key = String(symbol || '').toUpperCase();
    const row = ensureSym(key);
    row.phase = 'fresh';
    row.expireAt = Date.now() + freshTtlFor(key);
    if (state.queue.has(key)) {
      state.queue.delete(key);
      emitQueueStatus();
    }
  };

  const enqueue = (symbol, priority = PRI.NORMAL) => {
    const key = String(symbol || '').toUpperCase();
    if (!state.pairsBySymbol.has(key)) return;
    const row = ensureSym(key);
    if (row.phase === 'fetching') return;
    row.phase = 'queued';
    const prev = state.queue.get(key);
    if (prev) {
      prev.priority = Math.max(prev.priority, priority);
      return;
    }
    state.queue.set(key, {
      symbol: key,
      priority,
      enqueuedAt: Date.now(),
    });
    emitQueueStatus();
  };

  const dequeue = symbol => {
    const key = String(symbol || '').toUpperCase();
    if (state.queue.delete(key)) emitQueueStatus();
  };

  const markAllFresh = () => {
    const now = Date.now();
    state.pairsBySymbol.forEach((_, symbol) => {
      const row = ensureSym(symbol);
      row.phase = 'fresh';
      row.expireAt = now + freshTtlFor(symbol);
    });
    state.queue.clear();
    emitQueueStatus();
  };

  const setPairs = pairs => {
    const next = new Map();
    (pairs || []).forEach(p => {
      if (p?.exchange !== 'binance' || !p?.symbol) return;
      const key = String(p.symbol).toUpperCase();
      next.set(key, { exchange: 'binance', symbol: key });
    });
    state.pairsBySymbol = next;
    [...state.symbols.keys()].forEach(k => {
      if (!next.has(k)) {
        state.symbols.delete(k);
        state.queue.delete(k);
      }
    });
    next.forEach((_, k) => ensureSym(k));
    // 列表收缩时丢掉已退市币的已见标记
    [...state.seenThisRound].forEach(k => {
      if (!next.has(k)) state.seenThisRound.delete(k);
    });
  };

  const pushExitTips = result => {
    if (!result) return;
    if (
      (result.placed > 0 || result.failed > 0) &&
      result.tips?.length
    ) {
      deps.onExitResult?.(result);
    }
  };

  const runHeavyExit = async (symbol, { forceRest = false } = {}) => {
    const key = String(symbol || '').toUpperCase();
    const row = ensureSym(key);
    if (row.exitHeavyInflight) return;
    row.exitHeavyInflight = true;
    try {
      const result = await runSurgeShortExitForSymbol(key, {
        onStatus: deps.onStatus,
        forceRest,
      });
      const light = evaluateShortExitLight(key);
      if (light.hasShort && light.bandKey) row.lastBandKey = light.bandKey;
      pushExitTips(result);
    } finally {
      row.exitHeavyInflight = false;
    }
  };

  const lightExitForSymbol = symbol => {
    const key = String(symbol || '').toUpperCase();
    const row = ensureSym(key);
    const now = Date.now();
    if (now - row.lastExitLightAt < EXIT_LIGHT_THROTTLE_MS) return;
    row.lastExitLightAt = now;

    const light = evaluateShortExitLight(key);
    if (!light.hasShort) return;

    const bandChanged =
      light.bandKey != null &&
      row.lastBandKey != null &&
      light.bandKey !== row.lastBandKey;
    if (light.bandKey != null) row.lastBandKey = light.bandKey;

    if (bandChanged || light.needHeavy) {
      // 出场校验+挂单进高优队，不堵行情链
      enqueueBinanceTradeJob(`SURGE_EXIT:${key}`, async () => {
        if (!state.running || deps.aborted?.()) return null;
        return runHeavyExit(key);
      }).catch(e => {
        console.error('[SurgeEventEngine] exitQueue', key, e);
      });
    }
  };

  const openCheckForSymbol = async symbol => {
    const key = String(symbol || '').toUpperCase();
    if (getShortPositionFromMirror(key)) {
      lightExitForSymbol(key);
      return;
    }

    const row = ensureSym(key);
    const now = Date.now();
    if (now - row.lastOpenAt < OPEN_THROTTLE_MS) return;
    row.lastOpenAt = now;
    state.openChecks += 1;

    const pair = state.pairsBySymbol.get(key);
    if (!pair) return;

    touchSurgeDayFromFeed(key, deps.priceFeed);
    const info = getSurgeInfoFromCache(pair, deps.priceFeed);
    if (!info) {
      deps.clearHit(pair);
      enqueue(key, PRI.MISS);
      return;
    }

    const threshold = thresholdRatio();
    const freshHits = [];

    if (info.ratio >= threshold) {
      const fresh = deps.applyHit(info);
      if (fresh) freshHits.push(fresh);
    } else {
      deps.clearHit(pair);
    }

    // 先入 OPEN 道（与横盘/出场并行），再刷提醒 UI
    if (deps.autoOrderEnabledRef.current) {
      const autoThreshold = 1 + (Number(deps.autoOrderPctRef.current) || 0) / 100;
      if (info.ratio >= autoThreshold) {
        const snapshot = { ...info };
        // queuedAt 用队内首次 enqueuedAt（merge 不刷新），避免「入队+Ns」虚高
        enqueueBinanceTradeJob(`SURGE_OPEN:${key}`, async ({ enqueuedAt }) => {
          if (!state.running || deps.aborted?.()) return null;
          if (!deps.autoOrderEnabledRef.current) return null;
          const thr = 1 + (Number(deps.autoOrderPctRef.current) || 0) / 100;
          const live =
            getSurgeInfoFromCache(pair, deps.priceFeed) || snapshot;
          if (!(live.ratio >= thr)) return null;
          try {
            const event = await deps.handleAutoOrder({
              ...live,
              queuedAt: enqueuedAt,
            });
            if (event) {
              deps.syncAlerts?.();
              deps.notifyBatchResult?.([], [event]);
            }
            return event;
          } catch (e) {
            console.error('[SurgeEventEngine] autoOrder', key, e);
            return null;
          }
        }).catch(e => {
          console.error('[SurgeEventEngine] orderQueue', key, e);
        });
      }
    }

    if (freshHits.length) {
      deps.syncAlerts?.();
      deps.notifyBatchResult?.(freshHits, []);
    }

    emitStats();
  };

  let quoteChain = Promise.resolve();

  const onQuotes = symbols => {
    if (!state.running || deps.aborted?.()) return;
    const list = Array.isArray(symbols) ? symbols : [];
    if (!list.length) return;
    state.eventCount += 1;
    state.lastEventAt = Date.now();

    const touched = [];
    list.forEach(raw => {
      const key = String(raw || '').toUpperCase();
      if (!state.pairsBySymbol.has(key)) return;
      touchSurgeDayFromFeed(key, deps.priceFeed);
      markFresh(key);
      touched.push(key);
    });
    if (touched.length) markSeenBatch(touched);

    // 快路径：本帧同步尝试入 OPEN 道，不坐等上一帧 quoteChain 排空
    // （openCheck 内有 throttle；SURGE_OPEN 同 key merge，重复入队无害）
    for (const key of touched) {
      try {
        openCheckForSymbol(key);
      } catch (e) {
        console.error('[SurgeEventEngine] quoteFast', key, e);
      }
    }

    // 串行链：补跑/收尾（与快路径共用 throttle，不会双开校验）
    quoteChain = quoteChain
      .then(async () => {
        for (const key of touched) {
          if (!state.running || deps.aborted?.()) break;
          if (!state.pairsBySymbol.has(key)) continue;
          try {
            await openCheckForSymbol(key);
          } catch (e) {
            console.error('[SurgeEventEngine] quote', key, e);
          }
        }
        emitStats();
      })
      .catch(() => undefined);

    emitStats();
  };

  const sweepExpired = () => {
    if (!state.running || deps.aborted?.()) return;
    const now = Date.now();
    state.symbols.forEach((row, symbol) => {
      if (row.phase === 'fetching') return;
      if (row.phase === 'queued') return;
      if (!(row.expireAt > 0) || now < row.expireAt) return;
      const pri = isNearThreshold(symbol) ? PRI.NEAR : PRI.NORMAL;
      enqueue(symbol, pri);
    });
  };

  const pumpRestQueue = async () => {
    if (!state.running || deps.aborted?.() || state.restInflight) return;
    if (!state.queue.size) return;
    if (shouldThrottleBinanceBackground() || isBinanceAccountMirrorRestInflight()) {
      return;
    }

    const ordered = [...state.queue.values()].sort(
      (a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt
    );
    const job = ordered[0];
    if (!job) return;

    const key = job.symbol;
    state.queue.delete(key);
    const row = ensureSym(key);
    row.phase = 'fetching';
    state.restInflight = true;
    state.lastRestSymbol = key;
    emitQueueStatus();

    try {
      const banLeft = getBinanceBanRemaining();
      if (banLeft > 0) await sleep(Math.min(banLeft + 50, 3000));

      const pair = state.pairsBySymbol.get(key);
      const candle = await fetchSurgeDayCandle(key);
      if (candle && pair && state.running && !deps.aborted?.()) {
        writeSurgeDayFromCandle(pair, candle, deps.priceFeed);
        state.restDone += 1;
        state.lastRestAt = Date.now();
        // 覆盖轮：REST 补 K 成功也算本轮已触达（冷门币可能长期无 bookTicker）
        markSeenBatch([key]);
      }
      markFresh(key);
      if (state.running && !deps.aborted?.()) {
        await openCheckForSymbol(key);
      }
    } catch (e) {
      console.warn('[SurgeEventEngine] rest', key, e);
      markFresh(key);
    } finally {
      state.restInflight = false;
      emitQueueStatus();
      emitStats();
    }
  };

  const enqueueExitRound = (label, run) => {
    const job = state.exitRoundTail.then(async () => {
      if (!state.running || deps.aborted?.()) return null;
      deps.onStatus?.(label);
      // 全账户出场扫描+挂单：高优队，挡补 K
      return enqueueBinanceTradeJob('SURGE_EXIT:ROUND', async () => {
        if (!state.running || deps.aborted?.()) return null;
        return run();
      });
    });
    state.exitRoundTail = job.catch(() => null);
    return job;
  };

  const onAccountChange = () => {
    if (!state.running || deps.aborted?.()) return;
    if (state.accountDebounce) clearTimeout(state.accountDebounce);
    state.accountDebounce = setTimeout(() => {
      state.accountDebounce = null;
      if (!state.running || deps.aborted?.()) return;
      enqueueExitRound('空头止盈：账户变更…', async () => {
        try {
          const result = await runSurgeShortExitRound({
            aborted: () => !state.running || deps.aborted?.(),
            onStatus: deps.onStatus,
          });
          pushExitTips(result);
          state.symbols.forEach((row, symbol) => {
            const light = evaluateShortExitLight(symbol);
            if (light.hasShort && light.bandKey) row.lastBandKey = light.bandKey;
            else if (!light.hasShort) row.lastBandKey = null;
          });
          return result;
        } catch (e) {
          console.error('[SurgeEventEngine] account exit', e);
          return null;
        }
      });
    }, EXIT_ACCOUNT_DEBOUNCE_MS);
  };

  const start = ({ pairs, resetCoverage = false } = {}) => {
    if (state.running) return;
    state.running = true;
    if (pairs) setPairs(pairs);
    markAllFresh();
    state.seenThisRound.clear();
    if (resetCoverage) state.coverageRounds = 0;
    emitStats();
    deps.onStatus?.(
      `事件驱动中 · 跟踪 ${state.pairsBySymbol.size} 币 · 过期补K`
    );

    state.tickTimer = setInterval(() => {
      if (!state.running || deps.aborted?.()) return;
      // UTC 切日由外层冷建；这里只扫过期 + 泵队列
      if (surgeUtcDayKey() !== deps.getDayKey?.()) {
        deps.onDayRollover?.();
        return;
      }
      sweepExpired();
      pumpRestQueue();
    }, TICK_MS);

    state.sweepTimer = setInterval(() => {
      if (!state.running || deps.aborted?.()) return;
      enqueueExitRound('空头止盈：定时对账…', async () => {
        try {
          const result = await runSurgeShortExitRound({
            aborted: () => !state.running || deps.aborted?.(),
            onStatus: deps.onStatus,
          });
          pushExitTips(result);
          return result;
        } catch (e) {
          console.error('[SurgeEventEngine] exit sweep', e);
          return null;
        }
      });
    }, EXIT_SWEEP_MS);
  };

  const stop = () => {
    state.running = false;
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
    if (state.sweepTimer) {
      clearInterval(state.sweepTimer);
      state.sweepTimer = null;
    }
    if (state.accountDebounce) {
      clearTimeout(state.accountDebounce);
      state.accountDebounce = null;
    }
    state.queue.clear();
    emitQueueStatus();
  };

  const rearmFresh = () => {
    if (!state.running) return;
    markAllFresh();
  };

  return {
    start,
    stop,
    setPairs,
    markAllFresh,
    rearmFresh,
    onQuotes,
    onAccountChange,
    getStats: () => ({
      eventCount: state.eventCount,
      openChecks: state.openChecks,
      restDone: state.restDone,
      queueDepth: state.queue.size,
      lastRestAt: state.lastRestAt,
      lastRestSymbol: state.lastRestSymbol,
      lastEventAt: state.lastEventAt,
      tracked: state.symbols.size,
      ...coverageSnapshot(),
    }),
  };
};
