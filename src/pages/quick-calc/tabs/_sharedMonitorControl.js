/**
 * 暴涨 + 横盘共用开停状态（单开关）。
 * - 写入时同步旧的两个 localStorage key，兼容自动恢复 / 旧逻辑
 * - 同页用自定义事件同步两套 React 树
 */

export const SURGE_MONITOR_RUNNING_KEY = 'surge-alert-monitor-running';
export const RANGE_MONITOR_RUNNING_KEY = 'range-monitor-running';
/** 同页同步：shared monitor running 变更 */
export const SHARED_MONITOR_RUNNING_EVENT = 'qc:shared-monitor-running';

const RUNNING_CHANGED = SHARED_MONITOR_RUNNING_EVENT;

const readRaw = key => {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
};

const writeRaw = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* ignore */
  }
};

/** 读共用开关；迁移：任一为开则开，否则关；都未写过则默认开 */
export const loadSharedMonitorRunning = () => {
  if (typeof window === 'undefined') return true;
  const s = readRaw(SURGE_MONITOR_RUNNING_KEY);
  const r = readRaw(RANGE_MONITOR_RUNNING_KEY);
  if (s === '1' || s === 'true' || r === '1' || r === 'true') {
    if (s !== '1' || r !== '1') saveSharedMonitorRunning(true, { silent: true });
    return true;
  }
  if (s === '0' || s === 'false' || r === '0' || r === 'false') {
    if (s !== '0' || r !== '0') saveSharedMonitorRunning(false, { silent: true });
    return false;
  }
  // 均未设置：与旧暴涨默认一致 → 开
  saveSharedMonitorRunning(true, { silent: true });
  return true;
};

/**
 * @param {boolean} enabled
 * @param {{ silent?: boolean }} [opts] silent=true 不广播（迁移写回）
 */
export const saveSharedMonitorRunning = (enabled, opts = {}) => {
  if (typeof window === 'undefined') return;
  const v = enabled ? '1' : '0';
  writeRaw(SURGE_MONITOR_RUNNING_KEY, v);
  writeRaw(RANGE_MONITOR_RUNNING_KEY, v);
  if (!opts.silent) {
    try {
      window.dispatchEvent(
        new CustomEvent(RUNNING_CHANGED, { detail: { running: Boolean(enabled) } })
      );
    } catch (_) {
      /* ignore */
    }
  }
};

/** @param {(running: boolean) => void} cb @returns {() => void} */
export const subscribeSharedMonitorRunning = cb => {
  if (typeof window === 'undefined') return () => {};
  const onLocal = e => {
    cb(Boolean(e?.detail?.running));
  };
  const onStorage = e => {
    if (
      e.key !== SURGE_MONITOR_RUNNING_KEY &&
      e.key !== RANGE_MONITOR_RUNNING_KEY
    ) {
      return;
    }
    cb(loadSharedMonitorRunning());
  };
  window.addEventListener(RUNNING_CHANGED, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(RUNNING_CHANGED, onLocal);
    window.removeEventListener('storage', onStorage);
  };
};

/** 自动恢复：两边都开（即共用开） */
export const forceEnableBothMonitors = () => {
  saveSharedMonitorRunning(true);
};
