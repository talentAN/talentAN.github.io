import React, { useEffect, useRef, useState } from 'react';
import {
  getMergedTradingPairs,
  getFutureKlineData,
  getTradeUrl,
} from '@root/src/container/market';

const BATCH_SIZE = 8;
const BATCH_MS = 1000;
const DEFAULT_PCT = 90;
const STORAGE_KEY = 'surge-alert-threshold-pct';
const POS_KEY = 'surge-alert-pos';
const PANEL_W = 220;
const TITLE_FLASH_MS = 8000;
/** 当日 K 线粒度（UTC 日线，与 todayKey 对齐） */
const GRANULARITY = '1Dutc';

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

/** 默认落在主内容右侧空位（红框区域） */
const defaultPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 120 };
  return {
    x: Math.max(16, window.innerWidth - PANEL_W - 16),
    y: 120,
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

/** 从当日 K 线判断是否暴涨；命中则返回 alert 对象，否则 null */
const checkPairSurge = async (pair, threshold) => {
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

  const ratio = high / open;
  if (ratio < threshold) return null;

  return {
    exchange,
    symbol,
    open,
    high,
    ratio,
    last: last || high,
    link: getTradeUrl(symbol, exchange),
  };
};

const SurgeAlert = () => {
  const [pct, setPct] = useState(DEFAULT_PCT);
  const [pctInput, setPctInput] = useState(String(DEFAULT_PCT));
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('启动中…');
  const [lastPoll, setLastPoll] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [pos, setPos] = useState({ x: 16, y: 120 });
  const notifiedRef = useRef(new Set());
  const alertsMapRef = useRef(new Map());
  const pctRef = useRef(DEFAULT_PCT);
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

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // 浏览器要求用户手势后才能播音频，点一下页面解锁
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

          await Promise.all(
            batch.map(async pair => {
              try {
                const hit = await checkPairSurge(pair, threshold);
                if (hit) {
                  const fresh = applyHit(hit);
                  if (fresh) freshHits.push(fresh);
                } else {
                  clearHit(pair);
                }
              } catch (e) {
                console.error('[SurgeAlert]', pair.symbol, e);
              }
            })
          );
          const list = syncAlerts();
          const checked = Math.min(i + batch.length, total);
          setLastPoll(new Date());
          setStatus(
            list.length
              ? `轮询 ${checked}/${total} · 命中 ${list.length}`
              : `轮询 ${checked}/${total} · 无命中`
          );

          if (freshHits.length) {
            const label = freshHits
              .slice(0, 3)
              .map(item => `${item.symbol}(+${((item.ratio - 1) * 100).toFixed(0)}%)`)
              .join(' ');
            setExpanded(true);
            playAlertSound();
            bringTabToFront(label);
          }

          const elapsed = Date.now() - batchStart;
          if (elapsed < BATCH_MS) await sleep(BATCH_MS - elapsed);
        }
      }
    };

    runLoop();

    return () => {
      abortRef.current = true;
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      document.title = originalTitleRef.current;
    };
  }, []);

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
    restartRef.current = true;
    setStatus('阈值已更新，重新轮询…');
  };

  const dismiss = (exchange, symbol) => {
    alertsMapRef.current.delete(`${exchange}:${symbol}`);
    setAlerts(prev => prev.filter(a => !(a.exchange === exchange && a.symbol === symbol)));
  };

  const hasHits = alerts.length > 0;

  // 收起态：小角标，位置跟随拖拽坐标
  if (!expanded) {
    return (
      <button
        type="button"
        onPointerDown={startDrag}
        onClick={() => {
          if (movedRef.current) return;
          setExpanded(true);
        }}
        title={`${status}（可拖拽）`}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 40,
          padding: '0 14px',
          border: hasHits ? '1px solid #ff4d4f' : '1px solid #d9d9d9',
          borderRadius: 20,
          background: hasHits ? '#fff1f0' : '#fff',
          color: hasHits ? '#cf1322' : '#595959',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'grab',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        暴涨
        {hasHits ? (
          <span
            style={{
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              background: '#ff4d4f',
              color: '#fff',
              fontSize: 12,
              lineHeight: '20px',
              textAlign: 'center',
              padding: '0 6px',
            }}
          >
            {alerts.length}
          </span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 400, color: '#8c8c8c' }}>监控中</span>
        )}
      </button>
    );
  }

  return (
    <div
      style={{
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
          alerts.map(item => (
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
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#cf1322',
                    textDecoration: 'none',
                  }}
                >
                  {item.symbol}
                </a>
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
              <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>
                {item.exchange === 'binance' ? 'Binance' : 'Bitget'}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SurgeAlert;