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

/** 列表展示条数上限；标题数量用独立计数，不受此截断 */
export const LIST_LIMIT = 200;

/** 默认关闭，避免与暴涨监控同时猛扫 */
export const loadMonitorRunning = () => {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(RANGE_MONITOR_STORAGE_KEYS.running);
  return raw === '1' || raw === 'true';
};

export const saveMonitorRunning = enabled => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RANGE_MONITOR_STORAGE_KEYS.running, enabled ? '1' : '0');
};

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

export const exTag = exchange => (exchange === 'binance' ? 'BN' : 'BG');

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
