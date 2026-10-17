/**
 * 横盘监控：冷建 → 事件驱动（bookTicker / 过期补K / 账户出场）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  acquireBinanceAccountMirror,
  releaseBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import { scheduleMonitorAutoRecover, forceEnableBothMonitors } from '../_monitorAutoRecover';
import {
  RangeMonitorFatal,
  getSharedMiniTickerFeed,
} from './_rangeMonitorEngine';
import {
  ensureRangeMonitorCandleCache,
  listCachedMonitorPairs,
  utcDayKey,
} from './_rangeMonitorCandleCache';
import { createRangeEventEngine } from './_rangeEventEngine';
import {
  LIST_LIMIT,
  loadMonitorRunning,
  saveMonitorRunning,
  pairKeyOf,
  tipKeyOf,
} from './_rangeMonitorShared';

/**
 * @param {{
 *   maxMultRef: React.MutableRefObject<number>,
 *   nearBandPctRef: React.MutableRefObject<number>,
 *   applyMaxMult: (raw: string) => boolean,
 *   applyNearBandPct: (raw: string) => boolean,
 *   maxMultInput: string,
 *   nearBandInput: string,
 * }} deps
 */
export const useRangeMonitorLoop = ({
  maxMultRef,
  nearBandPctRef,
  applyMaxMult,
  applyNearBandPct,
  maxMultInput,
  nearBandInput,
}) => {
  const [running, setRunning] = useState(() => loadMonitorRunning());
  const [status, setStatus] = useState(() =>
    loadMonitorRunning() ? '启动中…' : '已停止'
  );
  const [queueStatus, setQueueStatus] = useState('');
  const [lastRound, setLastRound] = useState(null);
  const [lastRoundMs, setLastRoundMs] = useState(null);
  const [exitStats, setExitStats] = useState({
    tp1: 0,
    tp2: 0,
    tp3Trail: 0,
    positionCount: 0,
    updatedAt: null,
  });
  const [stats, setStats] = useState({
    round: 0,
    placed: 0,
    cancelled: 0,
    slArmed: 0,
    failed: 0,
    brokeOut: 0,
  });
  const [pendingCount, setPendingCount] = useState(0);
  const [pairTotal, setPairTotal] = useState(0);
  const [pendingSymbols, setPendingSymbols] = useState([]);
  const exitUniqRef = useRef({ tp1: new Set(), tp2: new Set(), tp3Trail: new Set() });
  const uniqStatsRef = useRef({
    placed: new Set(),
    cancelled: new Set(),
    slArmed: new Set(),
    failed: new Set(),
    brokeOut: new Set(),
  });
  const tipSeenRef = useRef(new Set());
  const [lastScanFunnel, setLastScanFunnel] = useState(null);
  const [cancelledList, setCancelledList] = useState([]);
  const [placedList, setPlacedList] = useState([]);
  const [slList, setSlList] = useState([]);
  const [tipList, setTipList] = useState([]);
  const [listCounts, setListCounts] = useState({
    cancelled: 0,
    placed: 0,
    sl: 0,
    tips: 0,
  });
  const abortRef = useRef(false);
  const runningRef = useRef(running);
  const feedSessionRef = useRef(0);
  const engineRef = useRef(null);
  const dayKeyRef = useRef(utcDayKey());
  const rebuildRef = useRef(null);
  runningRef.current = running;

  const rememberUniq = (bucket, entryOrKey) => {
    const key =
      typeof entryOrKey === 'string' ? entryOrKey : pairKeyOf(entryOrKey);
    if (!key || !uniqStatsRef.current[bucket]) return;
    uniqStatsRef.current[bucket].add(key);
  };

  const snapshotUniqStats = round => ({
    round,
    placed: uniqStatsRef.current.placed.size,
    cancelled: uniqStatsRef.current.cancelled.size,
    slArmed: uniqStatsRef.current.slArmed.size,
    failed: uniqStatsRef.current.failed.size,
    brokeOut: uniqStatsRef.current.brokeOut.size,
  });

  const snapshotExitStats = () => ({
    tp1: exitUniqRef.current.tp1.size,
    tp2: exitUniqRef.current.tp2.size,
    tp3Trail: exitUniqRef.current.tp3Trail.size,
    positionCount: exitUniqRef.current.positionCount || 0,
    updatedAt: Date.now(),
  });

  const pushCancelled = entry => {
    rememberUniq('cancelled', entry);
    setListCounts(c => ({ ...c, cancelled: uniqStatsRef.current.cancelled.size }));
    setCancelledList(prev =>
      [{ ...entry, at: Date.now() }, ...prev].slice(0, LIST_LIMIT)
    );
  };
  const pushPlaced = entry => {
    rememberUniq('placed', entry);
    setListCounts(c => ({ ...c, placed: uniqStatsRef.current.placed.size }));
    setPlacedList(prev => [{ ...entry, at: Date.now() }, ...prev].slice(0, LIST_LIMIT));
  };
  const pushExit = entry => {
    if (entry?.type === 'sl_armed') rememberUniq('slArmed', entry);
    setListCounts(c => ({ ...c, sl: c.sl + 1 }));
    setSlList(prev => [{ ...entry, at: Date.now() }, ...prev].slice(0, LIST_LIMIT));
  };
  const pushTip = entry => {
    const key = tipKeyOf(entry);
    if (key && tipSeenRef.current.has(key)) {
      setTipList(prev => {
        const idx = prev.findIndex(item => tipKeyOf(item) === key);
        if (idx < 0) return prev;
        const next = [...prev];
        const cur = next[idx];
        next.splice(idx, 1);
        next.unshift({
          ...cur,
          ...entry,
          at: Date.now(),
          count: (cur.count || 1) + 1,
        });
        return next.slice(0, LIST_LIMIT);
      });
      return;
    }
    if (key) tipSeenRef.current.add(key);
    setListCounts(c => ({ ...c, tips: c.tips + 1 }));
    setTipList(prev =>
      [{ ...entry, at: Date.now(), count: 1 }, ...prev].slice(0, LIST_LIMIT)
    );
  };

  const haltMonitor = (title, detail) => {
    abortRef.current = true;
    engineRef.current?.stop();
    runningRef.current = false;
    setRunning(false);
    try {
      getSharedMiniTickerFeed().stop();
    } catch (_) {
      /* ignore */
    }
    setStatus(`异常恢复中：${title}`);
    forceEnableBothMonitors();
    scheduleMonitorAutoRecover({
      title,
      detail: detail || '',
      source: '横盘监控',
    });
  };

  const onLog = entry => {
    if (entry?.type === 'cancelled') pushCancelled(entry);
    if (entry?.type === 'placed') pushPlaced(entry);
    if (
      entry?.type === 'sl_armed' ||
      entry?.type === 'tp_placed' ||
      entry?.type === 'trail_placed'
    ) {
      pushExit(entry);
    }
    if (entry?.type === 'sl_failed') {
      rememberUniq('failed', entry);
      pushExit(entry);
      message.error(`成本止损失败：BN ${entry.symbol} ${entry.detail || ''}`);
    }
    if (entry?.type === 'tp_failed') {
      rememberUniq('failed', entry);
      pushExit(entry);
      message.error(`止盈失败：BN ${entry.symbol} ${entry.detail || ''}`);
    }
    if (entry?.type === 'trail_failed') {
      rememberUniq('failed', entry);
      pushExit(entry);
      message.error(`追踪失败：BN ${entry.symbol} ${entry.detail || ''}`);
    }
    if (entry?.type === 'skipped') pushTip(entry);
    if (entry?.type === 'min_notional_skip') pushTip(entry);
    if (entry?.type === 'xx_kline_skip') {
      pushTip({
        ...entry,
        detail: `REST 小时 K 暂无，本轮跳过出场 · ${entry.detail || ''}`,
      });
    }
    if (entry?.type === 'xx_kline_rate_limited') pushTip(entry);
    if (entry?.type === 'tp_tier_mismatch') pushTip(entry);
    if (entry?.type === 'broke_out') {
      rememberUniq('brokeOut', entry);
      pushTip(entry);
    }
    if (entry?.type === 'max_stop_limit') {
      rememberUniq('failed', entry);
      const tipKey = tipKeyOf(entry);
      const firstTip = !tipKey || !tipSeenRef.current.has(tipKey);
      pushTip(entry);
      if (firstTip) {
        message.error(
          `开仓账户级中止：${entry.symbol} · ${entry.detail || ''}`
        );
      }
    }
    if (entry?.type === 'failed_stop') {
      rememberUniq('failed', entry);
      const tipKey = tipKeyOf(entry);
      const firstTip = !tipKey || !tipSeenRef.current.has(tipKey);
      pushTip(entry);
      if (firstTip) {
        message.error(
          `开仓失败：${entry.symbol} · ${entry.detail || entry.reason || ''}`
        );
      }
    }
    setStats(prev => snapshotUniqStats(prev.round));
  };

  useEffect(() => {
    if (!running) {
      abortRef.current = true;
      engineRef.current?.stop();
      engineRef.current = null;
      getSharedMiniTickerFeed().stop();
      setQueueStatus('');
      return undefined;
    }

    abortRef.current = false;
    const session = feedSessionRef.current + 1;
    feedSessionRef.current = session;
    const feed = getSharedMiniTickerFeed();
    feed.start();
    acquireBinanceAccountMirror().catch(e => {
      console.warn('[RangeMonitor] account mirror start', e);
    });

    uniqStatsRef.current = {
      placed: new Set(),
      cancelled: new Set(),
      slArmed: new Set(),
      failed: new Set(),
      brokeOut: new Set(),
    };
    tipSeenRef.current = new Set();
    setTipList([]);
    setListCounts(c => ({ ...c, tips: 0 }));
    setStats({
      round: 0,
      placed: 0,
      cancelled: 0,
      slArmed: 0,
      failed: 0,
      brokeOut: 0,
    });

    const engine = createRangeEventEngine({
      maxMultRef,
      nearBandPctRef,
      aborted: () => abortRef.current,
      priceFeed: feed,
      onStatus: setStatus,
      onQueueStatus: setQueueStatus,
      onLog,
      onStats: s => {
        setStats(prev => ({
          ...snapshotUniqStats(s.coverageRounds || 0),
          // 覆盖轮用 coverage；列表去重数仍来自 uniq
          placed: uniqStatsRef.current.placed.size,
          cancelled: uniqStatsRef.current.cancelled.size,
          slArmed: uniqStatsRef.current.slArmed.size,
          failed: uniqStatsRef.current.failed.size,
          brokeOut: uniqStatsRef.current.brokeOut.size,
          round: s.coverageRounds || 0,
        }));
        setPendingCount(s.pendingCount || 0);
        setPairTotal(s.pairTotal || 0);
        setPendingSymbols(Array.isArray(s.pendingSymbols) ? s.pendingSymbols : []);
        if (s.lastEventAt) setLastRound(new Date(s.lastEventAt));
        if (s.funnel) {
          // 与顶部 pending/pairTotal 同一覆盖轮：检=本轮已触达币数
          setLastScanFunnel({
            scanned: s.funnel.scanned ?? Math.max(0, (s.pairTotal || 0) - (s.pendingCount || 0)),
            hits: s.funnel.hits || 0,
            nearBandIn: s.funnel.nearBandIn || 0,
            nearBandBusy: s.funnel.nearBandBusy || 0,
            nearBandPending: s.funnel.nearBandPending || 0,
            minNotionalSkip: s.funnel.minNotionalSkip || 0,
            placeSkipped: s.funnel.placeSkipped || 0,
            brokeOut: s.funnel.brokeOut || 0,
            placed: s.funnel.placed || 0,
            failed: s.funnel.failed || 0,
            bandPct: nearBandPctRef.current,
            slotLeft: null,
          });
        }
      },
      getDayKey: () => dayKeyRef.current,
      onDayRollover: () => {
        rebuildRef.current?.('utc');
      },
    });
    engineRef.current = engine;

    let unsubQuotes = () => {};
    let bootGen = 0;

    const bootstrap = async reason => {
      const gen = (bootGen += 1);
      engine.stop();
      setQueueStatus('');

      try {
        setStatus(
          reason === 'utc'
            ? 'UTC 切日，重新冷建…'
            : reason === 'pairs'
              ? '刷新币对并冷建…'
              : '启动中…连接行情 / 账户 Socket…'
        );
        try {
          await feed.waitReady(25000);
        } catch (e) {
          if (e instanceof RangeMonitorFatal && /已停止/.test(e.message)) return;
          console.warn('[RangeMonitor] waitReady', e);
        }
        if (abortRef.current || gen !== bootGen) return;

        dayKeyRef.current = utcDayKey();
        const coldStarted = Date.now();
        const cacheResult = await ensureRangeMonitorCandleCache({
          signal: {
            get aborted() {
              return abortRef.current || gen !== bootGen;
            },
          },
          onStatus: setStatus,
          priceFeed: feed,
          maxRangeMult: maxMultRef.current,
        });
        if (abortRef.current || gen !== bootGen) return;
        if (cacheResult?.aborted) return;

        const pairs = listCachedMonitorPairs();
        if (!pairs.length) {
          throw new RangeMonitorFatal('日 K 缓存无币对', 'ensureRangeMonitorCandleCache');
        }

        engine.setPairs(pairs);
        await engine.start({
          pairs,
          resetCoverage: reason === 'start' || reason === 'utc',
        });
        unsubQuotes();
        unsubQuotes = feed.subscribeQuotes(symbols => {
          engine.onQuotes(symbols);
        });

        setPairTotal(pairs.length);
        setPendingCount(pairs.length);
        setLastRound(new Date());
        if (!cacheResult?.fromCache) {
          setLastRoundMs(Date.now() - coldStarted);
        }
        const via = cacheResult?.fromCache ? '复用日K' : '冷建完成';
        setStatus(`${via} · 事件驱动 ${pairs.length} 币 · REST 仅过期补K`);
      } catch (e) {
        if (abortRef.current) return;
        if (e instanceof RangeMonitorFatal && /已停止/.test(e.message)) return;
        console.error('[RangeMonitor] bootstrap', e);
        const title =
          e instanceof RangeMonitorFatal ? e.message : `未预期异常：${e?.message || e}`;
        const detail = e instanceof RangeMonitorFatal ? e.detail : e?.stack || String(e);
        haltMonitor(title, detail);
      }
    };

    rebuildRef.current = bootstrap;
    bootstrap('start');

    return () => {
      abortRef.current = true;
      bootGen += 1;
      unsubQuotes();
      engine.stop();
      engineRef.current = null;
      setQueueStatus('');
      queueMicrotask(() => {
        if (feedSessionRef.current === session) {
          getSharedMiniTickerFeed().stop();
          releaseBinanceAccountMirror();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const stopMonitor = () => {
    abortRef.current = true;
    engineRef.current?.stop();
    saveMonitorRunning(false);
    setRunning(false);
    getSharedMiniTickerFeed().stop();
    setStatus('已停止');
    setQueueStatus('');
  };

  const startMonitor = () => {
    applyMaxMult(maxMultInput);
    applyNearBandPct(nearBandInput);
    saveMonitorRunning(true);
    setStatus('启动中…');
    setRunning(true);
  };

  const emptyHint = useMemo(
    () =>
      !cancelledList.length && !placedList.length && !slList.length && !tipList.length
        ? '暂无撤单 / 止损 / 挂单 / 提示记录'
        : null,
    [cancelledList.length, placedList.length, slList.length, tipList.length]
  );

  return {
    running,
    status,
    queueStatus,
    lastRound,
    lastRoundMs,
    exitStats,
    stats,
    pendingCount,
    pairTotal,
    pendingSymbols,
    lastScanFunnel,
    cancelledList,
    placedList,
    slList,
    tipList,
    listCounts,
    emptyHint,
    startMonitor,
    stopMonitor,
  };
};
