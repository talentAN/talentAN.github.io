import React, { useEffect, useRef, useState } from 'react';
import {
  getMergedTradingPairs,
  getFutureKlineData,
  getTradeUrl,
} from '@root/src/container/market';
import {
  DEFAULT_AUTO_ORDER_PCT,
  EXIT_REASON_LABEL,
  STATUS_LABEL,
  SKIP_REASON_LABEL,
  loadAutoOrderPct,
  saveAutoOrderPct,
  loadAutoOrderEnabled,
  saveAutoOrderEnabled,
  loadAutoOrderBatches,
  saveAutoOrderBatches,
  buildLadderPlan,
  submitLadderPlan,
  checkExistingExposure,
  checkFundingRate,
  checkHigh100Eligibility,
} from './_autoOrderModel';
import TradeUnlockPrompt from './TradeUnlockPrompt';

const BATCH_SIZE = 8;
const BATCH_MS = 1000;
const DEFAULT_PCT = 90;
const STORAGE_KEY = 'surge-alert-threshold-pct';
const POS_KEY = 'surge-alert-pos';
/** 暴涨监控开关：'1' 开 / '0' 关；缺省视为开启 */
const RUNNING_KEY = 'surge-alert-monitor-running';
const PANEL_W = 220;
const TITLE_FLASH_MS = 8000;
/** 当日 K 线粒度（UTC 日线，与 todayKey 对齐） */
const GRANULARITY = '1Dutc';

// 自动下单批次状态标签的配色，跟 _autoOrderModel.js 的 STATUS_LABEL 一一对应
const BATCH_STATUS_COLOR = {
  submitting: { bg: '#fff7e6', color: '#d48806', border: '#ffd591' },
  open: { bg: '#f6ffed', color: '#389e0d', border: '#b7eb8f' },
  partial: { bg: '#fffbe6', color: '#d48806', border: '#ffe58f' },
  unknown: { bg: '#fff7e6', color: '#d46b08', border: '#ffd591' },
  closed: { bg: '#e6f4ff', color: '#1677ff', border: '#91caff' },
  failed: { bg: '#fff1f0', color: '#cf1322', border: '#ffa39e' },
  skipped: { bg: '#fafafa', color: '#8c8c8c', border: '#d9d9d9' },
};

const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const loadPct = () => {
  if (typeof window === 'undefined') return DEFAULT_PCT;
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PCT;
};

/** 默认落在页面左上角，止盈计算器位于其下方 */
const defaultPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 16 };
  return {
    x: 16,
    y: 16,
  };
};

const loadPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 120 };
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
  } catch (_) {
    /* ignore */
  }
  return defaultPos();
};

/** 无记录时默认开启；有记录则尊重上次开始/停止 */
const loadMonitorRunning = () => {
  if (typeof window === 'undefined') return true;
  const raw = localStorage.getItem(RUNNING_KEY);
  if (raw == null || raw === '') return true;
  return raw === '1' || raw === 'true';
};

const saveMonitorRunning = enabled => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RUNNING_KEY, enabled ? '1' : '0');
};

const clampPos = (x, y, w = PANEL_W, h = 80) => {
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
};

/** 用 Web Audio 发三声短促提示音，无需外部音频文件 */
const playAlertSound = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };
    const t0 = ctx.currentTime;
    beep(880, t0, 0.18);
    beep(1174, t0 + 0.22, 0.18);
    beep(880, t0 + 0.44, 0.28);
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch (_) {
    /* ignore */
  }
};

/** 尝试把当前 tab 拉到前台；浏览器限制下用标题闪烁 + Notification 兜底 */
const bringTabToFront = (label) => {
  try {
    window.focus();
  } catch (_) {
    /* ignore */
  }

  const original = document.title;
  let flip = false;
  const timer = setInterval(() => {
    flip = !flip;
    document.title = flip ? `🚨 ${label}` : original;
  }, 600);
  setTimeout(() => {
    clearInterval(timer);
    document.title = original;
  }, TITLE_FLASH_MS);

  if (typeof Notification !== 'undefined') {
    const show = () => {
      try {
        const n = new Notification('暴涨预警', {
          body: label,
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch (_) {
        /* ignore */
      }
    };
    if (Notification.permission === 'granted') show();
    else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') show();
      });
    }
  }
};

/** 拉取币对当日 K 线，返回涨幅原始数据；无数据返回 null */
const getPairSurgeInfo = async pair => {
  const { symbol, exchange } = pair;
  const res = await getFutureKlineData(
    { symbol, granularity: GRANULARITY, limit: 1 },
    exchange
  );
  const candles = Array.isArray(res?.data) ? res.data : [];
  if (!candles.length) return null;

  const candle = candles[0];
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const last = parseFloat(candle[4]);
  if (!open || open <= 0 || !high) return null;

  return {
    exchange,
    symbol,
    open,
    high,
    ratio: high / open,
    last: last || high,
    candleTs: Number(candle[0]),
    link: getTradeUrl(symbol, exchange),
  };
};

const SurgeAlert = ({ docked = false }) => {
  const [pct, setPct] = useState(DEFAULT_PCT);
  const [pctInput, setPctInput] = useState(String(DEFAULT_PCT));
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState(() => (loadMonitorRunning() ? '启动中…' : '已停止'));
  const [lastPoll, setLastPoll] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 16, y: 120 });
  /** 暴涨监控开关由 localStorage 记忆；无记录时默认开 */
  const [running, setRunning] = useState(() => loadMonitorRunning());
  const [autoOrderPct, setAutoOrderPct] = useState(DEFAULT_AUTO_ORDER_PCT);
  const [autoOrderPctInput, setAutoOrderPctInput] = useState(String(DEFAULT_AUTO_ORDER_PCT));
  const [autoOrderEnabled, setAutoOrderEnabled] = useState(true);
  const [autoBatches, setAutoBatches] = useState([]);
  const notifiedRef = useRef(new Set());
  const alertsMapRef = useRef(new Map());
  const pctRef = useRef(DEFAULT_PCT);
  const autoOrderPctRef = useRef(DEFAULT_AUTO_ORDER_PCT);
  const autoOrderEnabledRef = useRef(true);
  const autoBatchesRef = useRef(new Map());
  const autoOrderInFlightRef = useRef(new Set());
  const restartRef = useRef(false);
  const abortRef = useRef(false);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const originalTitleRef = useRef(
    typeof document !== 'undefined' ? document.title : ''
  );

  useEffect(() => {
    const initial = loadPct();
    setPct(initial);
    setPctInput(String(initial));
    pctRef.current = initial;
    setPos(loadPos());

    const initialAutoPct = loadAutoOrderPct();
    setAutoOrderPct(initialAutoPct);
    setAutoOrderPctInput(String(initialAutoPct));
    autoOrderPctRef.current = initialAutoPct;

    const initialEnabled = loadAutoOrderEnabled();
    setAutoOrderEnabled(initialEnabled);
    autoOrderEnabledRef.current = initialEnabled;

    const initialBatches = loadAutoOrderBatches();
    initialBatches.forEach(b => autoBatchesRef.current.set(b.id, b));
    setAutoBatches(initialBatches);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPos(p => {
        const next = clampPos(p.x, p.y);
        localStorage.setItem(POS_KEY, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = (e) => {
    if (docked) return;
    // 输入框 / 按钮上不启动拖拽
    if (e.target.closest('input,button,a')) return;
    e.preventDefault();
    movedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      const next = clampPos(dragRef.current.origX + dx, dragRef.current.origY + dy);
      setPos(next);
    };

    const onUp = () => {
      if (dragRef.current && movedRef.current) {
        setPos(p => {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
          return p;
        });
      }
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 通知权限 + 音频解锁（只挂一次）
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const unlockAudio = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        ctx.resume().then(() => ctx.close()).catch(() => {});
      } catch (_) {
        /* ignore */
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      document.title = originalTitleRef.current;
    };
  }, []);

  // 轮询：running=true 时启动，false 或卸载时 abort
  useEffect(() => {
    if (!running) return undefined;

    abortRef.current = false;

    const syncAlerts = () => {
      const list = Array.from(alertsMapRef.current.values()).sort(
        (a, b) => b.ratio - a.ratio
      );
      setAlerts(list);
      return list;
    };

    const applyHit = (hit) => {
      const key = `${hit.exchange}:${hit.symbol}`;
      alertsMapRef.current.set(key, hit);

      const notifyKey = `${todayKey()}:${hit.symbol}`;
      if (!notifiedRef.current.has(notifyKey)) {
        notifiedRef.current.add(notifyKey);
        return hit;
      }
      return null;
    };

    const clearHit = (pair) => {
      alertsMapRef.current.delete(`${pair.exchange}:${pair.symbol}`);
    };

    const syncAutoBatches = () => {
      const list = Array.from(autoBatchesRef.current.values()).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      setAutoBatches(list);
      saveAutoOrderBatches(list);
      return list;
    };

    /** 当日基本不变的跳过原因：不再每轮重查 / 重提醒 */
    const TERMINAL_SKIP_REASONS = new Set(['ath_breakout', 'listing_too_new']);

    /** 写入跳过结果；同一币对同一原因只提醒一次 */
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

    // 涨幅达到自动下单阈值：只挂 4 档开仓限价空单；平仓由用户自行处理，系统不再自动发平仓单。
    // skipped/failed 允许重试（否则会锁死整天且 Network 里看不到后续查询）
    const handleAutoOrder = async (info) => {
      const batchKey = `${todayKey()}:${info.exchange}:${info.symbol}`;
      const existing = autoBatchesRef.current.get(batchKey);
      if (autoOrderInFlightRef.current.has(batchKey)) return null;

      try {
        // 已挂出的批次：不再监控止损/止盈/结构失效，也不市价平仓
        if (existing && (existing.status === 'open' || existing.status === 'partial')) {
          return null;
        }

        if (
          existing &&
          existing.status !== 'skipped' &&
          existing.status !== 'failed'
        ) {
          return null;
        }

        // 历史新高 / 上市过新：当日不再反复查、不反复提醒
        if (
          existing?.status === 'skipped' &&
          TERMINAL_SKIP_REASONS.has(existing.skipReason)
        ) {
          return null;
        }

        // 其它 skipped/failed：冷却后再查，避免每轮都拉全量日 K + 持仓
        if (
          existing &&
          (existing.status === 'skipped' || existing.status === 'failed') &&
          Date.now() - (existing.checkedAt || existing.createdAt || 0) < 60000
        ) {
          return null;
        }

      const autoThreshold = 1 + autoOrderPctRef.current / 100;
      if (info.ratio < autoThreshold) return null;

      autoOrderInFlightRef.current.add(batchKey);
      const submittingBatch = {
        ...(existing || {}),
        id: batchKey,
        symbol: info.symbol,
        exchange: info.exchange,
        status: 'submitting',
        skipReason: undefined,
        skipDetail: undefined,
        createdAt: existing?.createdAt || Date.now(),
      };
      autoBatchesRef.current.set(batchKey, submittingBatch);
      syncAutoBatches();
// high100 口径：上市未满 30 天 / max(当日最高,开盘×4) 历史新高 → 跳过（与回测标记日一致）
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

      // 下单前查持仓 / 未成交委托；查询失败也跳过（保守）
      const exposure = await checkExistingExposure({ symbol: info.symbol, exchange: info.exchange });
      if (exposure.exposed) {
        return commitSkip(batchKey, existing, {
          id: batchKey,
          symbol: info.symbol,
          exchange: info.exchange,
          status: 'skipped',
          skipReason: exposure.reason,
          ...(exposure.detail ? { skipDetail: exposure.detail } : {}),
        });
      }

      const funding = await checkFundingRate({ symbol: info.symbol, exchange: info.exchange });
      if (!funding.allowed) {
        return commitSkip(batchKey, existing, {
          id: batchKey,
          symbol: info.symbol,
          exchange: info.exchange,
          status: 'skipped',
          skipReason: funding.reason,
          ...(Number.isFinite(funding.fundingRate) ? { fundingRate: funding.fundingRate } : {}),
          ...(funding.detail || funding.error ? { skipDetail: funding.detail || funding.error } : {}),
        });
      }

      const plan = buildLadderPlan({
        symbol: info.symbol,
        exchange: info.exchange,
        open: info.open,
        triggerHigh: info.high,
        candleTs: info.candleTs,
      });
      const pendingBatch = { ...plan, id: batchKey, status: 'submitting' };
      autoBatchesRef.current.set(batchKey, pendingBatch);
      syncAutoBatches();

      try {
        const submitted = { ...(await submitLadderPlan(plan)), id: batchKey };
        autoBatchesRef.current.set(batchKey, submitted);
        syncAutoBatches();
        return { type: 'submitted', batch: submitted };
      } catch (e) {
        console.error('[SurgeAlert][AutoOrder] submit', batchKey, e);
        const failed = {
          ...pendingBatch,
          status: 'failed',
          skipDetail: e?.message || String(e),
          createdAt: existing?.status === 'failed' ? existing.createdAt || Date.now() : Date.now(),
          checkedAt: Date.now(),
        };
        autoBatchesRef.current.set(batchKey, failed);
        syncAutoBatches();
        if (existing?.status === 'failed' && existing.skipDetail === failed.skipDetail) {
          return null;
        }
        return { type: 'skipped', batch: failed };
      }
      } catch (e) {
        console.error('[SurgeAlert][AutoOrder] unexpected', batchKey, e);
        return null;
      } finally {
        autoOrderInFlightRef.current.delete(batchKey);
      }
    };

    const runLoop = async () => {
      while (!abortRef.current) {
        let pairs = [];
        try {
          setStatus('拉取币对列表…');
          pairs = await getMergedTradingPairs();
        } catch (e) {
          console.error('[SurgeAlert] pairs', e);
          setStatus('币对列表拉取失败，重试中…');
          await sleep(3000);
          continue;
        }

        if (abortRef.current) break;

        if (!pairs.length) {
          setStatus('无可用币对，重试中…');
          await sleep(3000);
          continue;
        }

        restartRef.current = false;
        const total = pairs.length;

        for (let i = 0; i < total; i += BATCH_SIZE) {
          if (abortRef.current || restartRef.current) break;

          const batchStart = Date.now();
          const batch = pairs.slice(i, i + BATCH_SIZE);
          const threshold = 1 + pctRef.current / 100;
          const freshHits = [];
          const orderEvents = [];

          await Promise.all(
            batch.map(async pair => {
              try {
                const info = await getPairSurgeInfo(pair);
                if (!info) {
                  clearHit(pair);
                  return;
                }

                if (info.ratio >= threshold) {
                  const fresh = applyHit(info);
                  if (fresh) freshHits.push(fresh);
                } else {
                  clearHit(pair);
                }

                if (autoOrderEnabledRef.current) {
                  const event = await handleAutoOrder(info);
                  if (event) orderEvents.push(event);
                }
              } catch (e) {
                console.error('[SurgeAlert]', pair.symbol, e);
              }
            })
          );

          if (abortRef.current) break;

          const list = syncAlerts();
          const checked = Math.min(i + batch.length, total);
          setLastPoll(new Date());
          setStatus(
            list.length
              ? `轮询 ${checked}/${total} · 命中 ${list.length}`
              : `轮询 ${checked}/${total} · 无命中`
          );

          // 新命中 / 成功挂单才响铃；未开仓原因只写在卡片上，不每轮提醒
          if (freshHits.length || orderEvents.some(e => e.type === 'submitted')) {
            const hitLabels = freshHits
              .slice(0, 3)
              .map(item => `${item.symbol}(+${((item.ratio - 1) * 100).toFixed(0)}%)`);
            const orderLabels = orderEvents
              .filter(e => e.type === 'submitted')
              .slice(0, 3)
              .map(e => `${e.batch.symbol}已自动挂单`);
            const label = [...hitLabels, ...orderLabels].slice(0, 3).join(' ');
            setExpanded(true);
            playAlertSound();
            bringTabToFront(label);
          } else if (orderEvents.some(e => e.type === 'skipped')) {
            // 首次跳过只展开面板，不响铃
            setExpanded(true);
          }

          const elapsed = Date.now() - batchStart;
          if (elapsed < BATCH_MS) await sleep(BATCH_MS - elapsed);
        }
      }
    };

    runLoop();

    return () => {
      abortRef.current = true;
    };
  }, [running]);

  const stopMonitor = () => {
    abortRef.current = true;
    saveMonitorRunning(false);
    setRunning(false);
    setStatus('已停止');
  };

  const startMonitor = () => {
    saveMonitorRunning(true);
    setStatus('启动中…');
    setRunning(true);
  };

  const applyPct = (raw) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      setPctInput(String(pct));
      return;
    }
    setPct(n);
    setPctInput(String(n));
    pctRef.current = n;
    localStorage.setItem(STORAGE_KEY, String(n));
    // 阈值变了：清空当前命中并从头部重新轮询
    alertsMapRef.current.clear();
    setAlerts([]);
    notifiedRef.current.clear();
    if (running) {
      restartRef.current = true;
      setStatus('阈值已更新，重新轮询…');
    }
  };

  const dismiss = (exchange, symbol) => {
    alertsMapRef.current.delete(`${exchange}:${symbol}`);
    setAlerts(prev => prev.filter(a => !(a.exchange === exchange && a.symbol === symbol)));
  };

  const applyAutoOrderPct = (raw) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      setAutoOrderPctInput(String(autoOrderPct));
      return;
    }
    setAutoOrderPct(n);
    setAutoOrderPctInput(String(n));
    autoOrderPctRef.current = n;
    saveAutoOrderPct(n);
  };

  const toggleAutoOrder = () => {
    const next = !autoOrderEnabled;
    setAutoOrderEnabled(next);
    autoOrderEnabledRef.current = next;
    saveAutoOrderEnabled(next);
  };

  const hasHits = alerts.length > 0;

  const chip = (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={docked ? undefined : startDrag}
      onClick={() => {
        if (!docked && movedRef.current) return;
        setExpanded(v => (docked ? !v : true));
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(v => (docked ? !v : true));
        }
      }}
      title={docked ? status : `${status}（可拖拽）`}
      className={[
        'qc-tool-chip',
        'qc-tool-chip--surge',
        hasHits ? 'is-hit' : '',
        !running ? 'is-stopped' : '',
        docked && expanded ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
      style={docked ? undefined : {
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 1000,
        height: 40,
        padding: '0 14px',
        borderRadius: 20,
        fontSize: 13,
        cursor: 'grab',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        touchAction: 'none',
      }}
    >
      暴涨
      {hasHits ? (
        <span className="qc-tool-chip__badge">{alerts.length}</span>
      ) : (
        <span className="qc-tool-chip__muted">{running ? '监控中' : '已停止'}</span>
      )}
    </div>
  );

  // 收起态：小角标；docked 时嵌入工具坞
  if (!expanded) {
    return (
      <>
        <TradeUnlockPrompt active={autoOrderEnabled} />
        {chip}
      </>
    );
  }

  return (
    <>
    <TradeUnlockPrompt active={autoOrderEnabled} />
    {docked && chip}
    <div
      className={docked ? 'qc-tool-panel qc-tool-panel--surge' : undefined}
      style={docked ? undefined : {
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: PANEL_W,
        maxHeight: '70vh',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        borderRadius: 10,
        background: '#fff',
        border: '1px solid #ffa39e',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div
        onPointerDown={startDrag}
        style={{
          background: '#fff1f0',
          padding: '10px 12px',
          fontSize: 11,
          color: '#a8071a',
          lineHeight: 1.5,
          borderBottom: '1px solid #ffccc7',
          cursor: 'grab',
        }}
        title="按住拖拽"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>暴涨监控</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {running ? (
              <button
                type="button"
                onClick={stopMonitor}
                style={{
                  border: '1px solid #ffa39e',
                  background: '#fff',
                  color: '#cf1322',
                  cursor: 'pointer',
                  fontSize: 11,
                  lineHeight: 1,
                  padding: '3px 8px',
                  borderRadius: 4,
                }}
                title="停止轮询"
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
                title="开始轮询"
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cf1322' }}>
          <span>涨幅 &gt;</span>
          <input
            type="number"
            min="1"
            step="1"
            value={pctInput}
            onChange={e => setPctInput(e.target.value)}
            onBlur={() => applyPct(pctInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.target.blur();
              }
            }}
            style={{
              width: 48,
              height: 22,
              border: '1px solid #ffa39e',
              borderRadius: 4,
              padding: '0 4px',
              fontSize: 12,
              color: '#a8071a',
              background: '#fff',
              outline: 'none',
              cursor: 'text',
            }}
          />
          <span>%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a8071a', marginTop: 4 }}>
          <span>自动下单 &gt;</span>
          <input
            type="number"
            min="1"
            step="1"
            value={autoOrderPctInput}
            onChange={e => setAutoOrderPctInput(e.target.value)}
            onBlur={() => applyAutoOrderPct(autoOrderPctInput)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.target.blur();
              }
            }}

            style={{
              width: 40,
              height: 22,
              border: '1px solid #ffa39e',
              borderRadius: 4,
              padding: '0 4px',
              fontSize: 12,
              color: '#a8071a',
              background: '#fff',
              outline: 'none',
              cursor: 'text',
            }}
          />
          <span>%</span>
          <button
            type="button"
            onClick={toggleAutoOrder}
            title="按回测阶梯模型自动下单（真实签名请求，当前用 mock API Key）"
            style={{
              marginLeft: 2,
              border: autoOrderEnabled ? '1px solid #b7eb8f' : '1px solid #d9d9d9',
              background: autoOrderEnabled ? '#f6ffed' : '#fafafa',
              color: autoOrderEnabled ? '#389e0d' : '#8c8c8c',
              cursor: 'pointer',
              fontSize: 10,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {autoOrderEnabled ? '已开启' : '已关闭'}
          </button>
        </div>
        <div style={{ color: '#8c8c8c', marginTop: 4 }}>{status}</div>
        {lastPoll && (
          <div style={{ color: '#bfbfbf', fontSize: 10 }}>
            {lastPoll.toLocaleTimeString()}
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '0 10px 10px',
          maxHeight: 'calc(70vh - 110px)',
          touchAction: 'auto',
        }}
      >
        {alerts.length === 0 ? (
          <div
            style={{
              background: '#fafafa',
              border: '1px dashed #d9d9d9',
              borderRadius: 6,
              padding: '10px 8px',
              fontSize: 11,
              color: '#bfbfbf',
              textAlign: 'center',
            }}
          >
            暂无命中
          </div>
        ) : (
          alerts.map(item => {
            const batch = autoBatches.find(
              b => b.id === `${todayKey()}:${item.exchange}:${item.symbol}`
            ) || autoBatchesRef.current.get(`${todayKey()}:${item.exchange}:${item.symbol}`);
            const batchColor = batch && BATCH_STATUS_COLOR[batch.status];
            const skipLabel = batch?.skipReason
              ? SKIP_REASON_LABEL[batch.skipReason] || batch.skipReason
              : '';
            const fmtPx = v =>
              Number.isFinite(Number(v))
                ? Number(v) >= 1
                  ? Number(v).toPrecision(6)
                  : Number(v).toPrecision(4)
                : '';
            const skipDetail = [
              batch?.status === 'skipped' || batch?.status === 'failed'
                ? `未开仓：${
                    skipLabel ||
                    batch?.skipDetail ||
                    (batch?.status === 'failed' ? '提交失败' : '未知原因')
                  }`
                : skipLabel,
              batch?.skipReason === 'ath_breakout' && Number.isFinite(batch?.athProbe)
                ? `探测价 ${fmtPx(batch.athProbe)}（max高/开×4）`
                : '',
              batch?.skipReason === 'ath_breakout' && Number.isFinite(batch?.prevAth)
                ? `前高 ${fmtPx(batch.prevAth)}${batch.prevAthDate ? `@${batch.prevAthDate}` : ''}`
                : '',
              batch?.status === 'skipped' && batch?.skipDetail && skipLabel ? batch.skipDetail : '',
              Number.isFinite(batch?.listingDays) ? `已上线 ${batch.listingDays} 天` : '',
              Number.isFinite(batch?.fundingRate)
                ? `资金费率 ${(batch.fundingRate * 100).toFixed(4)}%`
                : '',
              batch?.stopOrder
                ? batch.stopOrder.ok
                  ? `止损已挂 @ ${Number(batch.stopOrder.triggerPrice).toPrecision(6)}`
                  : `止损挂单失败：${batch.stopOrder.error || batch.stopOrder.status}`
                : '',
              batch?.exitAttempt?.skipped
                ? `离场跳过：${batch.exitAttempt.error || ''}`
                : batch?.exitAttempt && !batch.exitAttempt.skipped
                  ? `离场失败：${batch.closeOrder?.error || batch.exitAttempt.closeOrder?.error || ''}`
                  : '',
            ]
              .filter(Boolean)
              .join(' · ');
            const legErrors = (batch?.legs || [])
              .filter(leg => leg.status === 'rejected' || leg.status === 'unknown' || leg.status === 'skipped')
              .map(leg => leg.error || leg.response?.msg || leg.response?.message)
              .filter(Boolean);
            const statusDetail = [
              batch?.legs &&
                `${batch.legs.filter(leg => leg.status === 'submitted').length}/${batch.legs.length} 档已提交`,
              batch?.status === 'closed' && batch?.exitReason && EXIT_REASON_LABEL[batch.exitReason],
              skipDetail,
              ...legErrors,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={`${item.exchange}-${item.symbol}`}
                style={{
                  background: '#fff',
                  border: '1px solid #ffa39e',
                  borderRadius: 6,
                  padding: '8px 8px 6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#cf1322',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.symbol}
                    </a>
                    {batch && (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: '16px',
                          padding: '0 6px',
                          borderRadius: 999,
                          whiteSpace: 'nowrap',
                          background: batchColor?.bg || '#fafafa',
                          color: batchColor?.color || '#8c8c8c',
                          border: `1px solid ${batchColor?.border || '#d9d9d9'}`,
                        }}
                      >
                        {STATUS_LABEL[batch.status] || batch.status}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(item.exchange, item.symbol)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#bfbfbf',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                      lineHeight: 1,
                    }}
                    title="关闭"
                  >
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#389e0d', fontWeight: 600, marginTop: 2 }}>
                  +{((item.ratio - 1) * 100).toFixed(1)}%
                </div>
                {statusDetail ? (
                  <div
                    style={{
                      fontSize: 10,
                      color: batch?.status === 'skipped' || batch?.status === 'failed' ? '#cf1322' : '#8c8c8c',
                      marginTop: 2,
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                    }}
                  >
                    {statusDetail}
                  </div>
                ) : null}
                <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>
                  {item.exchange === 'binance' ? 'Binance' : 'Bitget'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    </>
  );
};

export default SurgeAlert;
