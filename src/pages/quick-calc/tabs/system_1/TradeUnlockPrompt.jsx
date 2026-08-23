import React, { useEffect, useState } from 'react';
import { getTradeSessionRemainingMs, unlockTradeSession } from '@root/src/utils/tradeSession';

const CHECK_INTERVAL_MS = 15000;
// 提前 5 分钟就重新弹出，给夜间脚本留出续期窗口，不等真正过期才发现
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/**
 * 线上"密码解锁交易"弹窗。本地开发（GATSBY_ENABLE_AUTO_ORDER=true）从不显示——
 * 那种场景下 isLiveOrderEnabled() 已经直接为真，不需要 session。
 *
 * DOM id 是特意固定下来的，方便你自己写的（不落盘的）控制台脚本用
 * document.getElementById(...) 定位并自动填密码提交：
 *   #trade-unlock-modal / #trade-unlock-password-input / #trade-unlock-submit-button
 */
const TradeUnlockPrompt = ({ active }) => {
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!active || process.env.GATSBY_ENABLE_AUTO_ORDER === 'true') {
      setVisible(false);
      return undefined;
    }
    const check = () => setVisible(getTradeSessionRemainingMs() <= RENEW_BEFORE_MS);
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  if (!visible) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    const result = await unlockTradeSession(password);
    setSubmitting(false);
    if (result.ok) {
      setPassword('');
      setVisible(false);
    } else {
      setError(result.error || '密码错误');
    }
  };

  return (
    <div
      id="trade-unlock-modal"
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2000,
        background: '#fff',
        border: '1px solid #ffa39e',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        padding: 16,
        width: 260,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#a8071a', marginBottom: 8 }}>解锁交易</div>
      <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 8 }}>
        自动下单需要先解锁交易 session，有效期内才会真的发下单/查仓请求。
      </div>
      <input
        id="trade-unlock-password-input"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit();
        }}
        placeholder="解锁密码"
        style={{
          width: '100%',
          height: 28,
          border: '1px solid #ffa39e',
          borderRadius: 4,
          padding: '0 8px',
          fontSize: 12,
          boxSizing: 'border-box',
          marginBottom: 8,
        }}
      />
      {error && <div style={{ fontSize: 11, color: '#cf1322', marginBottom: 8 }}>{error}</div>}
      <button
        id="trade-unlock-submit-button"
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%',
          height: 28,
          border: '1px solid #ffa39e',
          background: '#fff1f0',
          color: '#a8071a',
          borderRadius: 4,
          cursor: submitting ? 'default' : 'pointer',
          fontSize: 12,
        }}
      >
        {submitting ? '解锁中…' : '解锁'}
      </button>
    </div>
  );
};

export default TradeUnlockPrompt;
