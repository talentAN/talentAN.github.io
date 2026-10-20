/**
 * 暴涨100 扫轮 hook：冷建日K → 事件引擎（bookTicker / 过期补K / 自动开空 / 空头止盈）。
 */
import { useEffect, useRef, useState } from 'react';
import { getMergedTradingPairs } from '@root/src/container/market';
import {
  EXIT_REASON_LABEL,
  STATUS_LABEL,
  SKIP_REASON_LABEL,
  SUBMITTING_STALE_MS,
  buildLadderPlan,
  submitLadderPlan,
  checkExistingExposure,
  checkFundingRate,
  checkHigh100Eligibility,
  reconcileLadderBatchWithMirror,
} from './_autoOrderModel';
import { getBinanceTradeQueueSnapshot } from '../_binanceTradeQueue';
import {
  acquireBinanceAccountMirror,
  releaseBinanceAccountMirror,
  refreshBinanceAccountMirror,
  getBinanceAccountSnapshot,
  subscribeBinanceAccountMirrorChanges,
} from '@root/src/container/binance/accountMirror';
import { filterBlacklistedPairs } from '../_symbolBlacklist';
import {
  scheduleMonitorAutoRecover,
  forceEnableBothMonitors,
} from '../_monitorAutoRecover';
import {
  loadSharedMonitorRunning,
  subscribeSharedMonitorRunning,
} from '../_sharedMonitorControl';
import {
  ensureSharedDayKColdBuild,
  listSharedColdPairsForSurge,
  MONITORS_DAYK_COLD_READY,
} from '../_sharedDayKColdBuild';
import { getSharedMiniTickerFeed } from '../low_vol_range_blast/_rangeMonitorPriceFeed';
import { getSurgeDayCacheMeta, surgeUtcDayKey } from './_surgeDayCache';
import { createSurgeEventEngine } from './_surgeEventEngine';
import {
  EXIT_TIPS_MAX,
  todayKey,
  sleep,
  fmtTime,
  loadMonitorRunning,
  saveMonitorRunning,
  playAlertSound,
  bringTabToFront,
} from './_surgeAlertShared';

/** 定时热刷新币对列表的间隔（不拆引擎） */
const PAIRS_REFRESH_MS = 45 * 60 * 1000;

/**
 * @param {{
 *   pctRef: React.MutableRefObject<number>,
 *   autoOrderPctRef: React.MutableRefObject<number>,
 *   autoOrderEnabledRef: React.MutableRefObject<boolean>,
 *   autoBatchesRef: React.MutableRefObject<Map<string, object>>,
 *   autoOrderInFlightRef: React.MutableRefObject<Set<string>>,
 *   syncAutoBatches: () => object[],
 *   setExpanded: (updater: any) => void,
 * }} deps
 */
export const useSurgeMonitor = ({
  pctRef,
  autoOrderPctRef,
  autoOrderEnabledRef,
  autoBatchesRef,
  autoOrderInFlightRef,
  syncAutoBatches,
  setExpanded,
}) => {
  /** 当前命中告警（按涨幅排序后的数组） */
  const [alerts, setAlerts] = useState([]);
  /** 主状态条文案 */
  const [status, setStatus] = useState(() => (loadMonitorRunning() ? '启动中…' : '已停止'));
  /** 过期补K队列状态文案 */
  const [reconcileStatus, setReconcileStatus] = useState('');
  /** 共用交易队状态文案 */
  const [tradeQueueStatus, setTradeQueueStatus] = useState('');
  /** 最近一次行情事件时间 */
  const [lastPoll, setLastPoll] = useState(null);
  /** bookTicker 全表覆盖轮次 */
  const [scanRounds, setScanRounds] = useState(0);
  /** 本覆盖轮尚未见到 push 的币数 */
  const [pendingCount, setPendingCount] = useState(0);
  /** 监控币对总数 */
  const [pairTotal, setPairTotal] = useState(0);
  /** 平均每覆盖轮耗时（ms） */
  const [avgRoundMs, setAvgRoundMs] = useState(null);
  /** 未覆盖符号（少时才填） */
  const [pendingSymbols, setPendingSymbols] = useState([]);
  /** 监控是否在跑（与横盘共用） */
  const [running, setRunning] = useState(() => loadMonitorRunning());
  /** 空头出场 tip（新在前） */
  const [exitTips, setExitTips] = useState([]);

  useEffect(
    () =>
      subscribeSharedMonitorRunning(next => {
        setRunning(next);
        if (next) setStatus(prev => (prev === '已停止' ? '启动中…' : prev));
        else {
          setStatus('已停止');
          setReconcileStatus('');
          setTradeQueueStatus('');
        }
      }),
    []
  );

  /** 当日已弹过音/通知的「日:币」集合，防同币重复吵 */
  const notifiedRef = useRef(new Set());
  /** 命中字典 exchange:symbol → alert（权威源） */
  const alertsMapRef = useRef(new Map());
  /** true=本轮 effect 已 abort，异步路径应退出 */
  const abortRef = useRef(false);
  /** 事件引擎实例 */
  const engineRef = useRef(null);
  /** 当前 UTC 日键；切日触发重建 */
  const dayKeyRef = useRef(surgeUtcDayKey());
  /** 重建入口（utc/pairs/start），供引擎切日回调 */
  const rebuildRef = useRef(null);

  useEffect(() => {
    if (!running) return undefined;

    abortRef.current = false;
    const feed = getSharedMiniTickerFeed();
    feed.start();
    acquireBinanceAccountMirror().catch(e => {
      console.warn('[SurgeAlert] account mirror start', e);
    });

    /** Map → 按涨幅降序的 alerts state */
    const syncAlerts = () => {
      const list = Array.from(alertsMapRef.current.values()).sort(
        (a, b) => b.ratio - a.ratio
      );
      setAlerts(list);
      return list;
    };

    /**
     * 写入/更新命中；若当日首次命中该币则返回 next（供通知），否则 null。
     */
    const applyHit = hit => {
      const key = `${hit.exchange}:${hit.symbol}`;
      const prev = alertsMapRef.current.get(key);
      const alertedAt = prev?.alertedAt || Date.now();
      const next = { ...hit, alertedAt };
      alertsMapRef.current.set(key, next);

      const notifyKey = `${todayKey()}:${hit.symbol}`;
      if (!notifiedRef.current.has(notifyKey)) {
        notifiedRef.current.add(notifyKey);
        return next;
      }
      return null;
    };

    /** 涨幅回落阈值下时从告警表删掉 */
    const clearHit = pair => {
      alertsMapRef.current.delete(`${pair.exchange}:${pair.symbol}`);
    };

    /** 这类跳过当天不再重试（ATH/上市过新） */
    const TERMINAL_SKIP_REASONS = new Set(['ath_breakout', 'listing_too_new']);

    /** 写入 skipped 批次；同因重复跳过返回 null（不重复提醒） */
    const commitSkip = (batchKey, existing, skipped) => {
      const isRepeat =
        existing?.status === 'skipped' && existing.skipReason === skipped.skipReason;
      const next = {
        ...skipped,
        createdAt: isRepeat ? existing.createdAt || Date.now() : Date.now(),
        checkedAt: Date.now(),
      };
      autoBatchesRef.current.set(batchKey, next);
      syncAutoBatches();
      return isRepeat ? null : { type: 'skipped', batch: next };
    };

    /**
     * 自动开空主路径：资格 → 敞口 → 费率 → 阶梯提交 → 立刻 REST 对账。
     * 返回 { type, batch } 供通知；多数闸门跳过返回 null。
     */
    const handleAutoOrder = async info => {
      const batchKey = `${todayKey()}:${info.exchange}:${info.symbol}`;
      let existing = autoBatchesRef.current.get(batchKey);
      if (autoOrderInFlightRef.current.has(batchKey)) return null;

      try {
        // submitting 超时 → unknown（可能已成交）：禁止自动重试，避免双挂
        if (existing?.status === 'submitting') {
          const started = Number(
            existing.eligStartedAt || existing.queuedAt || existing.checkedAt || existing.createdAt || 0
          );
          if (!(started > 0) || Date.now() - started >= SUBMITTING_STALE_MS) {
            existing = {
              ...existing,
              status: 'unknown',
              skipDetail: existing.skipDetail || '提交超时，请人工核对委托',
              checkedAt: Date.now(),
            };
            autoBatchesRef.current.set(batchKey, existing);
            syncAutoBatches();
            return { type: 'skipped', batch: existing };
          }
          return null;
        }

        if (
          existing &&
          (existing.status === 'open' ||
            existing.status === 'partial' ||
            existing.status === 'filled')
        ) {
          return null;
        }

        // unknown：结果待确认，绝不能再 submitLadderPlan
        if (
          existing &&
          existing.status !== 'skipped' &&
          existing.status !== 'failed' &&
          existing.status !== 'missing'
        ) {
          return null;
        }

        if (
          existing?.status === 'skipped' &&
          TERMINAL_SKIP_REASONS.has(existing.skipReason)
        ) {
          return null;
        }

        if (
          existing &&
          (existing.status === 'skipped' ||
            existing.status === 'failed' ||
            existing.status === 'missing') &&
          Date.now() - (existing.checkedAt || existing.reconciledAt || existing.createdAt || 0) <
            60000
        ) {
          return null;
        }

        const autoThreshold = 1 + autoOrderPctRef.current / 100;
        if (info.ratio < autoThreshold) return null;

        autoOrderInFlightRef.current.add(batchKey);
        const now = Date.now();
        const submittingBatch = {
          ...(existing || {}),
          id: batchKey,
          symbol: info.symbol,
          exchange: info.exchange,
          status: 'submitting',
          skipReason: undefined,
          skipDetail: undefined,
          createdAt: existing?.createdAt || now,
          queuedAt: Number(info.queuedAt) > 0 ? Number(info.queuedAt) : existing?.queuedAt || now,
          eligStartedAt: now,
        };
        autoBatchesRef.current.set(batchKey, submittingBatch);
        syncAutoBatches();

        const eligibility = await checkHigh100Eligibility({
          symbol: info.symbol,
          exchange: info.exchange,
          candleTs: info.candleTs,
          open: info.open,
          high: info.high,
        });
        if (!eligibility.allowed) {
          return commitSkip(batchKey, existing, {
            id: batchKey,
            symbol: info.symbol,
            exchange: info.exchange,
            status: 'skipped',
            skipReason: eligibility.reason,
            queuedAt: submittingBatch.queuedAt,
            eligStartedAt: submittingBatch.eligStartedAt,
            ...(Number.isFinite(eligibility.listingDays)
              ? { listingDays: eligibility.listingDays }
              : {}),
            ...(Number.isFinite(eligibility.athProbe) ? { athProbe: eligibility.athProbe } : {}),
            ...(Number.isFinite(eligibility.prevAth) ? { prevAth: eligibility.prevAth } : {}),
            ...(eligibility.prevAthDate ? { prevAthDate: eligibility.prevAthDate } : {}),
            ...(Number.isFinite(eligibility.open) ? { open: eligibility.open } : {}),
            ...(Number.isFinite(eligibility.high) ? { high: eligibility.high } : {}),
          });
        }

        const exposure = await checkExistingExposure({
          symbol: info.symbol,
          exchange: info.exchange,
          side: 'short',
        });
        if (exposure.exposed) {
          return commitSkip(batchKey, existing, {
            id: batchKey,
            symbol: info.symbol,
            exchange: info.exchange,
            status: 'skipped',
            skipReason: exposure.reason,
            queuedAt: submittingBatch.queuedAt,
            eligStartedAt: submittingBatch.eligStartedAt,
            ...(exposure.detail ? { skipDetail: exposure.detail } : {}),
          });
        }

        const funding = await checkFundingRate({
          symbol: info.symbol,
          exchange: info.exchange,
        });
        if (!funding.allowed) {
          return commitSkip(batchKey, existing, {
            id: batchKey,
            symbol: info.symbol,
            exchange: info.exchange,
            status: 'skipped',
            skipReason: funding.reason,
            queuedAt: submittingBatch.queuedAt,
            eligStartedAt: submittingBatch.eligStartedAt,
            ...(Number.isFinite(funding.fundingRate)
              ? { fundingRate: funding.fundingRate }
              : {}),
            ...(funding.detail || funding.error
              ? { skipDetail: funding.detail || funding.error }
              : {}),
          });
        }

        const plan = buildLadderPlan({
          symbol: info.symbol,
          exchange: info.exchange,
          open: info.open,
          triggerHigh: info.high,
          candleTs: info.candleTs,
        });
        const pendingBatch = {
          ...plan,
          id: batchKey,
          status: 'submitting',
          queuedAt: submittingBatch.queuedAt,
          eligStartedAt: submittingBatch.eligStartedAt,
        };
        autoBatchesRef.current.set(batchKey, pendingBatch);
        syncAutoBatches();

        try {
          let submitted = {
            ...(await submitLadderPlan(plan)),
            id: batchKey,
            queuedAt: pendingBatch.queuedAt,
            eligStartedAt: pendingBatch.eligStartedAt,
            submittedAt: Date.now(),
          };
          // 立刻 REST 对账：避免「本地已挂单、币安无单」假阳性挂很久
          try {
            const snap = await refreshBinanceAccountMirror();
            submitted = reconcileLadderBatchWithMirror(submitted, snap, { graceMs: 0 });
          } catch (re) {
            console.warn('[SurgeAlert][AutoOrder] reconcile after submit', batchKey, re);
          }
          autoBatchesRef.current.set(batchKey, submitted);
          syncAutoBatches();
          return { type: 'submitted', batch: submitted };
        } catch (e) {
          console.error('[SurgeAlert][AutoOrder] submit', batchKey, e);
          // 若 map 里已是成交态（set 成功但后续抛错），禁止降级为 failed 再触发重试双挂
          const current = autoBatchesRef.current.get(batchKey);
          if (
            current &&
            (current.status === 'open' ||
              current.status === 'partial' ||
              current.status === 'unknown')
          ) {
            return { type: 'submitted', batch: current };
          }
          // 提交过程异常且无明确结果 → unknown，人工核对；勿 failed 自动重试
          const ambiguous = {
            ...pendingBatch,
            status: 'unknown',
            skipDetail: e?.message || String(e),
            createdAt: pendingBatch.createdAt || Date.now(),
            checkedAt: Date.now(),
          };
          autoBatchesRef.current.set(batchKey, ambiguous);
          syncAutoBatches();
          return { type: 'skipped', batch: ambiguous };
        }
      } catch (e) {
        console.error('[SurgeAlert][AutoOrder] unexpected', batchKey, e);
        const current = autoBatchesRef.current.get(batchKey);
        // 已写入成交/待确认结果时不得覆盖
        if (
          current &&
          (current.status === 'open' ||
            current.status === 'partial' ||
            current.status === 'unknown')
        ) {
          return { type: 'submitted', batch: current };
        }
        // 资格/费率等前置异常：failed → 60s 后可重试（此时尚未 submitLadderPlan）
        const failed = {
          id: batchKey,
          symbol: info.symbol,
          exchange: info.exchange,
          status: 'failed',
          skipDetail: e?.message || String(e),
          createdAt: current?.createdAt || existing?.createdAt || Date.now(),
          checkedAt: Date.now(),
          queuedAt: current?.queuedAt || existing?.queuedAt,
          eligStartedAt: current?.eligStartedAt || existing?.eligStartedAt,
        };
        autoBatchesRef.current.set(batchKey, failed);
        syncAutoBatches();
        return { type: 'skipped', batch: failed };
      } finally {
        autoOrderInFlightRef.current.delete(batchKey);
      }
    };
const notifyBatchResult = (freshHits, orderEvents) => {
      if (freshHits.length || orderEvents.some(e => e.type === 'submitted')) {
        const hitLabels = freshHits.slice(0, 3).map(item => {
          const pct = `+${((item.ratio - 1) * 100).toFixed(0)}%`;
          const at = item.alertedAt ? ` 提醒${fmtTime(item.alertedAt)}` : '';
          return `${item.symbol}(${pct})${at}`;
        });
        const orderLabels = orderEvents
          .filter(e => e.type === 'submitted')
          .slice(0, 3)
          .map(e => {
            const at = e.batch?.submittedAt
              ? ` ${fmtTime(e.batch.submittedAt)}`
              : e.batch?.queuedAt
                ? ` ${fmtTime(e.batch.queuedAt)}`
                : '';
            return `${e.batch.symbol}已自动挂单${at}`;
          });
        const label = [...hitLabels, ...orderLabels].slice(0, 3).join(' ');
        setExpanded(true);
        playAlertSound();
        bringTabToFront(label);
      } else if (orderEvents.some(e => e.type === 'skipped')) {
        setExpanded(true);
      }
    };

    const onExitResult = result => {
      if (!result?.tips?.length) return;
      const stamped = result.tips.map(text => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        text,
      }));
      setExitTips(prev => [...stamped, ...prev].slice(0, EXIT_TIPS_MAX));
      if (result.failed > 0) setExpanded(true);
    };

    const engine = createSurgeEventEngine({
      pctRef,
      autoOrderPctRef,
      autoOrderEnabledRef,
      aborted: () => abortRef.current,
      priceFeed: feed,
      onStatus: setStatus,
      onQueueStatus: setReconcileStatus,
      onStats: stats => {
        setScanRounds(stats.coverageRounds || 0);
        setPendingCount(stats.pendingCount || 0);
        setPairTotal(stats.pairTotal || 0);
        setPendingSymbols(
          Array.isArray(stats.pendingSymbols) ? stats.pendingSymbols : []
        );
        setAvgRoundMs(
          Number.isFinite(stats.avgCoverageRoundMs) ? stats.avgCoverageRoundMs : null
        );
        if (stats.lastEventAt) setLastPoll(new Date(stats.lastEventAt));
        const tq = stats.tradeQueue || getBinanceTradeQueueSnapshot();
        if (tq?.depth > 0 || tq?.currentJobKey) {
          const head = tq.currentJobKey || tq.headKeys?.[0] || '';
          setTradeQueueStatus(
            `交易队 ${tq.depth}${head ? ` · ${head}` : ''}`
          );
        } else {
          setTradeQueueStatus('');
        }
      },
      applyHit,
      clearHit,
      handleAutoOrder,
      notifyBatchResult,
      syncAlerts,
      onExitResult,
      getDayKey: () => dayKeyRef.current,
      onDayRollover: () => {
        rebuildRef.current?.('utc');
      },
    });
    engineRef.current = engine;

    let unsubQuotes = () => {};
    let unsubAccount = () => {};
    let pairsTimer = null;
    let stallTimer = null;
    let bootGen = 0;
    /** 最近一次 engine.start 成功的本地时刻；stall 检测用 */
    let engineStartedAt = 0;
    /** 串行化 bootstrap：避免 A.stop() 后被 B 热路径「复用日K」直接 return，引擎永死 */
    let bootChain = Promise.resolve();

    const runBootstrap = async reason => {
      const gen = (bootGen += 1);
      const needColdRebuild = reason === 'start' || reason === 'utc';
      // pairs 定时刷新：仅当引擎仍在跑且日K新鲜时热更新币对（不停引擎）
      // 若 engineRef 在但 isRunning=false（被并发 stop 过），必须冷重建，否则 UI 假活
      if (!needColdRebuild && reason === 'pairs') {
        try {
          const meta = getSurgeDayCacheMeta();
          const eng = engineRef.current;
          if (meta.fresh && eng?.isRunning?.()) {
            setStatus('刷新币对列表…');
            let pairs = await getMergedTradingPairs();
            pairs = filterBlacklistedPairs(pairs).filter(p => p.exchange === 'binance');
            if (abortRef.current || gen !== bootGen) return;
            if (!pairs.length) {
              setStatus('无可用 Binance 币对');
              return;
            }
            // 热刷新途中若被并发 stop，落入下方冷建，禁止「假复用」
            if (eng.isRunning()) {
              eng.setPairs(pairs);
              setPairTotal(pairs.length);
              setStatus(
                `复用日K · 事件驱动 ${pairs.length} 币 · REST 仅过期补K`
              );
              return;
            }
          }
        } catch (e) {
          console.warn('[SurgeAlert] pairs hot refresh', e);
          // 失败则走完整 bootstrap
        }
      }

      if (abortRef.current || gen !== bootGen) return;

      engine.stop();
      // 冷建窗口内勿让 stall 误判「引擎已停」连环入队
      engineStartedAt = 0;
      setReconcileStatus('');
      setTradeQueueStatus('');

      try {
        try {
          setStatus(
            reason === 'utc'
              ? 'UTC 切日，重新冷建…'
              : reason === 'pairs'
                ? '刷新币对并冷建…'
                : '连接行情 Socket…'
          );
          await feed.waitReady(25000);
        } catch (e) {
          console.warn('[SurgeAlert] bookTicker waitReady', e);
        }

        if (abortRef.current || gen !== bootGen) return;

        let pairs = [];
        try {
          setStatus('拉取币对列表…');
          pairs = await getMergedTradingPairs();
          pairs = filterBlacklistedPairs(pairs).filter(p => p.exchange === 'binance');
        } catch (e) {
          console.error('[SurgeAlert] pairs', e);
          setStatus('币对列表拉取失败，重试中…');
          await sleep(3000);
          if (!abortRef.current && gen === bootGen) bootstrap(reason);
          return;
        }

        if (abortRef.current || gen !== bootGen) return;

        if (!pairs.length) {
          setStatus('无可用 Binance 币对，重试中…');
          await sleep(3000);
          if (!abortRef.current && gen === bootGen) bootstrap(reason);
          return;
        }

        dayKeyRef.current = surgeUtcDayKey();
        // 与横盘共用一次 200 日 K 冷建；完成后派发 MONITORS_DAYK_COLD_READY
        const cacheResult = await ensureSharedDayKColdBuild({
          aborted: () => abortRef.current || gen !== bootGen,
          onStatus: setStatus,
          priceFeed: feed,
          force: reason === 'utc',
        });

        if (abortRef.current || gen !== bootGen) return;
        if (cacheResult?.aborted) return;

        const coldPairs = listSharedColdPairsForSurge();
        const enginePairs = coldPairs.length ? coldPairs : pairs;
        if (!enginePairs.length) {
          throw new Error('共用日 K 冷建无可用币对');
        }

        engine.setPairs(enginePairs);
        engine.start({
          pairs: enginePairs,
          resetCoverage: reason === 'start' || reason === 'utc',
        });
        engineStartedAt = Date.now();
        setLastPoll(new Date());
        setPairTotal(enginePairs.length);
        setPendingCount(enginePairs.length);
        setPendingSymbols([]);
        const via = cacheResult?.fromCache ? '复用日K' : '共用冷建完成';
        setStatus(
          `${via} · 事件驱动 ${enginePairs.length} 币 · REST 仅过期补K`
        );
        console.info(`[SurgeAlert] ${MONITORS_DAYK_COLD_READY}`, {
          fromCache: cacheResult?.fromCache,
          size: enginePairs.length,
        });
      } catch (e) {
        if (abortRef.current) return;
        console.error('[SurgeAlert] bootstrap', e);
        abortRef.current = true;
        setRunning(false);
        setStatus(`异常恢复中：${e?.message || e}`);
        forceEnableBothMonitors();
        scheduleMonitorAutoRecover({
          title: e?.message || String(e),
          detail: e?.stack || String(e),
          source: '暴涨监控',
        });
      }
    };

    const bootstrap = reason => {
      bootChain = bootChain
        .then(() => runBootstrap(reason))
        .catch(e => {
          console.error('[SurgeAlert] bootstrap chain', e);
        });
      return bootChain;
    };

    rebuildRef.current = bootstrap;

    unsubQuotes = feed.subscribeQuotes(symbols => {
      engine.onQuotes(symbols);
    });
    const reconcileOpenBatches = async ({ forceRest = false } = {}) => {
      try {
        const snap = forceRest
          ? await refreshBinanceAccountMirror()
          : await getBinanceAccountSnapshot();
        if (!snap?.ok) return;
        let changed = false;
        autoBatchesRef.current.forEach((batch, key) => {
          if (!batch || batch.exchange !== 'binance') return;
          if (!['open', 'partial', 'unknown', 'missing', 'filled'].includes(batch.status)) {
            return;
          }
          const next = reconcileLadderBatchWithMirror(batch, snap);
          if (next !== batch) {
            autoBatchesRef.current.set(key, next);
            changed = true;
          }
        });
        if (changed) syncAutoBatches();
      } catch (e) {
        console.warn('[SurgeAlert] reconcileOpenBatches', e);
      }
    };

    unsubAccount = subscribeBinanceAccountMirrorChanges(() => {
      engine.onAccountChange();
      reconcileOpenBatches();
    });
    // 启动后对账一次本地持久化的「已挂单」
    reconcileOpenBatches({ forceRest: true });

    bootstrap('start');

    pairsTimer = setInterval(() => {
      if (!abortRef.current) bootstrap('pairs');
    }, PAIRS_REFRESH_MS);

    // 引擎假活检测：
    // 1) React running 但 engine 已 stop → 立刻冷重建
    // 2) engine 在跑但 bookTicker 长时间未进 onQuotes → 冷重建
    // lastEventAt 在 start() 清零；用 engineStartedAt 兜底「启动后从未收到事件」
    const STALL_MS = 90_000;
    stallTimer = setInterval(() => {
      if (abortRef.current) return;
      const eng = engineRef.current;
      if (!eng) return;
      if (!eng.isRunning?.()) {
        // 冷建中途也会 stop；仅当已成功 start 过且非刚停，才重建
        if (!(engineStartedAt > 0)) return;
        setStatus('事件引擎已停，自动重建…');
        bootstrap('pairs');
        return;
      }
      const stats = eng.getStats?.() || {};
      const lastAt = Number(stats.lastEventAt) || 0;
      const anchor = lastAt > 0 ? lastAt : engineStartedAt;
      if (!(anchor > 0) || Date.now() - anchor <= STALL_MS) return;
      console.warn('[SurgeAlert] quote stall, rebuild', {
        idleMs: Date.now() - anchor,
        pending: stats.pendingCount,
        rounds: stats.coverageRounds,
        hadEvent: lastAt > 0,
      });
      setStatus(
        `行情事件停滞 ${Math.round((Date.now() - anchor) / 1000)}s，重建…`
      );
      bootstrap('pairs');
    }, 15_000);

    return () => {
      abortRef.current = true;
      bootGen += 1;
      engine.stop();
      engineRef.current = null;
      unsubQuotes();
      unsubAccount();
      if (pairsTimer) clearInterval(pairsTimer);
      if (stallTimer) clearInterval(stallTimer);
      setReconcileStatus('');
      releaseBinanceAccountMirror();
      try {
        if (!loadSharedMonitorRunning()) feed.stop();
      } catch (_) {
        feed.stop();
      }
    };
    // refs 稳定；syncAutoBatches / setExpanded 已用 useCallback / useState 稳定化
  }, [running, syncAutoBatches, setExpanded]);

  const stopMonitor = () => {
    abortRef.current = true;
    engineRef.current?.stop();
    saveMonitorRunning(false);
    setRunning(false);
    setStatus('已停止');
    setReconcileStatus('');
    setTradeQueueStatus('');
  };

  const startMonitor = () => {
    saveMonitorRunning(true);
    setStatus('启动中…');
    setRunning(true);
  };

  const dismiss = (exchange, symbol) => {
    alertsMapRef.current.delete(`${exchange}:${symbol}`);
    setAlerts(prev => prev.filter(a => !(a.exchange === exchange && a.symbol === symbol)));
  };

  /** 涨幅阈值变更：清空命中；事件路径下一次 quote/补K 即按新阈值判定 */
  const onThresholdChanged = () => {
    alertsMapRef.current.clear();
    setAlerts([]);
    notifiedRef.current.clear();
    if (running) {
      engineRef.current?.rearmFresh();
      setStatus('阈值已更新，等待行情事件…');
    }
  };

  return {
    alerts,
    status,
    reconcileStatus,
    tradeQueueStatus,
    lastPoll,
    scanRounds,
    pendingCount,
    pairTotal,
    pendingSymbols,
    avgRoundMs,
    running,
    exitTips,
    setExitTips,
    startMonitor,
    stopMonitor,
    /** 从告警列表去掉某币 */
    dismiss,
    /** 告警阈值变更后清命中并 rearm */
    onThresholdChanged,
    alertsMapRef,
    STATUS_LABEL,
    SKIP_REASON_LABEL,
    EXIT_REASON_LABEL,
  };
};
