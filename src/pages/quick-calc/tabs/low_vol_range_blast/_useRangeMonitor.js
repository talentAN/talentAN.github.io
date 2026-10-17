/**
 * 横盘监控组合 hook：设置 + 面板 + 扫轮业务。
 */
import { useRangeMonitorSettings } from './useRangeMonitorSettings';
import { useRangeMonitorPanel } from './useRangeMonitorPanel';
import { useRangeMonitorLoop } from './useRangeMonitorLoop';

export const useRangeMonitor = () => {
  const settings = useRangeMonitorSettings();
  const panel = useRangeMonitorPanel();
  const loop = useRangeMonitorLoop({
    maxMultRef: settings.maxMultRef,
    nearBandPctRef: settings.nearBandPctRef,
    applyMaxMult: settings.applyMaxMult,
    applyNearBandPct: settings.applyNearBandPct,
    maxMultInput: settings.maxMultInput,
    nearBandInput: settings.nearBandInput,
  });

  return {
    // settings
    maxMult: settings.maxMult,
    maxMultInput: settings.maxMultInput,
    setMaxMultInput: settings.setMaxMultInput,
    applyMaxMult: settings.applyMaxMult,
    nearBandPct: settings.nearBandPct,
    nearBandInput: settings.nearBandInput,
    setNearBandInput: settings.setNearBandInput,
    applyNearBandPct: settings.applyNearBandPct,
    // panel
    expanded: panel.expanded,
    setExpanded: panel.setExpanded,
    sectionOpen: panel.sectionOpen,
    setSectionOpen: panel.setSectionOpen,
    // loop
    running: loop.running,
    status: loop.status,
    queueStatus: loop.queueStatus,
    lastRound: loop.lastRound,
    lastRoundMs: loop.lastRoundMs,
    exitStats: loop.exitStats,
    stats: loop.stats,
    pendingCount: loop.pendingCount,
    pairTotal: loop.pairTotal,
    pendingSymbols: loop.pendingSymbols,
    lastScanFunnel: loop.lastScanFunnel,
    cancelledList: loop.cancelledList,
    placedList: loop.placedList,
    slList: loop.slList,
    tipList: loop.tipList,
    listCounts: loop.listCounts,
    emptyHint: loop.emptyHint,
    startMonitor: loop.startMonitor,
    stopMonitor: loop.stopMonitor,
  };
};
