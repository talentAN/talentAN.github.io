/**
 * 暴涨100：常量与无 React 依赖的工具（hooks / UI 共用）。
 */

import { getSurgeInfoFromCache } from './_surgeDayCache';
import { DEFAULT_AUTO_ORDER_PCT } from './_autoOrderModel';

/** @deprecated 旧全表扫轮空闲间隔；现已事件驱动，代码未再引用 */
export const ROUND_IDLE_MS = 5000;
/** 空头止盈 tip 最多保留条数 */
export const EXIT_TIPS_MAX = 12;

/** @deprecated 旧暖扫分批大小；现已事件驱动，代码未再引用 */
export const WARM_BATCH_SIZE = 80;
/** @deprecated 旧暖扫批间隔；现已事件驱动，代码未再引用 */
export const WARM_BATCH_MS = 0;
/** 默认告警涨幅阈值（%） */
export const DEFAULT_PCT = 90;
/** localStorage：告警涨幅阈值 */
export const STORAGE_KEY = 'surge-alert-threshold-pct';
/** localStorage：浮动面板坐标 */
export const POS_KEY = 'surge-alert-pos';
/** localStorage：监控开关（'1'开/'0'关；缺省开） */
export const RUNNING_KEY = 'surge-alert-monitor-running';
/** 浮动面板宽度，用于拖拽边界计算 */
export const PANEL_W = 220;
/** 标题闪烁告警持续时长 */
export const TITLE_FLASH_MS = 8000;

export { DEFAULT_AUTO_ORDER_PCT };

/** 自动下单批次状态 → 芯片配色（对齐 STATUS_LABEL） */
export const BATCH_STATUS_COLOR = {
  submitting: { bg: '#fff7e6', color: '#d48806', border: '#ffd591' },
  open: { bg: '#f6ffed', color: '#389e0d', border: '#b7eb8f' },
  partial: { bg: '#fffbe6', color: '#d48806', border: '#ffe58f' },
  filled: { bg: '#e6f4ff', color: '#1677ff', border: '#91caff' },
  missing: { bg: '#fff1f0', color: '#cf1322', border: '#ffa39e' },
  unknown: { bg: '#fff7e6', color: '#d46b08', border: '#ffd591' },
  closed: { bg: '#e6f4ff', color: '#1677ff', border: '#91caff' },
  failed: { bg: '#fff1f0', color: '#cf1322', border: '#ffa39e' },
  skipped: { bg: '#fafafa', color: '#8c8c8c', border: '#d9d9d9' },
};

/** UTC 日历日键，形如 2026-4-16（与日K / 批次 id 对齐） */
export const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

/** 格式化时分秒；无效返回 — */
export const fmtTime = d => {
  if (!d) return '—';
  const t = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(t.getTime())) return '—';
  return t.toLocaleTimeString('zh-CN', { hour12: false });
};

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 毫秒 → 1m05s / 45s 文案 */
export const fmtDurationMs = ms => {
  const n = Number(ms);
  if (!(n >= 0) || !Number.isFinite(n)) return '—';
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m${String(s).padStart(2, '0')}s`;
};

/** 读告警涨幅阈值；无效则 DEFAULT_PCT */
export const loadPct = () => {
  if (typeof window === 'undefined') return DEFAULT_PCT;
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PCT;
};

/** 浮动面板默认落点（左上） */
export const defaultPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 16 };
  return { x: 16, y: 16 };
};

/** 读面板坐标；坏数据则 defaultPos */
export const loadPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 120 };
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
  } catch (_) {
    /* ignore */
  }
  return defaultPos();
};

/** 读监控开关：无记录默认开 */
export const loadMonitorRunning = () => {
  if (typeof window === 'undefined') return true;
  const raw = localStorage.getItem(RUNNING_KEY);
  if (raw == null || raw === '') return true;
  return raw === '1' || raw === 'true';
};

/** 写监控开关 */
export const saveMonitorRunning = enabled => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RUNNING_KEY, enabled ? '1' : '0');
};

/** 把面板坐标夹进视口内 */
export const clampPos = (x, y, w = PANEL_W, h = 80) => {
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
};

/** Web Audio 三声短 beep，无需外部文件 */
export const playAlertSound = () => {
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

/** 尝试 focus 当前 tab；失败则标题闪烁 + Notification */
export const bringTabToFront = label => {
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

/** 扫轮读缓存：open 来自日K桶，high 取 max(缓存, Socket)；缺缓存返回 null */
export const getPairSurgeInfo = (pair, feed) => getSurgeInfoFromCache(pair, feed);
