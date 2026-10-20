/**
 * 暴涨100 事件引擎（冷建完成后跑）：
 * - bookTicker → 滚高日K桶 → 节流判定是否告警/开空
 * - 推送过期 → 入补K队列（入队即算本轮触达）；WS/补成则出队
 * - 覆盖轮：全集 WS 或已入补K队 → 本轮完成；入队后墙钟 ≥45s 未清 → DAY_K_OVERDUE
 * - 账户镜像变更 → 全表出场；结束后起算 45s idle，无再变更则兜底，有变更则重置
 * - 行情轻判档位变化 → 单币 SURGE_EXIT 入 REST 队
 */

import {
  shouldThrottleBinanceBackground,
  getBinanceBanRemaining,
} from '../_marketFetchGate';
import { isBinanceAccountMirrorRestInflight } from '@root/src/container/binance/accountMirror';
import {
  getSurgeInfoFromCache,
  touchSurgeDayFromFeed,
  surgeUtcDayKey,
} from './_surgeDayCache';
import {
  evaluateShortExitLight,
  runSurgeShortExitForSymbol,
  runSurgeShortExitRound,
  getShortPositionFromMirror,
} from './_surgeShortExit';
import { getBinanceTradeQueueSnapshot } from '../_binanceTradeQueue';
import {
  enqueueBinanceRestJob,
  BINANCE_REST_PRIORITY,
} from '../_binanceRestQueue';
import { requestDayKRest, cancelDayKRest, DAY_K_NEED } from '../_dayKRestCoalesce';

/** 普通币：多久没 push 算过期，进补K队列 */
const FRESH_TTL_MS = 30_000;
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
/**
 * 空头出场 idle 兜底：账户变更 round 结束后起算；
 * 45s 内再有账户变更则清计时，等新 round 结束后重新起算。
 */
const EXIT_IDLE_SWEEP_MS = 45_000;
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

/** 补K本地队列优先级：滞留提权 > 近阈值 > 缺缓存 > 普通过期 */
const PRI = {
  OVERDUE: 10,
  NEAR: 3,
  MISS: 2,
  NORMAL: 1,
};
/** 入队后墙钟超过此时长仍未因 WS/补成清除 → 提权 DAY_K_OVERDUE */
const OVERDUE_AFTER_MS = 45_000;

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
    /** 账户变更后 idle 兜底定时器（非固定轮询） */
    exitIdleTimer: null,
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
    /** 本覆盖轮开始时刻 */
    coverageRoundStartedAt: 0,
    /** 已完成覆盖轮耗时累计（ms） */
    coverageRoundSumMs: 0,
    /** 平均每覆盖轮耗时（ms） */
    avgCoverageRoundMs: null,
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
      avgCoverageRoundMs: state.avgCoverageRoundMs,
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

  /** 仍在补K途中的币：新覆盖轮也算已触达 */
  const seedSeenFromPendingDayK = () => {
    state.queue.forEach((_, k) => {
      if (state.pairsBySymbol.has(k)) state.seenThisRound.add(k);
    });
    state.symbols.forEach((row, k) => {
      if (row.phase === 'fetching' && state.pairsBySymbol.has(k)) {
        state.seenThisRound.add(k);
      }
    });
  };

  /**
   * 入队后墙钟 ≥ OVERDUE_AFTER_MS 仍未被 WS/补成清除 → 提权全局 DAY_K_OVERDUE。
   * 不按覆盖轮计数，避免「入队即触达」瞬时滚轮误提权。
   */
  const promoteStaleDayKJobs = () => {
    const need = DAY_K_NEED.TODAY;
    const now = Date.now();
    const toPromote = [];
    state.queue.forEach((job, key) => {
      if (job.promoted) return;
      const enqueuedAt = Number(job.enqueuedAt) || 0;
      if (!(enqueuedAt > 0) || now - enqueuedAt < OVERDUE_AFTER_MS) return;
      job.promoted = true;
      job.priority = Math.max(job.priority || 0, PRI.OVERDUE);
      toPromote.push(key);
    });
    if (!toPromote.length) return;
    emitQueueStatus();
    toPromote.forEach(key => {
      const row = ensureSym(key);
      if (row.phase === 'fetching') {
        // 已在飞：只抬 REST 优先级
        requestDayKRest(key, {
          need,
          priceFeed: deps.priceFeed,
          exchange: 'binance',
          restPriority: BINANCE_REST_PRIORITY.DAY_K_OVERDUE,
        }).catch(() => undefined);
        return;
      }
      state.queue.delete(key);
      row.phase = 'fetching';
      requestDayKRest(key, {
        need,
        priceFeed: deps.priceFeed,
        exchange: 'binance',
        restPriority: BINANCE_REST_PRIORITY.DAY_K_OVERDUE,
      })
        .then(async result => {
          if (!state.running || deps.aborted?.()) return;
          // WS 已 markFresh → 任务被 cancel，勿再记补成/开仓
          if (result?.cancelled) return;
          if (result?.ok) {
            state.restDone += 1;
            state.lastRestAt = Date.now();
            markSeenBatch([key]);
          }
          markFresh(key);
          if (state.running && !deps.aborted?.()) {
            await openCheckForSymbol(key);
          }
        })
        .catch(e => {
          console.warn('[SurgeEventEngine] overdue dayK', key, e);
          markFresh(key);
        })
        .finally(() => {
          emitQueueStatus();
          emitStats();
        });
    });
  };

  const rolloverCoverageRound = () => {
    const total = state.pairsBySymbol.size;
    if (!(total > 0)) return;
    let guard = 0;
    while (state.seenThisRound.size >= total && guard < 8) {
      guard += 1;
      const now = Date.now();
      const started = state.coverageRoundStartedAt || now;
      const elapsed = Math.max(0, now - started);
      state.coverageRounds += 1;
      state.coverageRoundSumMs += elapsed;
      state.avgCoverageRoundMs = Math.round(
        state.coverageRoundSumMs / state.coverageRounds
      );
      state.coverageRoundStartedAt = now;
      state.seenThisRound.clear();
      seedSeenFromPendingDayK();
    }
  };

  /** WS 触达或入补K队计入覆盖轮；全表齐了则 +1 轮 */
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
    if (state.seenThisRound.size >= total) rolloverCoverageRound();
    return true;
  };

  let lastLoggedQueueSize = -1;
  const emitQueueStatus = () => {
    const size = state.queue.size;
    if (size !== lastLoggedQueueSize) {
      lastLoggedQueueSize = size;
      console.info('[SurgeEventEngine] 过期补K队列长度', size);
    }
    if (!size && !state.restInflight) {
      deps.onQueueStatus?.('');
      return;
    }
    const head = [...state.queue.values()].sort(
      (a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt
    )[0];
    let restHint = '';
    if (state.restInflight) {
      restHint = `REST ${state.lastRestSymbol || '…'}`;
    } else if (head) {
      const yielding =
        shouldThrottleBinanceBackground() || isBinanceAccountMirrorRestInflight();
      restHint = yielding
        ? `待补 ${head.symbol} · 让路中`
        : `待补 ${head.symbol}`;
    }
    deps.onQueueStatus?.(
      `过期补K 队列 ${size}${restHint ? ` · ${restHint}` : ''}`
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
    // 清全局 DAY_K（含 OVERDUE 抬权后仍排队的任务）
    cancelDayKRest(key);
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
      // 已在队：仍算本轮触达（入队即触达）
      markSeenBatch([key]);
      return;
    }
    state.queue.set(key, {
      symbol: key,
      priority,
      enqueuedAt: Date.now(),
      promoted: false,
    });
    emitQueueStatus();
    // 入队即算本轮覆盖触达，不等 REST 完成
    markSeenBatch([key]);
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
      // 单币重判+挂单 → REST 队 SURGE_EXIT
      enqueueBinanceRestJob(
        `SURGE_EXIT:${key}`,
        async () => {
          if (!state.running || deps.aborted?.()) return null;
          return runHeavyExit(key);
        },
        { priority: BINANCE_REST_PRIORITY.SURGE_EXIT }
      ).catch(e => {
        console.error('[SurgeEventEngine] restQueue SURGE_EXIT', key, e);
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

    // 暴涨开仓 → REST 队列最高优先（BINANCE_REST_PRIORITY.SURGE_OPEN）
    if (deps.autoOrderEnabledRef.current) {
      const autoThreshold = 1 + (Number(deps.autoOrderPctRef.current) || 0) / 100;
      if (info.ratio >= autoThreshold) {
        const snapshot = { ...info };
        // queuedAt 用队内首次 enqueuedAt（merge 不刷新），避免「入队+Ns」虚高
        enqueueBinanceRestJob(
          `SURGE_OPEN:${key}`,
          async ({ enqueuedAt }) => {
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
          },
          { priority: BINANCE_REST_PRIORITY.SURGE_OPEN }
        ).catch(e => {
          console.error('[SurgeEventEngine] restQueue SURGE_OPEN', key, e);
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
      emitQueueStatus();
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

      // 与横盘同币合并：可能直接复用对方的 lookback / 在途 today
      const restPriority = job.promoted
        ? BINANCE_REST_PRIORITY.DAY_K_OVERDUE
        : BINANCE_REST_PRIORITY.DAY_K_EXPIRE;
      const result = await requestDayKRest(key, {
        need: DAY_K_NEED.TODAY,
        priceFeed: deps.priceFeed,
        exchange: 'binance',
        restPriority,
      });
      if (result?.cancelled) return;
      if (result?.ok && state.running && !deps.aborted?.()) {
        state.restDone += 1;
        state.lastRestAt = Date.now();
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

  const clearExitIdleSweep = () => {
    if (state.exitIdleTimer) {
      clearTimeout(state.exitIdleTimer);
      state.exitIdleTimer = null;
    }
  };

  /** 全表出场 round 结束后起算 45s idle；到点无账户变更则兜底 */
  const scheduleExitIdleSweep = () => {
    clearExitIdleSweep();
    if (!state.running || deps.aborted?.()) return;
    state.exitIdleTimer = setTimeout(() => {
      state.exitIdleTimer = null;
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
          console.error('[SurgeEventEngine] exit idle sweep', e);
          return null;
        }
      });
    }, EXIT_IDLE_SWEEP_MS);
  };

  const enqueueExitRound = (label, run) => {
    const job = state.exitRoundTail.then(async () => {
      if (!state.running || deps.aborted?.()) return null;
      deps.onStatus?.(label);
      try {
        // 全账户出场扫描+挂单 → REST 队 SURGE_EXIT
        return await enqueueBinanceRestJob(
          'SURGE_EXIT:ROUND',
          async () => {
            if (!state.running || deps.aborted?.()) return null;
            return run();
          },
          { priority: BINANCE_REST_PRIORITY.SURGE_EXIT }
        );
      } finally {
        // round 结束后重新起算 45s（账户变更 / 兜底共用）
        scheduleExitIdleSweep();
      }
    });
    state.exitRoundTail = job.catch(() => null);
    return job;
  };

  const onAccountChange = () => {
    if (!state.running || deps.aborted?.()) return;
    // 45s 内又有账户变更：打断 idle 倒计时，等本轮 round 结束后再重新计时
    clearExitIdleSweep();
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
    // 清旧 lastEventAt，避免 stop→start 后 stall 检测误判「已僵死」连环重建
    state.lastEventAt = null;
    state.coverageRoundStartedAt = Date.now();
    if (resetCoverage) {
      state.coverageRounds = 0;
      state.coverageRoundSumMs = 0;
      state.avgCoverageRoundMs = null;
    }
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
      promoteStaleDayKJobs();
      pumpRestQueue();
    }, TICK_MS);

    // 启动后先起一轮 idle：45s 内无账户变更则兜底；有变更则由 onAccountChange 重置
    scheduleExitIdleSweep();
  };

  const stop = () => {
    state.running = false;
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
    clearExitIdleSweep();
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
    /** 引擎 tick/扫轮是否在跑（bootstrap 热路径必须据此判断，勿只看 engineRef） */
    isRunning: () => state.running,
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
      running: state.running,
      ...coverageSnapshot(),
    }),
  };
};
