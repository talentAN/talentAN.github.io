/**
 * 暴涨100 UI：芯片 + 展开面板（命中列表、自动下单批次、空头 tip）。
 * docked=true 时嵌工具条，不可拖；false 为浮动面板。
 */
import React from 'react';
import { Tooltip } from 'antd';
import { getTradeUrl } from '@root/src/container/market';
import { isLiveOrderEnabled } from './_autoOrderModel';
import TradeUnlockPrompt from './TradeUnlockPrompt';
import {
  BATCH_STATUS_COLOR,
  PANEL_W,
  todayKey,
  fmtTime,
  fmtAvgRoundMs,
} from './_surgeAlertShared';
import { useSurgeAlert } from './useSurgeAlert';
import { Divider } from 'antd';

const SurgeAlert = ({ docked = false }) => {
  const {
    pctInput,
    setPctInput,
    applyPct,
    autoOrderEnabled,
    toggleAutoOrder,
    autoBatches,
    autoBatchesRef,
    expanded,
    setExpanded,
    pos,
    startDrag,
    movedRef,
    alerts,
    status,
    reconcileStatus,
    tradeQueueStatus,
    lastPoll,
    scanRounds,
    pendingCount,
    pairTotal,
    pendingSymbols,
    avgRoundMs,
    running,
    exitTips,
    setExitTips,
    startMonitor,
    stopMonitor,
    dismiss,
    STATUS_LABEL,
    SKIP_REASON_LABEL,
    EXIT_REASON_LABEL,
  } = useSurgeAlert({ docked });

  /** 是否有命中告警（芯片高亮） */
  const hasHits = alerts.length > 0;

  /** 收起态芯片：状态 + 命中数；点击展开/拖拽移动 */
  const chip = (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={docked ? undefined : startDrag}
      onClick={() => {
        if (!docked && movedRef.current) return;
        setExpanded(v => (docked ? !v : true));
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(v => (docked ? !v : true));
        }
      }}
      title={docked ? status : `${status}（可拖拽）`}
      className={[
        'qc-tool-chip',
        'qc-tool-chip--surge',
        hasHits ? 'is-hit' : '',
        !running ? 'is-stopped' : '',
        docked && expanded ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        docked
          ? undefined
          : {
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              zIndex: 1000,
              height: 40,
              padding: '0 14px',
              borderRadius: 20,
              fontSize: 13,
              cursor: 'grab',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              touchAction: 'none',
            }
      }
    >
      暴涨
      {hasHits ? (
        <span className="qc-tool-chip__badge">{alerts.length}</span>
      ) : (
        <span className="qc-tool-chip__muted">{running ? '监控中' : '已停止'}</span>
      )}
    </div>
  );

  if (!expanded) {
    return (
      <>
        <TradeUnlockPrompt active={autoOrderEnabled} />
        {chip}
      </>
    );
  }

  return (
    <>
      <TradeUnlockPrompt active={autoOrderEnabled} />
      {docked && chip}
      <div
        className={docked ? 'qc-tool-panel qc-tool-panel--surge' : undefined}
        style={
          docked
            ? undefined
            : {
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: PANEL_W,
                maxHeight: '70vh',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                pointerEvents: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                borderRadius: 10,
                background: '#fff',
                border: '1px solid #ffa39e',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
              }
        }
      >
        <div
          onPointerDown={startDrag}
          style={{
            background: '#fff1f0',
            padding: '10px 12px',
            fontSize: 11,
            color: '#a8071a',
            lineHeight: 1.5,
            borderBottom: '1px solid #ffccc7',
            cursor: 'grab',
          }}
          title="按住拖拽"
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>暴涨</div>
              <span
                title="覆盖轮次：全部币对都至少触达一次（bookTicker 或已入补K队）后 +1；补K入队≥45s未清提权 DAY_K_OVERDUE"
                style={{
                  minWidth: 22,
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 10,
                  background: '#ff4d4f',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: '20px',
                  textAlign: 'center',
                }}
              >
                {scanRounds}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {running ? (
                <button
                  type="button"
                  onClick={stopMonitor}
                  style={{
                    border: '1px solid #ffa39e',
                    background: '#fff',
                    color: '#cf1322',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
                  title="停止暴涨与横盘监控（共用开关）"
                >
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startMonitor}
                  style={{
                    border: '1px solid #b7eb8f',
                    background: '#f6ffed',
                    color: '#389e0d',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
                  title="开始暴涨与横盘监控（共用冷建 200 日 K）"
                >
                  开始
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#8c8c8c',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 0,
                }}
                title="收起"
              >
                −
              </button>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#cf1322',
              flexWrap: 'wrap',
            }}
          >
            <span>涨幅 &gt;</span>
            <input
              type="number"
              min="1"
              step="1"
              value={pctInput}
              onChange={e => setPctInput(e.target.value)}
              onBlur={() => applyPct(pctInput)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.target.blur();
                }
              }}
              title="告警与自动下单共用阈值"
              style={{
                width: 36,
                height: 22,
                border: '1px solid #ffa39e',
                borderRadius: 4,
                padding: '0 4px',
                fontSize: 12,
                color: '#a8071a',
                background: '#fff',
                outline: 'none',
                cursor: 'text',
              }}
            />
            <span>% 自动下单</span>
          </div>
          <Divider orientation="left" plain style={{ margin: '8px 0' }}>
          </Divider>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              flexWrap: 'wrap',
              minHeight: 20,
            }}
          >
            {pairTotal > 0 ? (
              <>
              <span
                title="本轮尚未触达的币数 / 跟踪币对数（Socket 或已入补K队任一算触达）"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
              <span>本轮进度：</span>
                {pendingCount <= 10 && pendingSymbols.length > 0 ? (
                  <Tooltip
                    placement="bottomLeft"
                    overlayStyle={{ maxWidth: 280 }}
                    title={
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        <div style={{ marginBottom: 4, opacity: 0.85 }}>
                          本轮尚未触达（无 Socket / 未补K）
                        </div>
                        {pendingSymbols.map(sym => (
                          <div key={sym}>
                            <a
                              href={getTradeUrl(sym, 'binance')}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#91caff' }}
                              onClick={e => e.stopPropagation()}
                            >
                              {sym}
                            </a>
                          </div>
                        ))}
                      </div>
                    }
                  >
                    <span style={{ cursor: 'help', borderBottom: '1px dashed #ffa39e' }}>
                      {pendingCount}
                    </span>
                  </Tooltip>
                ) : (
                  <span>{pendingCount}</span>
                )}
                <span style={{ opacity: 0.55 }}>/</span>
                <span>{pairTotal}</span>
              </span>
              </>

            ) : null}
            <span
              style={{ color: '#8c8c8c', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
              title="覆盖轮平均耗时（全书至少触达一次为一轮）"
            >
              平均耗时：{avgRoundMs != null ? fmtAvgRoundMs(avgRoundMs) : '—'}
            </span>
          </div>
          <div style={{ color: '#8c8c8c', marginTop: 4 }}>{status}</div>
          <div
            style={{
              color: reconcileStatus ? '#d48806' : 'transparent',
              fontSize: 10,
              marginTop: 2,
              minHeight: 14,
              lineHeight: '14px',
            }}
            title="无 Socket 推送过期后，排队 REST 补当日日 K（max 合并）"
            aria-hidden={!reconcileStatus}
          >
            {reconcileStatus || '\u00a0'}
          </div>
          <div
            style={{
              color: tradeQueueStatus ? '#cf1322' : 'transparent',
              fontSize: 10,
              marginTop: 2,
              minHeight: 14,
              lineHeight: '14px',
            }}
            title="REST队 DAY_K_COLD>SURGE_OPEN>SURGE_EXIT>DAY_K_OVERDUE>RANGE_EXIT>RANGE_OPEN>DAY_K_EXPIRE>DEFAULT"
            aria-hidden={!tradeQueueStatus}
          >
            {tradeQueueStatus || '\u00a0'}
          </div>
          <div
            style={{
              color: lastPoll ? '#bfbfbf' : 'transparent',
              fontSize: 10,
              minHeight: 14,
              lineHeight: '14px',
            }}
          >
            {lastPoll ? lastPoll.toLocaleTimeString() : '\u00a0'}
          </div>
          {!isLiveOrderEnabled() && (
            <div style={{ color: '#d48806', fontSize: 10, marginTop: 2 }}>
              未解锁交易：空头止盈不下单
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '4px',
            maxHeight: 'calc(70vh - 110px)',
            touchAction: 'auto',
          }}
        >
          {exitTips.length > 0 && (
            <div
              style={{
                background: '#fff7e6',
                border: '1px solid #ffd591',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 10,
                color: '#ad6800',
                lineHeight: 1.45,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                <span>空头止盈</span>
                <button
                  type="button"
                  onClick={() => setExitTips([])}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#8c8c8c',
                    cursor: 'pointer',
                    fontSize: 10,
                    padding: 0,
                  }}
                >
                  清空
                </button>
              </div>
              {exitTips.slice(0, 6).map(tip => (
                <div key={tip.id} style={{ marginBottom: 2 }}>
                  {tip.text}
                </div>
              ))}
            </div>
          )}
          {alerts.length === 0 ? (
            <div
              style={{
                background: '#fafafa',
                border: '1px dashed #d9d9d9',
                borderRadius: 6,
                padding: '10px 8px',
                fontSize: 11,
                color: '#bfbfbf',
                textAlign: 'center',
              }}
            >
              暂无命中
            </div>
          ) : (
            alerts.map(item => {
              const batch =
                autoBatches.find(
                  b => b.id === `${todayKey()}:${item.exchange}:${item.symbol}`
                ) ||
                autoBatchesRef.current.get(`${todayKey()}:${item.exchange}:${item.symbol}`);
              const batchColor = batch && BATCH_STATUS_COLOR[batch.status];
              const skipLabel = batch?.skipReason
                ? SKIP_REASON_LABEL[batch.skipReason] || batch.skipReason
                : '';
              const fmtPx = v =>
                Number.isFinite(Number(v))
                  ? Number(v) >= 1
                    ? Number(v).toPrecision(6)
                    : Number(v).toPrecision(4)
                  : '';
              const skipDetail = [
                batch?.status === 'missing'
                  ? `委托缺失：${batch?.skipDetail || '账户中无对应委托/空仓'}`
                  : '',
                batch?.status === 'filled' && Number(batch?.liveShortAmt) > 0
                  ? `空仓 ${Number(batch.liveShortAmt)}`
                  : batch?.status === 'filled'
                    ? '已成交（无挂单）'
                    : '',
                batch?.status === 'skipped' || batch?.status === 'failed'
                  ? `未开仓：${
                      skipLabel ||
                      batch?.skipDetail ||
                      (batch?.status === 'failed' ? '提交失败' : '未知原因')
                    }`
                  : skipLabel,
                batch?.skipReason === 'ath_breakout' && Number.isFinite(batch?.athProbe)
                  ? `探测价 ${fmtPx(batch.athProbe)}（max高/开×4）`
                  : '',
                batch?.skipReason === 'ath_breakout' && Number.isFinite(batch?.prevAth)
                  ? `前高 ${fmtPx(batch.prevAth)}${
                      batch.prevAthDate ? `@${batch.prevAthDate}` : ''
                    }`
                  : '',
                batch?.status === 'skipped' && batch?.skipDetail && skipLabel
                  ? batch.skipDetail
                  : '',
                Number.isFinite(batch?.listingDays) ? `已上线 ${batch.listingDays} 天` : '',
                Number.isFinite(batch?.fundingRate)
                  ? `资金费率 ${(batch.fundingRate * 100).toFixed(4)}%`
                  : '',
                batch?.stopOrder
                  ? batch.stopOrder.ok
                    ? `止损已挂 @ ${Number(batch.stopOrder.triggerPrice).toPrecision(6)}`
                    : `止损挂单失败：${batch.stopOrder.error || batch.stopOrder.status}`
                  : '',
                batch?.exitAttempt?.skipped
                  ? `离场跳过：${batch.exitAttempt.error || ''}`
                  : batch?.exitAttempt && !batch.exitAttempt.skipped
                    ? `离场失败：${
                        batch.closeOrder?.error || batch.exitAttempt.closeOrder?.error || ''
                      }`
                    : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const legErrors = (batch?.legs || [])
                .filter(
                  leg =>
                    leg.status === 'rejected' ||
                    leg.status === 'unknown' ||
                    leg.status === 'skipped'
                )
                .map(leg => leg.error || leg.response?.msg || leg.response?.message)
                .filter(Boolean);
              const marketLegs = (batch?.legs || []).filter(leg => leg.marketMerged);
              const statusDetail = [
                batch?.legs &&
                  `${batch.legs.filter(leg => leg.status === 'submitted').length}/${
                    batch.legs.length
                  } 档已提交`,
                Number.isFinite(batch?.liveOrderCount)
                  ? `镜像挂单 ${batch.liveOrderCount}`
                  : '',
                marketLegs.length
                  ? `市价合并 ${marketLegs.length} 档` +
                    (batch?.marketOpen?.ok === false
                      ? `失败：${batch.marketOpen.error || ''}`
                      : batch?.lastPriceAtSubmit
                        ? ` @ ${Number(batch.lastPriceAtSubmit).toPrecision(6)}`
                        : '')
                  : '',
                batch?.status === 'closed' &&
                  batch?.exitReason &&
                  EXIT_REASON_LABEL[batch.exitReason],
                skipDetail,
                ...legErrors,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <div
                  key={`${item.exchange}-${item.symbol}`}
                  style={{
                    background: '#fff',
                    border: '1px solid #ffa39e',
                    borderRadius: 6,
                    padding: '8px 8px 6px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#cf1322',
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.symbol}
                      </a>
                      {batch && (
                        <span
                          style={{
                            fontSize: 10,
                            lineHeight: '16px',
                            padding: '0 6px',
                            borderRadius: 999,
                            whiteSpace: 'nowrap',
                            background: batchColor?.bg || '#fafafa',
                            color: batchColor?.color || '#8c8c8c',
                            border: `1px solid ${batchColor?.border || '#d9d9d9'}`,
                          }}
                        >
                          {STATUS_LABEL[batch.status] || batch.status}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => dismiss(item.exchange, item.symbol)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#bfbfbf',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                        lineHeight: 1,
                      }}
                      title="关闭"
                    >
                      ×
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 8,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#389e0d', fontWeight: 600 }}>
                      +{((item.ratio - 1) * 100).toFixed(1)}%
                    </span>
                    <span
                      style={{ fontSize: 10, color: '#8c8c8c', whiteSpace: 'nowrap' }}
                      title="首次挂上提醒的时间"
                    >
                      提醒 {fmtTime(item.alertedAt)}
                    </span>
                  </div>
                  {(() => {
                    const q = batch?.queuedAt;
                    const e0 = batch?.eligStartedAt;
                    const s0 = batch?.submittedAt;
                    if (!(q || e0 || s0)) return null;
                    const parts = [];
                    if (item.alertedAt && q) {
                      const ms = Number(q) - Number(item.alertedAt);
                      if (Number.isFinite(ms) && ms >= 0) {
                        parts.push(`入队+${Math.round(ms / 1000)}s`);
                      }
                    }
                    if (q && e0) {
                      const ms = Number(e0) - Number(q);
                      if (Number.isFinite(ms) && ms >= 0) {
                        parts.push(`排队${Math.round(ms / 1000)}s`);
                      }
                    }
                    if (e0 && s0) {
                      const ms = Number(s0) - Number(e0);
                      if (Number.isFinite(ms) && ms >= 0) {
                        parts.push(`校验+下单${Math.round(ms / 1000)}s`);
                      }
                    } else if (s0) {
                      parts.push(`提交 ${fmtTime(s0)}`);
                    }
                    if (!parts.length) return null;
                    return (
                      <div
                        style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}
                        title="提醒→入队→校验提交耗时"
                      >
                        {parts.join(' · ')}
                      </div>
                    );
                  })()}
                  {statusDetail ? (
                    <div
                      style={{
                        fontSize: 10,
                        color:
                          batch?.status === 'skipped' || batch?.status === 'failed'
                            ? '#cf1322'
                            : '#8c8c8c',
                        marginTop: 2,
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                      }}
                    >
                      {statusDetail}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>
                    {item.exchange === 'binance' ? 'Binance' : 'Bitget'}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default SurgeAlert;
