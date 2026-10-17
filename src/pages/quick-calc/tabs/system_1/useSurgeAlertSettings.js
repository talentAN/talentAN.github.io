/**
 * 暴涨100：涨幅阈值 + 自动下单开关/比例 + 批次持久化。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_AUTO_ORDER_PCT,
  loadAutoOrderPct,
  saveAutoOrderPct,
  loadAutoOrderEnabled,
  saveAutoOrderEnabled,
  loadAutoOrderBatches,
  saveAutoOrderBatches,
} from './_autoOrderModel';
import { DEFAULT_PCT, STORAGE_KEY, loadPct } from './_surgeAlertShared';

export const useSurgeAlertSettings = () => {
  /** 告警涨幅阈值（%） */
  const [pct, setPct] = useState(DEFAULT_PCT);
  /** 告警阈值输入框草稿 */
  const [pctInput, setPctInput] = useState(String(DEFAULT_PCT));
  /** 自动开空涨幅阈值（%） */
  const [autoOrderPct, setAutoOrderPct] = useState(DEFAULT_AUTO_ORDER_PCT);
  /** 自动开空阈值输入框草稿 */
  const [autoOrderPctInput, setAutoOrderPctInput] = useState(String(DEFAULT_AUTO_ORDER_PCT));
  /** 是否允许自动挂阶梯空单 */
  const [autoOrderEnabled, setAutoOrderEnabled] = useState(true);
  /** 批次列表（由 Map 同步出来给 React 渲染） */
  const [autoBatches, setAutoBatches] = useState([]);

  /** 扫轮/事件引擎读的告警阈值（避免闭包过期） */
  const pctRef = useRef(DEFAULT_PCT);
  /** 事件引擎读的自动开空阈值 */
  const autoOrderPctRef = useRef(DEFAULT_AUTO_ORDER_PCT);
  /** 事件引擎读的自动下单开关 */
  const autoOrderEnabledRef = useRef(true);
  /** 当日批次：id → batch（权威源；UI 列表由 sync 刷出） */
  const autoBatchesRef = useRef(new Map());
  /** 正在资格检查/提交中的 batchKey，防同币并发双挂 */
  const autoOrderInFlightRef = useRef(new Set());

  useEffect(() => {
    const initial = loadPct();
    setPct(initial);
    setPctInput(String(initial));
    pctRef.current = initial;

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

  /** Map → 按创建时间倒序的数组，写 state + localStorage */
  const syncAutoBatches = useCallback(() => {
    const list = Array.from(autoBatchesRef.current.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    setAutoBatches(list);
    saveAutoOrderBatches(list);
    return list;
  }, []);

  /** 校验并写入告警阈值；成功返回 true（清空命中由调用方 onThresholdChanged） */
  const applyPctValue = raw => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      setPctInput(String(pct));
      return false;
    }
    setPct(n);
    setPctInput(String(n));
    pctRef.current = n;
    localStorage.setItem(STORAGE_KEY, String(n));
    return true;
  };

  /** 校验并写入自动开空阈值 */
  const applyAutoOrderPct = raw => {
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

  /** 翻转自动下单开关并持久化 */
  const toggleAutoOrder = () => {
    const next = !autoOrderEnabled;
    setAutoOrderEnabled(next);
    autoOrderEnabledRef.current = next;
    saveAutoOrderEnabled(next);
  };

  return {
    pct,
    pctInput,
    setPctInput,
    applyPctValue,
    pctRef,
    autoOrderPct,
    autoOrderPctInput,
    setAutoOrderPctInput,
    applyAutoOrderPct,
    autoOrderPctRef,
    autoOrderEnabled,
    toggleAutoOrder,
    autoOrderEnabledRef,
    autoBatches,
    autoBatchesRef,
    autoOrderInFlightRef,
    syncAutoBatches,
  };
};
