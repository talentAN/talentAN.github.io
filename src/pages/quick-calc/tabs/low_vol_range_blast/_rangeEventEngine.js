/**
 * 横盘监控事件引擎：
 * - 冷建日 K 后：bookTicker → 盒子评估 → 节流清理/近带开仓
 * - 无推送过期（10s+jitter）→ REST 回看日 K 队列
 * - 账户镜像变更 / 定时兜底 → 持仓出场（复用 runRangeMonitorPositionStops）
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
import {
  fetchAndCacheMonitorCandles,
  utcDayKey,
} from './_rangeMonitorCandleCache';
import { evalRangeBox } from './_rangeBoxEval';
import {
  handleRangeSymbolPriceEvent,
  hasLongPositionInMirror,
  peekMirrorSnapshot,
  shouldEnqueueRangeTradeAction,
} from './_rangeEventActions';
import { runRangeMonitorPositionStops } from './_rangeMonitorEngine';
import { RANGE_MONITOR_SCAN_ENABLED } from './_rangeMonitorParams';
import { enqueueBinanceTradeJob } from '../_binanceTradeQueue';

const FRESH_TTL_MS = 10_000;
const FRESH_JITTER_MS = 10_000;
const NEAR_TTL_MS = 5_000;
const NEAR_JITTER_MS = 5_000;
const ACTION_THROTTLE_MS = 400;
const EXIT_LIGHT_THROTTLE_MS = 3_000;
const TICK_MS = 500;
const EXIT_SWEEP_MS = 45_000;
const EXIT_ACCOUNT_DEBOUNCE_MS = 800;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const hashJitter = (symbol, maxMs) => {
  const s = String(symbol || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return maxMs > 0 ? h % (maxMs + 1) : 0;
};

const PRI = { NEAR: 3, MISS: 2, HAS_ORDER: 2, NORMAL: 1 };

/** 本覆盖轮漏斗：按币去重，与 pending/pairTotal 同一轮口径 */
const createEmptyRoundFunnel = () => ({
  hits: new Set(),
  nearBandIn: new Set(),
  nearBandBusy: new Set(),
  /** 近带已入交易队、开仓结果尚未回来 */
  nearBandPending: new Set(),
  minNotionalSkip: new Set(),
  placeSkipped: new Set(),
  brokeOut: new Set(),
  placed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
});

const snapshotRoundFunnel = (funnel, seenSize) => ({
  scanned: seenSize,
  hits: funnel.hits.size,
  nearBandIn: funnel.nearBandIn.size,
  nearBandBusy: funnel.nearBandBusy.size,
  nearBandPending: funnel.nearBandPending.size,
  minNotionalSkip: funnel.minNotionalSkip.size,
  placeSkipped: funnel.placeSkipped.size,
  brokeOut: funnel.brokeOut.size,
  placed: funnel.placed.size,
  cancelled: funnel.cancelled.size,
  failed: funnel.failed.size,
});

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
    sweepTimer: null,
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
      // 新覆盖轮：漏斗与顶部进度一并清零
      resetRoundFunnel();
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
    state.queue.set(key, { symbol: key, priority, enqueuedAt: Date.now() });
    emitQueueStatus();
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
          state.roundFunnel.placeSkipped.add(sym);
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

    // 远带且无 lvb 单：只更新漏斗，不进交易队（避免灌爆拖死 SURGE_OPEN）
    if (!shouldEnqueueRangeTradeAction(key, box)) return;

    // 近带：先记「待挂」，交易队跑完再清——避免漏斗出现「近带4、挂0」像没下单
    if (box.nearBand) state.roundFunnel.nearBandPending.add(key);

    // 清理校验+撤单 / 近带开仓校验+挂单 → 交易队（优先低于 SURGE_OPEN / EXIT）
    enqueueBinanceTradeJob(`RANGE:${key}`, async () => {
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
        if (result?.open?.acted) state.roundFunnel.placed.add(key);
        if (openReason === 'broke_out') state.roundFunnel.brokeOut.add(key);
        if (openReason === 'failed' || openReason === 'account_stop') {
          state.roundFunnel.failed.add(key);
        }
        // 近带入队后未挂成、也非名义/破/败：计入下单跳过（far_band/slot_full/…）
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
          state.roundFunnel.placeSkipped.add(key);
        }
        return result;
      } finally {
        state.roundFunnel.nearBandPending.delete(key);
        emitStats();
      }
    }).catch(e => {
      state.roundFunnel.nearBandPending.delete(key);
      console.error('[RangeEventEngine] tradeQueue', key, e);
      emitStats();
    });
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
      // 出场 xx 校验 + 止盈/止损/追踪挂撤 → 高优队
      return await enqueueBinanceTradeJob(jobKey, async () => {
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
      });
    } catch (e) {
      console.error('[RangeEventEngine] exit', e);
      return null;
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
      if (isFull) {
        pendingFullExit = false;
        return runExitForSymbols(null, label);
      }
      const batch = [...pendingLightSymbols];
      pendingLightSymbols.clear();
      if (!batch.length) return null;
      // 多个轻判合并成一次 onlySymbols，减少重复读镜像
      return runExitForSymbols(batch, label || `持仓：${batch.length}币…`);
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

      const pair = state.pairsBySymbol.get(key) || {
        exchange: 'binance',
        symbol: key,
      };
      const candles = await fetchAndCacheMonitorCandles(pair, deps.priceFeed);
      if (candles && state.running && !deps.aborted?.()) {
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
    if (resetCoverage) state.coverageRounds = 0;
    emitStats();
    deps.onStatus?.(
      `事件驱动中 · 跟踪 ${state.pairsBySymbol.size} 币 · 过期补K`
    );

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
      pumpRestQueue();
    }, TICK_MS);

    state.sweepTimer = setInterval(() => {
      if (!state.running || deps.aborted?.()) return;
      enqueueExitRound('持仓：定时对账…', null);
    }, EXIT_SWEEP_MS);

    // 启动后立刻对账一次持仓出场
    enqueueExitRound('持仓：启动对账…', null);
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
