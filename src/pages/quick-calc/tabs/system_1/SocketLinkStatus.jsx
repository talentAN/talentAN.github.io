import React, { useEffect, useState } from 'react';
import { getBinanceAccountMirrorStatus } from '@root/src/container/binance/accountMirror';

/** Wi-Fi 样式：三弧 + 圆点 */
const WifiIcon = ({ color }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
    style={{ display: 'block' }}
  >
    <path
      d="M2.5 9.5c5.5-5.2 13.5-5.2 19 0"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M5.5 13c3.8-3.6 9.2-3.6 13 0"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M8.8 16.2c2-1.9 4.4-1.9 6.4 0"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="12" cy="19.2" r="1.6" fill={color} />
  </svg>
);

/**
 * 行情条右侧：BN 账户 User Data Stream 连接态。
 * 绿=已连上；红=监控需要但未连上；灰=未启动账户镜像。
 */
const SocketLinkStatus = () => {
  const [status, setStatus] = useState(() => getBinanceAccountMirrorStatus());

  useEffect(() => {
    const tick = () => setStatus(getBinanceAccountMirrorStatus());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const wanted = Boolean(status.wanted || status.acquireCount > 0);
  const ok = Boolean(status.wsReady);
  let color = '#bfbfbf';
  let title = '账户 Socket 未启动（开横盘/暴涨监控后连接）';
  if (wanted && ok) {
    color = '#52c41a';
    title = `账户 Socket 已连接${status.lastError ? '' : ''}`;
  } else if (wanted && !ok) {
    color = '#ff4d4f';
    title = `账户 Socket 未连接${status.lastError ? `：${status.lastError}` : '（重连中…）'}`;
  }

  return (
    <span
      className="qc-socket-link-status"
      title={title}
      role="img"
      aria-label={title}
      style={{
        marginLeft: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        flexShrink: 0,
        cursor: 'default',
      }}
    >
      <WifiIcon color={color} />
    </span>
  );
};

export default SocketLinkStatus;
