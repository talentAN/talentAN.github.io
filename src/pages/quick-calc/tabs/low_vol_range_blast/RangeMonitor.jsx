import React, { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { getTradeUrl } from '@root/src/container/market';
import TradeUnlockPrompt from '../system_1/TradeUnlockPrompt';
import { isLiveOrderEnabled } from '../system_1/_autoOrderModel';
import {
  MONITOR_MAX_MIN_OPEN_USDT,
  RANGE_MONITOR_MAX_MULT,
  RANGE_MONITOR_NEAR_BAND_PCT,
  normalizeNearBandPct,
} from './_rangeScan';
import {
  RANGE_MONITOR_ROUND_IDLE_MS,
  RangeMonitorFatal,
  getSharedMiniTickerFeed,
  runRangeMonitorRound,
} from './_rangeMonitorEngine';
import {
  acquireBinanceAccountMirror,
  releaseBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import { scheduleMonitorAutoRecover, forceEnableBothMonitors } from '../_monitorAutoRecover';

const SymbolLink = ({ symbol, exchange, color }) => {
  if (!symbol) return null;
  const href = getTradeUrl(symbol, exchange || 'binance');
  if (!href) return <span>{symbol}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: color || 'inherit',
        fontWeight: 600,
        textDecoration: 'none',
      }}
      title="打开交易页"
    >
      {symbol}
    </a>
  );
};

const RUNNING_KEY = 'range-monitor-running';
const MULT_KEY = 'range-monitor-max-mult';
const NEAR_BAND_KEY = 'range-monitor-near-band-pct';
/** 列表展示条数上限；标题数量用独立计数，不受此截断 */
const LIST_LIMIT = 200;

/** 默认关闭，避免与暴涨监控同时猛扫 */
const loadMonitorRunning = () => {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(RUNNING_KEY);
  return raw === '1' || raw === 'true';
};

const saveMonitorRunning = enabled => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RUNNING_KEY, enabled ? '1' : '0');
};

const loadMaxMult = () => {
  if (typeof window === 'undefined') return RANGE_MONITOR_MAX_MULT;
  const n = parseFloat(localStorage.getItem(MULT_KEY));
  return Number.isFinite(n) && n >= 1 ? n : RANGE_MONITOR_MAX_MULT;
};

const saveMaxMult = value => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MULT_KEY, String(value));
};

const loadNearBandPct = () => {
  if (typeof window === 'undefined') return RANGE_MONITOR_NEAR_BAND_PCT;
  const raw = localStorage.getItem(NEAR_BAND_KEY);
  if (raw == null || raw === '') return RANGE_MONITOR_NEAR_BAND_PCT;
  return normalizeNearBandPct(raw);
};

const saveNearBandPct = value => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NEAR_BAND_KEY, String(value));
};

const fmtTime = d => {
  if (!d) return '—';
  const t = d instanceof Date ? d : new Date(d);
  return t.toLocaleTimeString('zh-CN', { hour12: false });
};

/** 上一轮耗时：1m05s / 45s */
const fmtDurationMs = ms => {
  const n = Number(ms);
  if (!(n >= 0) || !Number.isFinite(n)) return '—';
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m${String(s).padStart(2, '0')}s`;
};

const exTag = exchange => (exchange === 'binance' ? 'BN' : 'BG');

const sectionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  margin: '8px 0 4px',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
  color: '#389e0d',
  textAlign: 'left',
  lineHeight: 1.45,
};

/**
 * 横盘监控：日 K 首轮 REST 缓存 / 同日 Socket 扩张当日 H/L；
 * ①清理 → ②持仓止损+止盈+追踪 → ③缓存上近带挂开多 → 休息循环。
 * REST 拉 K；Socket !bookTicker 实时买一卖一（变价即推），本地滚今日高。STRICT 缺参即停。
 */
const RangeMonitor = ({ docked = false }) => {
  const [running, setRunning] = useState(() => loadMonitorRunning());
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(() =>
    loadMonitorRunning() ? '启动中…' : '已停止'
  );
  const [maxMult, setMaxMult] = useState(() => loadMaxMult());
  const [maxMultInput, setMaxMultInput] = useState(() => String(loadMaxMult()));
  const [nearBandPct, setNearBandPct] = useState(() => loadNearBandPct());
  const [nearBandInput, setNearBandInput] = useState(() => String(loadNearBandPct()));
  /** 列表区块：默认全部折叠 */
  const [sectionOpen, setSectionOpen] = useState({
    cancelled: false,
    exits: false,
    placed: false,
    tips: false,
  });
  const [lastRound, setLastRound] = useState(null);
  /** 上一轮完整循环耗时（ms） */
  const [lastRoundMs, setLastRoundMs] = useState(null);
  const [stats, setStats] = useState({
    round: 0,
    placed: 0,
    cancelled: 0,
    slArmed: 0,
    failed: 0,
    brokeOut: 0,
  });
  /** 会话内按币对去重的累计（挂/撤/止损/破/败），避免每轮简单相加 */
  const uniqStatsRef = useRef({
    placed: new Set(),
    cancelled: new Set(),
    slArmed: new Set(),
    failed: new Set(),
    brokeOut: new Set(),
  });
  /** 提示列表：同币对+同原因只保留一条（会话内） */
  const tipSeenRef = useRef(new Set());
  /** 上一轮扫描漏斗（不被「休息」状态盖掉） */
  const [lastScanFunnel, setLastScanFunnel] = useState(null);
  /** 撤单 / 挂开仓 / 挂止损 / 提示列表（新的在前） */
  const [cancelledList, setCancelledList] = useState([]);
  const [placedList, setPlacedList] = useState([]);
  const [slList, setSlList] = useState([]);
  const [tipList, setTipList] = useState([]);
  /** 标题用真实累计数（不受 LIST_LIMIT 截断） */
  const [listCounts, setListCounts] = useState({
    cancelled: 0,
    placed: 0,
    sl: 0,
    tips: 0,
  });
  const abortRef = useRef(null);
  const runningRef = useRef(running);
  const maxMultRef = useRef(maxMult);
  const nearBandPctRef = useRef(nearBandPct);
  /** 用于区分 React Strict「假卸载」与真停止：假卸载后会有更大的 session 接手 */
  const feedSessionRef = useRef(0);
  runningRef.current = running;
  maxMultRef.current = maxMult;
  nearBandPctRef.current = nearBandPct;

  const pairKeyOf = entry => {
    const sym = String(entry?.symbol || '').toUpperCase();
    if (!sym) return '';
    return `${String(entry?.exchange || 'binance').toLowerCase()}:${sym}`;
  };

  /** 提示去重键：币对 + 类型 + 原因（detail 不参与，避免文案微差重复） */
  const tipKeyOf = entry => {
    const pair = pairKeyOf(entry);
    if (!pair) return '';
    const type = String(entry?.type || '');
    const reason = String(entry?.reason || '');
    return `${pair}|${type}|${reason}`;
  };

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
    // 顶部「止损」只计真正的成本止损；止盈/追踪进列表但不计入止损数
    if (entry?.type === 'sl_armed') rememberUniq('slArmed', entry);
    setListCounts(c => ({ ...c, sl: c.sl + 1 }));
    setSlList(prev => [{ ...entry, at: Date.now() }, ...prev].slice(0, LIST_LIMIT));
  };
  const pushTip = entry => {
    const key = tipKeyOf(entry);
    if (key && tipSeenRef.current.has(key)) {
      // 同币同因：只刷新时间与次数，不新增行、不弹第二次
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
    abortRef.current?.abort();
    // 本地先停本轮；刷新前会强制两边均为开启
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
    if (entry?.type === 'skipped') {
      pushTip(entry);
    }
    if (entry?.type === 'min_notional_skip') {
      pushTip(entry);
    }
    if (entry?.type === 'xx_kline_skip') {
      pushTip({
        ...entry,
        detail: `REST 小时 K 暂无，本轮跳过出场 · ${entry.detail || ''}`,
      });
    }
    if (entry?.type === 'xx_kline_rate_limited') {
      pushTip(entry);
    }
    if (entry?.type === 'tp_tier_mismatch') {
      pushTip(entry);
    }
    if (entry?.type === 'broke_out') {
      pushTip(entry);
      // 仅进提示列表，不弹 toast（同日多币会刷屏）；同币同日引擎侧已去重
    }
    if (entry?.type === 'max_stop_limit') {
      rememberUniq('failed', entry);
      const tipKey = tipKeyOf(entry);
      const firstTip = !tipKey || !tipSeenRef.current.has(tipKey);
      pushTip(entry);
      if (firstTip) {
        message.error(
          `开仓账户级中止：${entry.symbol} · ${entry.detail || ''} · ${entry.scanned ?? '?'}/${
            entry.total ?? '?'
          }`
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
          `开仓失败(继续下一币)：${entry.symbol}${
            entry.scanned != null && entry.total != null ? ` · ${entry.scanned}/${entry.total}` : ''
          } · ${entry.detail || entry.reason || ''}`
        );
      }
    }
  }; 
  useEffect(() => {
    if (!running) {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = null;
      getSharedMiniTickerFeed().stop();
      // 账户镜像在上一轮 running effect 的 cleanup 里 release，这里不重复减引用
      return undefined;
    }

    let alive = true;
    const session = feedSessionRef.current + 1;
    feedSessionRef.current = session;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('启动中…连接行情 / 账户 Socket…');
    // 新开监控：清空会话去重集合
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
    const feed = getSharedMiniTickerFeed();
    feed.start();
    acquireBinanceAccountMirror().catch(e => {
      console.warn('[RangeMonitor] account mirror start', e);
    });

    const setStatusSafe = text => {
      if (alive) setStatus(text);
    };

    const sleepAbortable = ms =>
      new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        const onAbort = () => {
          clearTimeout(t);
          resolve();
        };
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });

    const loop = async () => {
      while (!controller.signal.aborted && runningRef.current && alive) {
        if (!isLiveOrderEnabled()) {
          setStatusSafe('未解锁交易，等待中…');
          await sleepAbortable(5000);
          continue;
        }

        const roundAt = new Date();
        const mult = maxMultRef.current;
        const bandPct = nearBandPctRef.current;
        setStatusSafe(
          `新一轮：清理（高低比≤${Number(mult).toFixed(2)} · 近带 yy≤${Number(bandPct).toFixed(
            2
          )}% / 撤单 yy>${Number(bandPct) + 1}%）…`
        );

        let result;
        const roundStartedAt = Date.now();
        try {
          result = await runRangeMonitorRound({
            signal: controller.signal,
            onStatus: setStatusSafe,
            onLog,
            maxRangeMult: mult,
            nearBandPct: bandPct,
            priceFeed: feed,
          });
        } catch (e) {
          if (!alive || controller.signal.aborted) return;
          // stop() 触发的 waitReady reject：视为正常停机，不弹窗
          if (e instanceof RangeMonitorFatal && /已停止/.test(e.message)) return;
          console.error('[RangeMonitor] fatal', e);
          const title =
            e instanceof RangeMonitorFatal
              ? e.message
              : `未预期异常：${e?.message || e}`;
          const detail = e instanceof RangeMonitorFatal ? e.detail : e?.stack || String(e);
          haltMonitor(title, detail);
          return;
        }

        if (!alive || controller.signal.aborted || !runningRef.current) break;

        setLastRoundMs(Date.now() - roundStartedAt);
        setLastRound(roundAt);
        if (result.scan && !result.scan.disabled) {
          setLastScanFunnel({
            scanned: result.scan.scanned || 0,
            hits: result.scan.hits || 0,
            nearBandIn: result.scan.nearBandIn || 0,
            nearBandBusy: result.scan.nearBandBusy || 0,
            minNotionalSkip: result.scan.minNotionalSkip || 0,
            placeSkipped: result.scan.placeSkipped || 0,
            brokeOut: result.scan.brokeOut || 0,
            placed: result.scan.placed || 0,
            failed: result.scan.failed || 0,
            bandPct: result.scan.bandPct,
            n: result.scan.n,
            slotLeft: result.scan.slotLeft,
          });
          // 本轮已破上沿：按币对并入会话去重集合
          (result.scan.brokeOutSymbols || []).forEach(id => {
            rememberUniq('brokeOut', id);
          });
        }
        setStats(prev => snapshotUniqStats(prev.round + 1));

        if (result.aborted) break;

        const idleSec = Math.round(RANGE_MONITOR_ROUND_IDLE_MS / 1000);
        for (let s = idleSec; s > 0; s -= 1) {
          if (!alive || controller.signal.aborted || !runningRef.current) break;
          setStatusSafe(`休息 ${s}s 后下一轮…（Socket 保持）`);
          await sleepAbortable(1000);
        }
      }
    };

    loop().catch(e => {
      if (!alive || controller.signal.aborted) return;
      if (e instanceof RangeMonitorFatal && /已停止/.test(e.message)) return;
      console.error('[RangeMonitor] loop', e);
      haltMonitor(`循环异常：${e?.message || e}`, e?.stack || String(e));
    });

    return () => {
      alive = false;
      controller.abort();
      abortRef.current = null;
      // Strict Mode：清理后马上会再挂载并 ++session；微任务里若 session 已变则不 stop。
      // 真卸载 / 无接手：session 不变 → stop，避免泄漏。
      queueMicrotask(() => {
        if (feedSessionRef.current === session) {
          getSharedMiniTickerFeed().stop();
          releaseBinanceAccountMirror();
        }
      });
    };
  }, [running]);

  const applyMaxMult = raw => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 1) {
      setMaxMultInput(String(maxMult));
      return;
    }
    const next = Math.round(n * 100) / 100;
    setMaxMult(next);
    setMaxMultInput(String(next));
    maxMultRef.current = next;
    saveMaxMult(next);
  };

  const applyNearBandPct = raw => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) {
      setNearBandInput(String(nearBandPct));
      return;
    }
    const next = normalizeNearBandPct(n);
    setNearBandPct(next);
    setNearBandInput(String(next));
    nearBandPctRef.current = next;
    saveNearBandPct(next);
  };

  const stopMonitor = () => {
    abortRef.current?.abort();
    saveMonitorRunning(false);
    setRunning(false);
    getSharedMiniTickerFeed().stop();
    setStatus('已停止');
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

  const chip = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(v => !v);
        }
      }}
      title={status}
      className={[
        'qc-tool-chip',
        'qc-tool-chip--range',
        !running ? 'is-stopped' : '',
        docked && expanded ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      横盘
      {stats.placed > 0 ? (
        <span className="qc-tool-chip__badge">{stats.placed}</span>
      ) : (
        <span className="qc-tool-chip__muted">{running ? '监控中' : '已停止'}</span>
      )}
    </div>
  );

  if (!expanded) {
    return (
      <>
        <TradeUnlockPrompt active={running} />
        {chip}
      </>
    );
  }

  return (
    <>
      <TradeUnlockPrompt active={running} />
      {docked && chip}
      <div className={docked ? 'qc-tool-panel qc-tool-panel--range' : undefined}>
        <div
          style={{
            background: '#f6ffed',
            padding: '10px 12px',
            fontSize: 11,
            color: '#237804',
            lineHeight: 1.5,
            borderBottom: '1px solid #b7eb8f',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>横盘监控</div>
              <span
                title="已完成的清理→扫描循环次数"
                style={{
                  minWidth: 22,
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 10,
                  background: '#52c41a',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: '20px',
                  textAlign: 'center',
                }}
              >
                {stats.round}
              </span>
              {lastRoundMs != null ? (
                <span
                  title="上一轮：清理→持仓→开仓扫描总耗时（不含休息）"
                  style={{
                    height: 20,
                    padding: '0 7px',
                    borderRadius: 10,
                    border: '1px solid #b7eb8f',
                    background: '#fff',
                    color: '#389e0d',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: '18px',
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtDurationMs(lastRoundMs)}
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {running ? (
                <button
                  type="button"
                  onClick={stopMonitor}
                  style={{
                    border: '1px solid #b7eb8f',
                    background: '#fff',
                    color: '#389e0d',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
                >
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startMonitor}
                  style={{
                    border: '1px solid #b7eb8f',
                    background: '#f6ffed',
                    color: '#389e0d',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
                >
                  开始
                </button>
              )} 
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#8c8c8c',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                }}
                title="收起"
              >
                −
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>高低比 ≤</span>
              <input
                type="number"
                min="1"
                max="3"
                step="0.05"
                value={maxMultInput}
                disabled={running}
                onChange={e => setMaxMultInput(e.target.value)}
                onBlur={() => applyMaxMult(maxMultInput)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                }}
                title={running ? '运行中不可改；停止后再调' : '区间高低比须 ≤ 该值'}
                style={{
                  width: 56,
                  height: 22,
                  padding: '0 4px',
                  border: '1px solid #b7eb8f',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span title="现价 ≥ 上沿×(1−该%/100) 才挂开仓；100≈不限制近带">距上沿</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={nearBandInput}
                disabled={running}
                onChange={e => setNearBandInput(e.target.value)}
                onBlur={() => applyNearBandPct(nearBandInput)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                }}
                title={
                  running
                    ? '运行中不可改；停止后再调'
                    : '现价距上沿不超过该百分比才挂开仓委托；填 100 近似关闭近带限制'
                }
                style={{
                  width: 52,
                  height: 22,
                  padding: '0 4px',
                  border: '1px solid #b7eb8f',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
              <span>%</span>
            </div>
          </div>
          <div
            style={{
              marginTop: 4,
              color: '#595959',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
            title={status}
          >
            {status}
          </div>
          {(() => {
            const m = String(status || '').match(/日 K REST\s+(\d+)\s*\/\s*(\d+)/);
            const preparing = /日 K (首次|强制|建缓存)/.test(String(status || ''));
            if (!m && !preparing) return null;
            const cur = m ? Number(m[1]) : 0;
            const total = m ? Number(m[2]) : 0;
            const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
            return (
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: '#e8f5e0',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: total > 0 ? `${pct}%` : preparing ? '8%' : '0%',
                      height: '100%',
                      background: '#52c41a',
                      transition: 'width 0.15s linear',
                      borderRadius: 3,
                    }}
                  />
                </div>
                <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 10 }}>
                  {total > 0 ? `全量日 K ${cur}/${total}（${pct}%）` : '准备全量日 K…'}
                </div>
              </div>
            );
          })()}
          <div
            style={{ marginTop: 4, color: '#8c8c8c' }}
            title="挂/撤/止损/破/败均为会话内币对去重后的数量（非每轮累加）。止损=成本止损成功挂上（不含止盈/追踪）。败=开仓或出场提交失败（非跳过）"
          >
            {lastRound ? `上次 ${fmtTime(lastRound)}` : '尚未完成一轮'}
            {` · 挂${stats.placed}/撤${stats.cancelled}/止损${stats.slArmed}/破${stats.brokeOut}/败${stats.failed}`}
          </div>
          {lastScanFunnel ? (
            <div style={{ marginTop: 2, color: '#595959', fontSize: 11 }} title="上一轮开仓扫描漏斗">
              检{lastScanFunnel.scanned} · 在区间{lastScanFunnel.hits} · 距上沿≤
              {lastScanFunnel.bandPct != null ? Number(lastScanFunnel.bandPct) : '?'}%{' '}
              {lastScanFunnel.nearBandIn || 0}
              （已有仓/单{lastScanFunnel.nearBandBusy || 0}）· 名义≥20{' '}
              {lastScanFunnel.minNotionalSkip} · 下单跳过{lastScanFunnel.placeSkipped || 0} · 破
              {lastScanFunnel.brokeOut} · 挂{lastScanFunnel.placed}
              {lastScanFunnel.slotLeft != null ? ` · 坑余${lastScanFunnel.slotLeft}` : ''}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: '4px 10px 8px',
            fontSize: 11,
            lineHeight: 1.45,
            maxHeight: 260,
            overflow: 'auto',
            background: '#fcfffb',
          }}
        >
          <button
            type="button"
            style={{ ...sectionHeaderStyle, marginTop: 4 }}
            onClick={() => setSectionOpen(s => ({ ...s, cancelled: !s.cancelled }))}
            aria-expanded={sectionOpen.cancelled}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.cancelled ? '▼' : '▶'}</span>
            撤开仓委托（{listCounts.cancelled}）
          </button>
          {sectionOpen.cancelled &&
            (cancelledList.length === 0 ? (
              <div style={{ color: '#bfbfbf', marginBottom: 4, paddingLeft: 18 }}>暂无</div>
            ) : (
              cancelledList.map((item, idx) => (
                <div
                  key={`c-${item.at}-${idx}`}
                  style={{
                    color: '#d48806',
                    padding: '2px 0 2px 18px',
                    borderBottom: '1px solid #f6ffed',
                  }}
                >
                  <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                  {exTag(item.exchange)}{' '}
                  <SymbolLink symbol={item.symbol} exchange={item.exchange} color="#d48806" />
                  {item.count > 1 ? ` ×${item.count}` : ''}
                  <span style={{ color: '#8c8c8c' }}>
                    {item.reason === 'stock'
                      ? ' · 股票/ETF'
                      : item.reason === 'blacklist'
                        ? ' · 黑名单'
                        : item.reason === 'far_from_band'
                          ? ' · 离开近带'
                          : ' · 高低比/出区间'}
                  </span>
                </div>
              ))
            ))}

          <button
            type="button"
            style={sectionHeaderStyle}
            onClick={() => setSectionOpen(s => ({ ...s, exits: !s.exits }))}
            aria-expanded={sectionOpen.exits}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.exits ? '▼' : '▶'}</span>
            出场委托（{listCounts.sl}）
          </button>
          {sectionOpen.exits &&
            (slList.length === 0 ? (
              <div style={{ color: '#bfbfbf', marginBottom: 4, paddingLeft: 18 }}>暂无</div>
            ) : (
              slList.map((item, idx) => {
                const isFail =
                  item.type === 'sl_failed' ||
                  item.type === 'tp_failed' ||
                  item.type === 'trail_failed';
                let label = ` · 失败 ${item.detail || ''}`;
                if (item.type === 'sl_armed') {
                  label = ` · 成本止损 @${
                    item.triggerPrice != null ? Number(item.triggerPrice).toPrecision(6) : '—'
                  }`;
                } else if (item.type === 'tp_placed') {
                  const trig = item.submitted?.[0]?.triggerPrice;
                  label = ` · 止盈${trig != null ? ` @${Number(trig).toPrecision(6)}` : ''}${
                    item.detail ? ` ${item.detail}` : ''
                  }`;
                } else if (item.type === 'trail_placed') {
                  label = ` · 追踪激活@${
                    item.activatePrice != null ? Number(item.activatePrice).toPrecision(6) : '—'
                  } 回调${item.callbackRate ?? 12}%`;
                } else if (item.type === 'trail_failed') {
                  label = ` · 追踪失败 ${item.detail || ''}`;
                }
                return (
                  <div
                    key={`s-${item.at}-${idx}`}
                    style={{
                      color: isFail ? '#cf1322' : item.type === 'tp_placed' ? '#389e0d' : '#0958d9',
                      padding: '2px 0 2px 18px',
                      borderBottom: '1px solid #f6ffed',
                    }}
                  >
                    <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                    {exTag(item.exchange)}{' '}
                    <SymbolLink
                      symbol={item.symbol}
                      exchange={item.exchange}
                      color={isFail ? '#cf1322' : item.type === 'tp_placed' ? '#389e0d' : '#0958d9'}
                    />
                    {label}
                  </div>
                );
              })
            ))}

          <button
            type="button"
            style={sectionHeaderStyle}
            onClick={() => setSectionOpen(s => ({ ...s, placed: !s.placed }))}
            aria-expanded={sectionOpen.placed}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.placed ? '▼' : '▶'}</span>
            挂开仓委托（{listCounts.placed}）
          </button>
          {sectionOpen.placed &&
            (placedList.length === 0 ? (
              <div style={{ color: '#bfbfbf', paddingLeft: 18 }}>暂无</div>
            ) : (
              placedList.map((item, idx) => (
                <div
                  key={`p-${item.at}-${idx}`}
                  style={{
                    color: '#237804',
                    padding: '2px 0 2px 18px',
                    borderBottom: '1px solid #f6ffed',
                  }}
                >
                  <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                  {exTag(item.exchange)}{' '}
                  <SymbolLink symbol={item.symbol} exchange={item.exchange} color="#237804" />
                  {item.openNotionalUsdt != null
                    ? ` · ~${Number(item.openNotionalUsdt).toFixed(1)}U`
                    : ''}
                </div>
              ))
            ))}

          <button
            type="button"
            style={{ ...sectionHeaderStyle, color: '#d46b08' }}
            onClick={() => setSectionOpen(s => ({ ...s, tips: !s.tips }))}
            aria-expanded={sectionOpen.tips}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.tips ? '▼' : '▶'}</span>
            提示（{listCounts.tips}）
          </button>
          {sectionOpen.tips &&
            (tipList.length === 0 ? (
              <div style={{ color: '#bfbfbf', paddingLeft: 18 }}>暂无</div>
            ) : (
              tipList.map((item, idx) => {
                const progress =
                  item.scanned != null && item.total != null
                    ? ` · ${item.scanned}/${item.total}`
                    : '';
                let label = item.detail || item.reason || '';
                if (item.type === 'broke_out') {
                  const yyTxt =
                    item.yy != null && Number.isFinite(Number(item.yy))
                      ? ` · yy=${Number(item.yy).toFixed(2)}%`
                      : '';
                  const highTxt =
                    item.rangeHigh != null ? ` · 上沿=${item.rangeHigh}` : '';
                  const lastTxt =
                    item.liveLast != null ? ` · 现价=${item.liveLast}` : '';
                  label = `${item.detail || '已破上沿，未自动挂单 · 可手动评估'}${highTxt}${lastTxt}${yyTxt}`;
                } else if (item.type === 'skipped') {
                  label = `近带内下单跳过 · ${item.reason || ''}${
                    item.detail ? ` · ${item.detail}` : ''
                  }`;
                } else if (item.type === 'min_notional_skip') {
                  label =
                    item.detail ||
                    `最小开仓≥${MONITOR_MAX_MIN_OPEN_USDT}U，跳过挂开多`;
                } else if (item.type === 'max_stop_limit') {
                  label = `条件单已满(-4045)${progress}`;
                } else if (item.type === 'failed_stop') {
                  label = `开仓失败${progress} · ${item.detail || item.reason || ''}`;
                }
                const tipColor =
                  item.type === 'broke_out' || item.type === 'min_notional_skip'
                    ? '#d48806'
                    : '#cf1322';
                return (
                  <div
                    key={`t-${item.at}-${idx}`}
                    style={{
                      color: tipColor,
                      padding: '2px 0 2px 18px',
                      borderBottom: '1px solid #fff7e6',
                    }}
                  >
<span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                    {exTag(item.exchange)}{' '}
                    <SymbolLink
                      symbol={item.symbol}
                      exchange={item.exchange}
                      color={tipColor}
                    />
                    <span style={{ color: '#8c8c8c' }}> · {label}</span>
                    {item.count > 1 ? (
                      <span style={{ color: '#bfbfbf' }}> · ×{item.count}</span>
                    ) : null}
                  </div>
                );
              })
            ))}
          {emptyHint && (
            <div style={{ color: '#bfbfbf', marginTop: 6, fontSize: 10 }}>
              开始监控后，撤单 / 止损 / 挂单 / 提示会出现在这里
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default RangeMonitor;
