/**
 * 暴涨100 总装 hook：把「设置 + 面板 + 扫轮」合成 UI 可用的一把接口。
 */
import { useSurgeAlertSettings } from './useSurgeAlertSettings';
import { useSurgeAlertPanel } from './useSurgeAlertPanel';
import { useSurgeMonitor } from './useSurgeMonitor';

export const useSurgeAlert = ({ docked = false } = {}) => {
  /** 涨幅阈值、自动下单开关/比例、批次 Map */
  const settings = useSurgeAlertSettings();
  /** 浮层展开、拖拽位置 */
  const panel = useSurgeAlertPanel({ docked });
  /** 冷建日K、事件扫轮、自动挂单、空头止盈 tip */
  const monitor = useSurgeMonitor({
    pctRef: settings.pctRef,
    autoOrderPctRef: settings.autoOrderPctRef,
    autoOrderEnabledRef: settings.autoOrderEnabledRef,
    autoBatchesRef: settings.autoBatchesRef,
    autoOrderInFlightRef: settings.autoOrderInFlightRef,
    syncAutoBatches: settings.syncAutoBatches,
    setExpanded: panel.setExpanded,
  });

  /** 改告警涨幅阈值，并清空已命中、按新阈值重新武装 */
  const applyPct = raw => {
    if (!settings.applyPctValue(raw)) return;
    monitor.onThresholdChanged();
  };

  return {
    /** true=嵌在工具条里，不可拖；false=浮动可拖面板 */
    docked,

    // ── settings：阈值与自动下单 ──
    /** 告警用涨幅阈值（%），如 90 表示 high/open≥1.9 */
    pct: settings.pct,
    /** 告警阈值输入框里的字符串 */
    pctInput: settings.pctInput,
    setPctInput: settings.setPctInput,
    /** 提交告警阈值（校验后写 localStorage 并通知 monitor） */
    applyPct,
    /** 自动开空用的涨幅阈值（%），可与告警阈值不同 */
    autoOrderPct: settings.autoOrderPct,
    /** 自动开空阈值输入框字符串 */
    autoOrderPctInput: settings.autoOrderPctInput,
    setAutoOrderPctInput: settings.setAutoOrderPctInput,
    /** 提交自动开空阈值 */
    applyAutoOrderPct: settings.applyAutoOrderPct,
    /** 是否允许自动挂阶梯空单 */
    autoOrderEnabled: settings.autoOrderEnabled,
    /** 切换自动下单开关并持久化 */
    toggleAutoOrder: settings.toggleAutoOrder,
    /** 当日自动下单批次列表（给 UI 渲染） */
    autoBatches: settings.autoBatches,
    /** 批次 Map 的 ref（引擎/下单路径读写） */
    autoBatchesRef: settings.autoBatchesRef,

    // ── panel：展开与拖拽 ──
    /** 面板是否展开 */
    expanded: panel.expanded,
    setExpanded: panel.setExpanded,
    /** 浮动面板左上角坐标 {x,y} */
    pos: panel.pos,
    /** 开始拖拽（docked 时 no-op） */
    startDrag: panel.startDrag,
    /** 本次 pointer 是否发生过位移（用于区分点击/拖拽） */
    movedRef: panel.movedRef,

    // ── monitor：扫轮与挂单状态 ──
    /** 当前命中告警列表（按涨幅降序） */
    alerts: monitor.alerts,
    /** 主状态文案（启动中/事件驱动/已停止…） */
    status: monitor.status,
    /** 过期补K队列文案（空串=闲） */
    reconcileStatus: monitor.reconcileStatus,
    /** 共用交易队深度文案（空串=闲） */
    tradeQueueStatus: monitor.tradeQueueStatus,
    /** 最近一次行情事件时间 */
    lastPoll: monitor.lastPoll,
    /** bookTicker 全表覆盖轮次（seen 齐一轮 +1） */
    scanRounds: monitor.scanRounds,
    /** 最近一次冷建日K耗时（ms）；非扫轮耗时 */
    lastRoundMs: monitor.lastRoundMs,
    /** 本覆盖轮尚未见到 push 的币对数 */
    pendingCount: monitor.pendingCount,
    /** 监控中的 Binance 币对总数 */
    pairTotal: monitor.pairTotal,
    /** 未覆盖币对符号（仅当剩余很少时附带，供 UI 展示） */
    pendingSymbols: monitor.pendingSymbols,
    /** 监控是否在跑（与 localStorage RUNNING_KEY 同步） */
    running: monitor.running,
    /** 空头止盈/追踪 tip 列表（新在前） */
    exitTips: monitor.exitTips,
    setExitTips: monitor.setExitTips,
    /** 开始监控（持久化 running=true） */
    startMonitor: monitor.startMonitor,
    /** 停止监控并拆引擎 */
    stopMonitor: monitor.stopMonitor,
    /** 从告警列表移除某币对 */
    dismiss: monitor.dismiss,
    /** 批次状态中文标签 */
    STATUS_LABEL: monitor.STATUS_LABEL,
    /** 跳过原因中文标签 */
    SKIP_REASON_LABEL: monitor.SKIP_REASON_LABEL,
    /** 离场原因中文标签（历史字段，现多用于展示） */
    EXIT_REASON_LABEL: monitor.EXIT_REASON_LABEL,
  };
};
