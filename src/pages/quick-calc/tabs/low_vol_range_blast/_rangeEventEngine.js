/**
 * 横盘监控事件引擎：
 * - 冷建日 K 后：bookTicker → 盒子评估 → 节流清理/近带开仓
 * - 无推送过期（30s+jitter）→ 入补K队（入队即算本轮触达）；WS/补成则出队
 * - 覆盖轮：全集 WS 或已入补K队 → 本轮完成；入队后墙钟 ≥45s 未清 → DAY_K_OVERDUE
 * - 账户镜像变更 → 全表出场（RANGE_EXIT）；结束后起算 45s idle，无再变更则兜底
 * - 持仓币 tick 轻触发：节流后对该币跑出场
 */
import {
  shouldThrottleBinanceBackground,
  getBinanceBanRemaining,
} from '../_marketFetchGate';
import {
  isBinanceAccountMirrorRestInflight,
  subscribeBinanceAccountMirrorChanges,
} from '@root/src/container/binance/accountMirror';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { isLiveOrderEnabled } from '../system_1/_autoOrderModel';
import { utcDayKey } from './_rangeMonitorCandleCache';
import { evalRangeBox } from './_rangeBoxEval';
import {
  handleRangeSymbolPriceEvent,
  hasLongPositionInMirror,
  peekMirrorSnapshot,
  shouldEnqueueRangeTradeAction,
} from './_rangeEventActions';
import { runRangeMonitorPositionStops } from './_rangeMonitorEngine';
import { RANGE_MONITOR_SCAN_ENABLED } from './_rangeMonitorParams';
import {
  enqueueBinanceRestJob,
  BINANCE_REST_PRIORITY,
} from '../_binanceRestQueue';
import { requestDayKRest, cancelDayKRest, DAY_K_NEED } from '../_dayKRestCoalesce';

const FRESH_TTL_MS = 30_000;
const FRESH_JITTER_MS = 10_000;
const NEAR_TTL_MS = 5_000;
const NEAR_JITTER_MS = 5_000;
const ACTION_THROTTLE_MS = 400;
const EXIT_LIGHT_THROTTLE_MS = 3_000;
const TICK_MS = 500;
/**
 * 持仓出场 idle 兜底：账户变更 / 全量 round 结束后起算；
 * 45s 内再有账户变更则清计时，等新 round 结束后重新起算。
 */
const EXIT_IDLE_SWEEP_MS = 45_000;
const EXIT_ACCOUNT_DEBOUNCE_MS = 800;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const hashJitter = (symbol, maxMs) => {
  const s = String(symbol || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return maxMs > 0 ? h % (maxMs + 1) : 0;
};

const PRI = { OVERDUE: 10, NEAR: 3, MISS: 2, HAS_ORDER: 2, NORMAL: 1 };
/** 入队后墙钟超过此时长仍未因 WS/补成清除 → 提权 DAY_K_OVERDUE */
const OVERDUE_AFTER_MS = 45_000;

/** 本覆盖轮漏斗：按币去重，与 pending/pairTotal 同一轮口径 */
const createEmptyRoundFunnel = () => ({
  hits: new Set(),
  nearBandIn: new Set(),
  nearBandBusy: new Set(),
  /** 近带已入 REST 队 RANGE_OPEN、开仓结果尚未回来 */
  nearBandPending: new Set(),
  minNotionalSkip: new Set(),
  /** symbol → { reason, detail } */
  placeSkipped: new Map(),
  brokeOut: new Set(),
  placed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
});

const rememberPlaceSkipped = (funnel, symbol, reason, detail) => {
  const key = String(symbol || '').toUpperCase();
  if (!key || !funnel?.placeSkipped) return;
  funnel.placeSkipped.set(key, {
    reason: reason || 'unknown',
    detail: detail ? String(detail) : '',
  });
};

const snapshotRoundFunnel = (funnel, seenSize) => {
  const placeSkippedItems = [...funnel.placeSkipped.entries()]
    .map(([symbol, info]) => ({
      symbol,
      reason: info?.reason || 'unknown',
      detail: info?.detail || '',
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    scanned: seenSize,
    hits: funnel.hits.size,
    nearBandIn: funnel.nearBandIn.size,
    nearBandBusy: funnel.nearBandBusy.size,
    nearBandPending: funnel.nearBandPending.size,
    minNotionalSkip: funnel.minNotionalSkip.size,
    placeSkipped: funnel.placeSkipped.size,
    placeSkippedItems,
    brokeOut: funnel.brokeOut.size,
    placed: funnel.placed.size,
    cancelled: funnel.cancelled.size,
    failed: funnel.failed.size,
  };
};

/**
 * @param {{
 *   maxMultRef: { current: number },
 *   nearBandPctRef: { current: number },
 *   aborted: () => boolean,
 *   priceFeed: object,
 *   onStatus?: (s: string) => void,
 *   onQueueStatus?: (s: string) => void,
 *   onStats?: (s: object) => void,
 *   onLog?: (entry: object) => void,
 *   getDayKey?: () => string,
 *   onDayRollover?: () => void,
 * }} deps
 */
export const createRangeEventEngine = deps => {
  const state = {
    running: false,
    pairsBySymbol: new Map(),
    symbols: new Map(),
    queue: new Map(),
    restInflight: false,
    tickTimer: null,
    /** 账户变更后 idle 兜底定时器（非固定轮询） */
    exitIdleTimer: null,
    accountDebounce: null,
    unsubAccount: null,
    exitRoundTail: Promise.resolve(),
    stockSymbols: new Set(),
    openStop: false,
    eventCount: 0,
    actionChecks: 0,
    restDone: 0,
    lastRestAt: null,
    lastRestSymbol: '',
    lastEventAt: null,
    seenThisRound: new Set(),
    coverageRounds: 0,
    coverageRoundStartedAt: 0,
    coverageRoundSumMs: 0,
    avgCoverageRoundMs: null,
    /** 当前覆盖轮漏斗（币对去重） */
    roundFunnel: createEmptyRoundFunnel(),
  };

  let quoteChain = Promise.resolve();

  const coverageSnapshot = () => {
    const pairTotal = state.pairsBySymbol.size;
    const pendingCount = Math.max(0, pairTotal - state.seenThisRound.size);
    let pendingSymbols = [];
    if (pendingCount > 0 && pendingCount <= 10) {
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
    const coverage = coverageSnapshot();
    deps.onStats?.({
      eventCount: state.eventCount,
      actionChecks: state.actionChecks,
      restDone: state.restDone,
      queueDepth: state.queue.size,
      lastRestAt: state.lastRestAt,
      lastRestSymbol: state.lastRestSymbol,
      lastEventAt: state.lastEventAt,
      tracked: state.symbols.size,
      // 与顶部 pending/pairTotal 同一覆盖轮；检=本轮已触达币数
      funnel: snapshotRoundFunnel(
        state.roundFunnel,
        Math.max(0, coverage.pairTotal - coverage.pendingCount)
      ),
      openStop: state.openStop,
      ...coverage,
    });
  };

  const resetRoundFunnel = () => {
    state.roundFunnel = createEmptyRoundFunnel();
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
    const need = DAY_K_NEED.LOOKBACK;
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
            await runSymbolAction(key);
            await lightExitForSymbol(key);
          }
        })
        .catch(e => {
          console.warn('[RangeEventEngine] overdue dayK', key, e);
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
      resetRoundFunnel();
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
      console.info('[RangeEventEngine] 过期补K队列长度', size);
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
      // 区分「队头在等泵」vs「被交易高优/限流让路」——后者以前看起来像卡死
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

  const isNearBandPriority = symbol => {
    const box = evalRangeBox(symbol, {
      maxRangeMult: deps.maxMultRef.current,
      nearBandPct: deps.nearBandPctRef.current,
      priceFeed: deps.priceFeed,
      pair: state.pairsBySymbol.get(symbol),
    });
    if (box.miss) return true;
    return Boolean(box.nearBand || box.leaveBand);
  };

  const freshTtlFor = symbol => {
    if (isNearBandPriority(symbol)) {
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
        lastActionAt: 0,
        lastExitLightAt: 0,
        lastYyBand: null,
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
    [...state.seenThisRound].forEach(k => {
      if (!next.has(k)) state.seenThisRound.delete(k);
    });
  };

  const actionOpts = () => ({
    maxRangeMult: deps.maxMultRef.current,
    nearBandPct: deps.nearBandPctRef.current,
    priceFeed: deps.priceFeed,
    stockSymbols: state.stockSymbols,
    onLog: entry => {
      const sym = String(entry?.symbol || '').toUpperCase();
      if (sym && state.roundFunnel) {
        if (entry?.type === 'placed') state.roundFunnel.placed.add(sym);
        if (entry?.type === 'cancelled') state.roundFunnel.cancelled.add(sym);
        if (entry?.type === 'broke_out') state.roundFunnel.brokeOut.add(sym);
        if (entry?.type === 'failed_stop' || entry?.type === 'max_stop_limit') {
          state.roundFunnel.failed.add(sym);
        }
        if (entry?.type === 'min_notional_skip') {
          state.roundFunnel.minNotionalSkip.add(sym);
        }
        if (entry?.type === 'skipped') {
          // 已有仓/单走「已有仓/单」桶；此处只记真正的下单跳过
          const r = entry.reason;
          if (
            r &&
            r !== 'has_position' &&
            r !== 'has_orders' &&
            r !== 'min_notional' &&
            r !== 'broke_out'
          ) {
            rememberPlaceSkipped(state.roundFunnel, sym, r, entry.detail);
          }
        }
      }
      deps.onLog?.(entry);
    },
    onStatus: deps.onStatus,
  });
  const runSymbolAction = async symbol => {
    const key = String(symbol || '').toUpperCase();
    const row = ensureSym(key);
    const now = Date.now();
    if (now - row.lastActionAt < ACTION_THROTTLE_MS) return;
    row.lastActionAt = now;
    state.actionChecks += 1;

    const box = evalRangeBox(key, {
      maxRangeMult: deps.maxMultRef.current,
      nearBandPct: deps.nearBandPctRef.current,
      priceFeed: deps.priceFeed,
      pair: state.pairsBySymbol.get(key),
    });
    row.lastYyBand = box.nearBand
      ? 'near'
      : box.leaveBand
        ? 'leave'
        : box.inRange
          ? 'in'
          : 'out';

    // 本轮漏斗：按币去重；进出区间要增减，避免「曾进过」粘住虚高
    if (box.inRange) state.roundFunnel.hits.add(key);
    else state.roundFunnel.hits.delete(key);
    if (box.nearBand) state.roundFunnel.nearBandIn.add(key);
    else {
      state.roundFunnel.nearBandIn.delete(key);
      state.roundFunnel.nearBandBusy.delete(key);
      state.roundFunnel.nearBandPending.delete(key);
    }

    if (!isLiveOrderEnabled()) return;

    // 远带且无 lvb 单：只更新漏斗，不进 REST 队（避免灌爆拖死 SURGE_OPEN / RANGE_EXIT）
    if (!shouldEnqueueRangeTradeAction(key, box)) return;

    // 近带：先记「待挂」，REST 队跑完再清——避免漏斗出现「近带4、挂0」像没下单
    if (box.nearBand) state.roundFunnel.nearBandPending.add(key);

    // 清理校验+撤单 / 近带开仓校验+挂单 → REST 队 RANGE_OPEN(200)，低于 EXIT(800)
    enqueueBinanceRestJob(
      `RANGE:${key}`,
      async () => {
        try {
          if (!state.running || deps.aborted?.()) return null;
          if (!isLiveOrderEnabled()) return null;
          const result = await handleRangeSymbolPriceEvent(key, actionOpts());
          if (result?.needRest) enqueue(key, PRI.MISS);
          if (result?.open?.fatalOpen) state.openStop = true;

          const openReason = result?.open?.reason;
          const cleanupReason = result?.cleanup?.reason;
          if (
            box.nearBand &&
            (cleanupReason === 'keep' ||
              openReason === 'has_position' ||
              openReason === 'has_orders')
          ) {
            state.roundFunnel.nearBandBusy.add(key);
          } else if (!box.nearBand) {
            state.roundFunnel.nearBandBusy.delete(key);
          }
          if (openReason === 'min_notional') state.roundFunnel.minNotionalSkip.add(key);
          if (result?.open?.acted) {
            state.roundFunnel.placed.add(key);
            state.roundFunnel.placeSkipped.delete(key);
          }
          if (openReason === 'broke_out') state.roundFunnel.brokeOut.add(key);
          if (openReason === 'failed' || openReason === 'account_stop') {
            state.roundFunnel.failed.add(key);
          }
          // 近带入队后未挂成、也非名义/破/败/已有仓单：计入下单跳过（带 reason）
          if (
            box.nearBand &&
            !result?.open?.acted &&
            openReason &&
            openReason !== 'min_notional' &&
            openReason !== 'broke_out' &&
            openReason !== 'failed' &&
            openReason !== 'account_stop' &&
            openReason !== 'has_position' &&
            openReason !== 'has_orders'
          ) {
            rememberPlaceSkipped(
              state.roundFunnel,
              key,
              openReason,
              result?.open?.detail
            );
          }
          return result;
        } finally {
          state.roundFunnel.nearBandPending.delete(key);
          emitStats();
        }
      },
      { priority: BINANCE_REST_PRIORITY.RANGE_OPEN }
    ).catch(e => {
      state.roundFunnel.nearBandPending.delete(key);
      console.error('[RangeEventEngine] restQueue RANGE_OPEN', key, e);
      emitStats();
    });
  };

  const steadyStatus = () =>
    `事件驱动中 · 跟踪 ${state.pairsBySymbol.size} 币 · 过期补K`;

  const clearExitIdleSweep = () => {
    if (state.exitIdleTimer) {
      clearTimeout(state.exitIdleTimer);
      state.exitIdleTimer = null;
    }
  };

  /** 全量出场 round 结束后起算 45s idle；到点无账户变更则兜底 */
  const scheduleExitIdleSweep = () => {
    clearExitIdleSweep();
    if (!state.running || deps.aborted?.()) return;
    state.exitIdleTimer = setTimeout(() => {
      state.exitIdleTimer = null;
      if (!state.running || deps.aborted?.()) return;
      enqueueExitRound('持仓：定时对账…', null);
    }, EXIT_IDLE_SWEEP_MS);
  };

  const runExitForSymbols = async (symbols, label) => {
    if (!state.running || deps.aborted?.()) return null;
    if (!isLiveOrderEnabled()) return null;
    const list = (symbols || []).map(s => String(s).toUpperCase()).filter(Boolean);
    const jobKey = list.length
      ? `RANGE_EXIT:${[...list].sort().join(',')}`
      : 'RANGE_EXIT:FULL';
    deps.onStatus?.(label || '持仓出场…');
    try {
      // 出场 xx 校验 + 止盈/止损/追踪挂撤 → REST 队 RANGE_EXIT
      return await enqueueBinanceRestJob(
        jobKey,
        async () => {
          if (!state.running || deps.aborted?.()) return null;
          if (!isLiveOrderEnabled()) return null;
          return runRangeMonitorPositionStops({
            signal: {
              get aborted() {
                return Boolean(deps.aborted?.());
              },
            },
            onStatus: deps.onStatus,
            onLog: deps.onLog,
            priceFeed: deps.priceFeed,
            onlySymbols: list.length ? list : null,
          });
        },
        { priority: BINANCE_REST_PRIORITY.RANGE_EXIT }
      );
    } catch (e) {
      console.error('[RangeEventEngine] exit', e);
      return null;
    } finally {
      // 不把「持仓完成」小结占住主状态；出场结束后收回稳态文案
      if (state.running && !deps.aborted?.()) {
        deps.onStatus?.(steadyStatus());
      }
    }
  };

  /** 队列里已有全量出场时，吞掉单币轻判，避免挂单后账户事件再排一轮导致重复止盈 */
  let pendingFullExit = false;
  const pendingLightSymbols = new Set();

  const enqueueExitRound = (label, symbols = null) => {
    const list = Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()).filter(Boolean) : [];
    const isFull = !list.length;
    if (isFull) {
      pendingFullExit = true;
      pendingLightSymbols.clear();
    } else if (pendingFullExit) {
      // 全量已在路上，单币不必再排
      return state.exitRoundTail;
    } else {
      list.forEach(s => pendingLightSymbols.add(s));
    }
    const job = state.exitRoundTail.then(async () => {
      if (!state.running || deps.aborted?.()) return null;
      try {
        if (isFull) {
          pendingFullExit = false;
          return await runExitForSymbols(null, label);
        }
        const batch = [...pendingLightSymbols];
        pendingLightSymbols.clear();
        if (!batch.length) return null;
        // 多个轻判合并成一次 onlySymbols，减少重复读镜像
        return await runExitForSymbols(batch, label || `持仓：${batch.length}币…`);
      } finally {
        // 全量 round 结束后重新起算 45s；单币轻判不重置 idle（与「账户变更结束后计时」对齐）
        if (isFull) scheduleExitIdleSweep();
      }
    });
    state.exitRoundTail = job.catch(() => null);
    return job;
  };

  const lightExitForSymbol = symbol => {
    const key = String(symbol || '').toUpperCase();
    if (!hasLongPositionInMirror(key)) return;
    const row = ensureSym(key);
    const now = Date.now();
    // 与全量对账共用 exitRoundTail，禁止 quote/REST 轻判与账户事件并行双挂
    if (now - row.lastExitLightAt < EXIT_LIGHT_THROTTLE_MS) return;
    if (pendingFullExit) return;
    row.lastExitLightAt = now;
    enqueueExitRound(`持仓：${key}…`, [key]);
  };

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
      markFresh(key);
      touched.push(key);
    });
    if (touched.length) markSeenBatch(touched);

    quoteChain = quoteChain
      .then(async () => {
        for (const key of touched) {
          if (!state.running || deps.aborted?.()) break;
          try {
            if (!state.openStop && RANGE_MONITOR_SCAN_ENABLED) {
              await runSymbolAction(key);
            } else {
              // 开仓中止后仍做清理
              await runSymbolAction(key);
            }
            await lightExitForSymbol(key);
          } catch (e) {
            console.error('[RangeEventEngine] quote', key, e);
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
      if (row.phase === 'fetching' || row.phase === 'queued') return;
      if (!(row.expireAt > 0) || now < row.expireAt) return;
      const pri = isNearBandPriority(symbol) ? PRI.NEAR : PRI.NORMAL;
      enqueue(symbol, pri);
    });
  };

  const pumpRestQueue = async () => {
    if (!state.running || deps.aborted?.() || state.restInflight) return;
    if (!state.queue.size) return;
    if (shouldThrottleBinanceBackground() || isBinanceAccountMirrorRestInflight()) {
      // 刷新「让路中」文案；否则队头币名一直不动像卡死
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

      // 与暴涨同币合并：need=lookback，可吞掉对方的 today 需求
      const restPriority = job.promoted
        ? BINANCE_REST_PRIORITY.DAY_K_OVERDUE
        : BINANCE_REST_PRIORITY.DAY_K_EXPIRE;
      const result = await requestDayKRest(key, {
        need: DAY_K_NEED.LOOKBACK,
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
        await runSymbolAction(key);
        await lightExitForSymbol(key);
      }
    } catch (e) {
      console.warn('[RangeEventEngine] rest', key, e);
      markFresh(key);
    } finally {
      state.restInflight = false;
      emitQueueStatus();
      emitStats();
    }
  };

  const onAccountChange = () => {
    if (!state.running || deps.aborted?.()) return;
    // 45s 内又有账户变更：打断 idle 倒计时，等本轮 round 结束后再重新计时
    clearExitIdleSweep();
    if (state.accountDebounce) clearTimeout(state.accountDebounce);
    state.accountDebounce = setTimeout(() => {
      state.accountDebounce = null;
      enqueueExitRound('持仓：账户变更…', null);
    }, EXIT_ACCOUNT_DEBOUNCE_MS);
  };

  const start = async ({ pairs, resetCoverage = false } = {}) => {
    if (state.running) return;
    state.running = true;
    state.openStop = false;
    resetRoundFunnel();
    if (pairs) setPairs(pairs);
    try {
      state.stockSymbols = await loadStockSymbolSet();
    } catch (e) {
      console.warn('[RangeEventEngine] stock list', e);
      state.stockSymbols = new Set();
    }
    markAllFresh();
    state.seenThisRound.clear();
    state.coverageRoundStartedAt = Date.now();
    if (resetCoverage) {
      state.coverageRounds = 0;
      state.coverageRoundSumMs = 0;
      state.avgCoverageRoundMs = null;
    }
    emitStats();
    deps.onStatus?.(steadyStatus());

    state.unsubAccount = subscribeBinanceAccountMirrorChanges(() => {
      onAccountChange();
    });

    state.tickTimer = setInterval(() => {
      if (!state.running || deps.aborted?.()) return;
      if (utcDayKey() !== deps.getDayKey?.()) {
        deps.onDayRollover?.();
        return;
      }
      sweepExpired();
      promoteStaleDayKJobs();
      pumpRestQueue();
    }, TICK_MS);

    // 启动立刻全量对账；round 结束后由 enqueueExitRound 起算 idle 45s
    enqueueExitRound('持仓：启动对账…', null);
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
    if (state.unsubAccount) {
      state.unsubAccount();
      state.unsubAccount = null;
    }
    state.queue.clear();
    emitQueueStatus();
  };

  const rearmFresh = () => {
    if (!state.running) return;
    state.openStop = false;
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
      actionChecks: state.actionChecks,
      restDone: state.restDone,
      queueDepth: state.queue.size,
      lastRestAt: state.lastRestAt,
      lastRestSymbol: state.lastRestSymbol,
      lastEventAt: state.lastEventAt,
      tracked: state.symbols.size,
      funnel: snapshotRoundFunnel(
        state.roundFunnel,
        state.seenThisRound.size
      ),
      openStop: state.openStop,
      ...coverageSnapshot(),
    }),
  };
};
