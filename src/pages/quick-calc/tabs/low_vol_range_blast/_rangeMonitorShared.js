/**
 * 横盘监控：常量与无 React 依赖的工具（供 hooks / UI 共用）。
 */
import React from 'react';
import { getTradeUrl } from '@root/src/container/market';
import {
  RANGE_MONITOR_MAX_MULT,
  RANGE_MONITOR_NEAR_BAND_PCT,
  normalizeNearBandPct,
} from './_rangeScan';
import { RANGE_MONITOR_STORAGE_KEYS } from './_rangeMonitorParams';
import {
  loadSharedMonitorRunning,
  saveSharedMonitorRunning,
} from '../_sharedMonitorControl';

/** 列表展示条数上限；标题数量用独立计数，不受此截断 */
export const LIST_LIMIT = 200;

/** 与暴涨共用开停 */
export const loadMonitorRunning = () => loadSharedMonitorRunning();

export const saveMonitorRunning = enabled => saveSharedMonitorRunning(enabled);

export const loadMaxMult = () => {
  if (typeof window === 'undefined') return RANGE_MONITOR_MAX_MULT;
  const n = parseFloat(localStorage.getItem(RANGE_MONITOR_STORAGE_KEYS.maxMult));
  return Number.isFinite(n) && n >= 1 ? n : RANGE_MONITOR_MAX_MULT;
};

export const saveMaxMult = value => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RANGE_MONITOR_STORAGE_KEYS.maxMult, String(value));
};

export const loadNearBandPct = () => {
  if (typeof window === 'undefined') return RANGE_MONITOR_NEAR_BAND_PCT;
  const raw = localStorage.getItem(RANGE_MONITOR_STORAGE_KEYS.nearBandPct);
  if (raw == null || raw === '') return RANGE_MONITOR_NEAR_BAND_PCT;
  return normalizeNearBandPct(raw);
};

export const saveNearBandPct = value => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RANGE_MONITOR_STORAGE_KEYS.nearBandPct, String(value));
};

export const fmtTime = d => {
  if (!d) return '—';
  const t = d instanceof Date ? d : new Date(d);
  return t.toLocaleTimeString('zh-CN', { hour12: false });
};

/** 上一轮耗时：1m05s / 45s */
export const fmtDurationMs = ms => {
  const n = Number(ms);
  if (!(n >= 0) || !Number.isFinite(n)) return '—';
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m${String(s).padStart(2, '0')}s`;
};

/** 平均每轮耗时：2min 15s / 45s */
export const fmtAvgRoundMs = ms => {
  const n = Number(ms);
  if (!(n >= 0) || !Number.isFinite(n)) return '—';
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}min ${s}s`;
};

export const exTag = exchange => (exchange === 'binance' ? 'BN' : 'BG');

/** 横盘「下单跳过」reason → 中文（漏斗 hover / tip） */
export const RANGE_PLACE_SKIP_REASON_LABEL = {
  slot_full: '开仓委托槽位已满',
  far_band: '轮到执行时已离开近带',
  scan_disabled: '横盘开仓已关闭',
  live_disabled: '交易未解锁',
  auto_order_disabled: '自动下单未启用/未解锁',
  blacklist: '黑名单币对',
  blacklisted: '黑名单币对',
  stock: '股票类标的',
  miss_cache: '日K/盒子缓存缺失',
  no_box: '算不出区间盒子',
  broke_precheck: '已破位，预检不挂',
  min_usdt_invalid: '最小开仓金额无效',
  size_too_small: '下单数量过小',
  notional_too_small: '名义金额过小',
  notional_unavailable: '名义金额不可用',
  invalid_range: '区间上沿无效',
  invalid_row: '币对数据无效',
  cooldown: '冷却中',
  orders_error: '查委托失败',
  no_orders: '无可清理委托',
  query_failed: '查询持仓/委托失败',
  query_error: '查询持仓/委托异常',
};

export const formatRangePlaceSkipReason = (reason, detail) => {
  const label = RANGE_PLACE_SKIP_REASON_LABEL[reason] || reason || '未知原因';
  const d = detail && String(detail).trim();
  if (d && d !== reason && d !== label) return `${label}（${d}）`;
  return label;
};

export const sectionHeaderStyle = {
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

export const SymbolLink = ({ symbol, exchange, color }) => {
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

export const pairKeyOf = entry => {
  const sym = String(entry?.symbol || '').toUpperCase();
  if (!sym) return '';
  return `${String(entry?.exchange || 'binance').toLowerCase()}:${sym}`;
};

/** 提示去重键：币对 + 类型 + 原因（detail 不参与，避免文案微差重复） */
export const tipKeyOf = entry => {
  const pair = pairKeyOf(entry);
  if (!pair) return '';
  const type = String(entry?.type || '');
  const reason = String(entry?.reason || '');
  return `${pair}|${type}|${reason}`;
};
