/**
 * 监控异常自动恢复：弹窗提示 → 写入「两边均开启」→ 15s 后刷新页面。
 * 横盘 / 暴涨共用，避免各写一套。
 */

import React from 'react';
import { Modal } from 'antd';

export const SURGE_MONITOR_RUNNING_KEY = 'surge-alert-monitor-running';
export const RANGE_MONITOR_RUNNING_KEY = 'range-monitor-running';

const RECOVER_MS = 15 * 1000;
const COUNTDOWN_ID = 'qc-monitor-auto-recover-countdown';

let recovering = false;
let countdownTimer = null;
let reloadTimer = null;

export const forceEnableBothMonitors = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SURGE_MONITOR_RUNNING_KEY, '1');
    localStorage.setItem(RANGE_MONITOR_RUNNING_KEY, '1');
  } catch (_) {
    /* ignore */
  }
};

const clearRecoverTimers = () => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
};

const doReload = () => {
  clearRecoverTimers();
  forceEnableBothMonitors();
  try {
    window.location.reload();
  } catch (_) {
    /* ignore */
  }
};

const renderContent = (seconds, { title, detail, source }) =>
  React.createElement(
    'div',
    { style: { fontSize: 13, lineHeight: 1.5 } },
    React.createElement(
      'div',
      { style: { whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', marginBottom: 10 } },
      detail ? `${title}\n\n${detail}` : title
    ),
    source
      ? React.createElement(
          'div',
          { style: { color: '#8c8c8c', marginBottom: 8 } },
          `来源：${source}`
        )
      : null,
    React.createElement(
      'div',
      {
        id: COUNTDOWN_ID,
        style: { fontWeight: 600, color: '#cf1322', marginBottom: 4 },
      },
      `${seconds}s 后自动刷新页面…`
    ),
    React.createElement(
      'div',
      { style: { color: '#595959' } },
      '刷新后「暴涨监控」与「横盘监控」将均为开启状态。'
    )
  );

/**
 * 遇到不符合预期的异常时调用：弹窗 + 15s 自动刷新，并强制两边监控开启。
 * 同页多次调用只会生效一次。
 */
export const scheduleMonitorAutoRecover = ({
  title = '监控遇到不符合预期的情况',
  detail = '',
  source = '',
} = {}) => {
  if (typeof window === 'undefined') return;
  if (recovering) return;
  recovering = true;

  forceEnableBothMonitors();

  let seconds = Math.ceil(RECOVER_MS / 1000);

  Modal.error({
    title: '监控异常 · 即将自动恢复',
    content: renderContent(seconds, { title, detail, source }),
    width: 520,
    okText: '立即刷新',
    keyboard: false,
    maskClosable: false,
    centered: true,
    onOk: () => {
      doReload();
      return Promise.resolve();
    },
  });

  countdownTimer = setInterval(() => {
    seconds -= 1;
    const el = document.getElementById(COUNTDOWN_ID);
    if (el) {
      el.textContent =
        seconds > 0 ? `${seconds}s 后自动刷新页面…` : '正在刷新…';
    }
    if (seconds <= 0 && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 1000);

  reloadTimer = setTimeout(doReload, RECOVER_MS);
};