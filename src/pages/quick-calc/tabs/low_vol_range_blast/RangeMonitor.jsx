/**
 * 横盘监控 UI：冷建日 K 后事件驱动（bookTicker / 过期补K / 账户出场）。
 * 业务逻辑见 useRangeMonitor* hooks + _rangeEventEngine。
 */
import React from 'react';
import { Tooltip } from 'antd';
import { getTradeUrl } from '@root/src/container/market';
import TradeUnlockPrompt from '../system_1/TradeUnlockPrompt';
import { MONITOR_MAX_MIN_OPEN_USDT } from './_rangeScan';
import { useRangeMonitor } from './useRangeMonitor';
import {
  SymbolLink,
  sectionHeaderStyle,
  fmtTime,
  fmtDurationMs,
  exTag,
} from './_rangeMonitorShared';

const RangeMonitor = ({ docked = false }) => {
  const {
    maxMultInput,
    setMaxMultInput,
    applyMaxMult,
    nearBandInput,
    setNearBandInput,
    applyNearBandPct,
    expanded,
    setExpanded,
    sectionOpen,
    setSectionOpen,
    running,
    status,
    queueStatus,
    lastRound,
    lastRoundMs,
    exitStats,
    stats,
    pendingCount,
    pairTotal,
    pendingSymbols,
    lastScanFunnel,
    cancelledList,
    placedList,
    slList,
    tipList,
    listCounts,
    emptyHint,
    startMonitor,
    stopMonitor,
  } = useRangeMonitor();

  const chip = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(v => !v)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded(v => !v);
        }
      }}
      title={status}
      className={[
        'qc-tool-chip',
        'qc-tool-chip--range',
        !running ? 'is-stopped' : '',
        docked && expanded ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      横盘
      {stats.placed > 0 ? (
        <span className="qc-tool-chip__badge">{stats.placed}</span>
      ) : (
        <span className="qc-tool-chip__muted">{running ? '监控中' : '已停止'}</span>
      )}
    </div>
  );

  if (!expanded) {
    return (
      <>
        <TradeUnlockPrompt active={running} />
        {chip}
      </>
    );
  }

  return (
    <>
      <TradeUnlockPrompt active={running} />
      {docked && chip}
      <div className={docked ? 'qc-tool-panel qc-tool-panel--range' : undefined}>
        <div
          style={{
            background: '#f6ffed',
            padding: '10px 12px',
            fontSize: 11,
            color: '#237804',
            lineHeight: 1.5,
            borderBottom: '1px solid #b7eb8f',
          }}
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
              <div style={{ fontWeight: 700, fontSize: 13 }}>横盘</div>
              <span
                title="覆盖轮次：全部币对都至少触达一次（bookTicker 或 REST 补K）后 +1"
                style={{
                  minWidth: 22,
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 10,
                  background: '#52c41a',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: '20px',
                  textAlign: 'center',
                }}
              >
                {stats.round}
              </span>
              {pairTotal > 0 ? (
                <span
                  title="本轮尚未触达的币数 / 跟踪币对数（Socket 或 REST 补K 任一算触达）"
                  style={{
                    height: 20,
                    padding: '0 7px',
                    borderRadius: 10,
                    border: '1px solid #b7eb8f',
                    background: '#fff',
                    color: '#389e0d',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: '18px',
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0,
                  }}
                >
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
                                style={{ color: '#95de64' }}
                                onClick={e => e.stopPropagation()}
                              >
                                {sym}
                              </a>
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <span style={{ cursor: 'help', borderBottom: '1px dashed #b7eb8f' }}>
                        {pendingCount}
                      </span>
                    </Tooltip>
                  ) : (
                    <span>{pendingCount}</span>
                  )}
                  <span style={{ opacity: 0.55 }}>/</span>
                  <span>{pairTotal}</span>
                </span>
              ) : lastRoundMs != null ? (
                <span
                  title="最近一次日 K 冷建耗时"
                  style={{
                    height: 20,
                    padding: '0 7px',
                    borderRadius: 10,
                    border: '1px solid #b7eb8f',
                    background: '#fff',
                    color: '#389e0d',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: '18px',
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtDurationMs(lastRoundMs)}
                </span>
              ) : null}
              {null && exitStats.updatedAt ? (
                <span
                  style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 11 }}
                  title="表格持仓出场状态统计的最近更新时间"
                >
                  数据更新时间：{fmtTime(exitStats.updatedAt)} · 一档成功 {exitStats.tp1}/
                  {exitStats.positionCount || '—'} · 二档成功 {exitStats.tp2}/
                  {exitStats.positionCount || '—'} · 三档/追踪成功 {exitStats.tp3Trail}/
                  {exitStats.positionCount || '—'}
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {running ? (
                <button
                  type="button"
                  onClick={stopMonitor}
                  style={{
                    border: '1px solid #b7eb8f',
                    background: '#fff',
                    color: '#389e0d',
                    cursor: 'pointer',
                    fontSize: 11,
                    lineHeight: 1,
                    padding: '3px 8px',
                    borderRadius: 4,
                  }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>高低比 ≤</span>
              <input
                type="number"
                min="1"
                max="3"
                step="0.05"
                value={maxMultInput}
                disabled={running}
                onChange={e => setMaxMultInput(e.target.value)}
                onBlur={() => applyMaxMult(maxMultInput)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                }}
                title={running ? '运行中不可改；停止后再调' : '区间高低比须 ≤ 该值'}
                style={{
                  width: 56,
                  height: 22,
                  padding: '0 4px',
                  border: '1px solid #b7eb8f',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span title="现价 ≥ 上沿×(1−该%/100) 才挂开仓；100≈不限制近带">距上沿</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={nearBandInput}
                disabled={running}
                onChange={e => setNearBandInput(e.target.value)}
                onBlur={() => applyNearBandPct(nearBandInput)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                }}
                title={
                  running
                    ? '运行中不可改；停止后再调'
                    : '现价距上沿不超过该百分比才挂开仓委托；填 100 近似关闭近带限制'
                }
                style={{
                  width: 52,
                  height: 22,
                  padding: '0 4px',
                  border: '1px solid #b7eb8f',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              />
              <span>%</span>
            </div>
          </div>
          <div
            style={{
              marginTop: 4,
              color: '#595959',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
            title={status}
          >
            {status}
          </div>
          {queueStatus ? (
            <div
              style={{ color: '#d48806', fontSize: 10, marginTop: 2 }}
              title="无 Socket 推送过期后，排队 REST 补回看日 K"
            >
              {queueStatus}
            </div>
          ) : null}
          {(() => {
            const m = String(status || '').match(/日 K REST\s+(\d+)\s*\/\s*(\d+)/);
            const preparing = /日 K (首次|强制|建缓存)/.test(String(status || ''));
            if (!m && !preparing) return null;
            const cur = m ? Number(m[1]) : 0;
            const total = m ? Number(m[2]) : 0;
            const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
            return (
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: '#e8f5e0',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: total > 0 ? `${pct}%` : preparing ? '8%' : '0%',
                      height: '100%',
                      background: '#52c41a',
                      transition: 'width 0.15s linear',
                      borderRadius: 3,
                    }}
                  />
                </div>
                <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 10 }}>
                  {total > 0 ? `全量日 K ${cur}/${total}（${pct}%）` : '准备全量日 K…'}
                </div>
              </div>
            );
          })()}
          <div
            style={{ marginTop: 4, color: '#8c8c8c' }}
            title="挂/撤/止损/破/败均为会话内币对去重后的数量（非每轮累加）。止损=成本止损成功挂上（不含止盈/追踪）。败=开仓或出场提交失败（非跳过）"
          >
            {lastRound ? `上次 ${fmtTime(lastRound)}` : '尚未完成一轮'}
            {` · 挂${stats.placed}/撤${stats.cancelled}/止损${stats.slArmed}/破${stats.brokeOut}/败${stats.failed}`}
          </div>
          {lastScanFunnel ? (
            <div
              style={{ marginTop: 2, color: '#595959', fontSize: 11 }}
              title={
                '本覆盖轮开仓漏斗（按币去重）。' +
                '距上沿=现价判定近带；待挂=已进交易队尚未出结果（暴涨开仓优先时会在此堆积）；' +
                '忙/名义跳过/挂=交易队跑完后的结果，不是对「距上沿」同步扣减。' +
                '名义跳过=交易所最小开仓≥20U 策略不挂。'
              }
            >
              检{lastScanFunnel.scanned} · 在区间{lastScanFunnel.hits} · 距上沿≤
              {lastScanFunnel.bandPct != null ? Number(lastScanFunnel.bandPct) : '?'}%{' '}
              {lastScanFunnel.nearBandIn || 0}
              · 待挂{lastScanFunnel.nearBandPending || 0}
              · 忙{lastScanFunnel.nearBandBusy || 0}
              · 名义跳过{lastScanFunnel.minNotionalSkip} · 下单跳过
              {lastScanFunnel.placeSkipped || 0} · 破{lastScanFunnel.brokeOut} · 挂
              {lastScanFunnel.placed}
              {lastScanFunnel.slotLeft != null ? ` · 坑余${lastScanFunnel.slotLeft}` : ''}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: '4px 10px 8px',
            fontSize: 11,
            lineHeight: 1.45,
            maxHeight: 260,
            overflow: 'auto',
            background: '#fcfffb',
          }}
        >
          <button
            type="button"
            style={{ ...sectionHeaderStyle, marginTop: 4 }}
            onClick={() => setSectionOpen(s => ({ ...s, cancelled: !s.cancelled }))}
            aria-expanded={sectionOpen.cancelled}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.cancelled ? '▼' : '▶'}</span>
            撤开仓委托（{listCounts.cancelled}）
          </button>
          {sectionOpen.cancelled &&
            (cancelledList.length === 0 ? (
              <div style={{ color: '#bfbfbf', marginBottom: 4, paddingLeft: 18 }}>暂无</div>
            ) : (
              cancelledList.map((item, idx) => (
                <div
                  key={`c-${item.at}-${idx}`}
                  style={{
                    color: '#d48806',
                    padding: '2px 0 2px 18px',
                    borderBottom: '1px solid #f6ffed',
                  }}
                >
                  <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                  {exTag(item.exchange)}{' '}
                  <SymbolLink symbol={item.symbol} exchange={item.exchange} color="#d48806" />
                  {item.count > 1 ? ` ×${item.count}` : ''}
                  <span style={{ color: '#8c8c8c' }}>
                    {item.reason === 'stock'
                      ? ' · 股票/ETF'
                      : item.reason === 'blacklist'
                        ? ' · 黑名单'
                        : item.reason === 'far_from_band'
                          ? ' · 离开近带'
                          : ' · 高低比/出区间'}
                  </span>
                </div>
              ))
            ))}

          <button
            type="button"
            style={sectionHeaderStyle}
            onClick={() => setSectionOpen(s => ({ ...s, exits: !s.exits }))}
            aria-expanded={sectionOpen.exits}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.exits ? '▼' : '▶'}</span>
            出场委托（{listCounts.sl}）
          </button>
          {sectionOpen.exits &&
            (slList.length === 0 ? (
              <div style={{ color: '#bfbfbf', marginBottom: 4, paddingLeft: 18 }}>暂无</div>
            ) : (
              slList.map((item, idx) => {
                const isFail =
                  item.type === 'sl_failed' ||
                  item.type === 'tp_failed' ||
                  item.type === 'trail_failed';
                let label = ` · 失败 ${item.detail || ''}`;
                if (item.type === 'sl_armed') {
                  label = ` · 成本止损 @${
                    item.triggerPrice != null ? Number(item.triggerPrice).toPrecision(6) : '—'
                  }`;
                } else if (item.type === 'tp_placed') {
                  const trig = item.submitted?.[0]?.triggerPrice;
                  label = ` · 止盈${trig != null ? ` @${Number(trig).toPrecision(6)}` : ''}${
                    item.detail ? ` ${item.detail}` : ''
                  }`;
                } else if (item.type === 'trail_placed') {
                  label = ` · 追踪激活@${
                    item.activatePrice != null ? Number(item.activatePrice).toPrecision(6) : '—'
                  } 回调${item.callbackRate ?? 12}%`;
                } else if (item.type === 'trail_failed') {
                  label = ` · 追踪失败 ${item.detail || ''}`;
                }
                return (
                  <div
                    key={`s-${item.at}-${idx}`}
                    style={{
                      color: isFail ? '#cf1322' : item.type === 'tp_placed' ? '#389e0d' : '#0958d9',
                      padding: '2px 0 2px 18px',
                      borderBottom: '1px solid #f6ffed',
                    }}
                  >
                    <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                    {exTag(item.exchange)}{' '}
                    <SymbolLink
                      symbol={item.symbol}
                      exchange={item.exchange}
                      color={isFail ? '#cf1322' : item.type === 'tp_placed' ? '#389e0d' : '#0958d9'}
                    />
                    {label}
                  </div>
                );
              })
            ))}

          <button
            type="button"
            style={sectionHeaderStyle}
            onClick={() => setSectionOpen(s => ({ ...s, placed: !s.placed }))}
            aria-expanded={sectionOpen.placed}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.placed ? '▼' : '▶'}</span>
            挂开仓委托（{listCounts.placed}）
          </button>
          {sectionOpen.placed &&
            (placedList.length === 0 ? (
              <div style={{ color: '#bfbfbf', paddingLeft: 18 }}>暂无</div>
            ) : (
              placedList.map((item, idx) => (
                <div
                  key={`p-${item.at}-${idx}`}
                  style={{
                    color: '#237804',
                    padding: '2px 0 2px 18px',
                    borderBottom: '1px solid #f6ffed',
                  }}
                >
                  <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                  {exTag(item.exchange)}{' '}
                  <SymbolLink symbol={item.symbol} exchange={item.exchange} color="#237804" />
                  {item.openNotionalUsdt != null
                    ? ` · ~${Number(item.openNotionalUsdt).toFixed(1)}U`
                    : ''}
                </div>
              ))
            ))}

          <button
            type="button"
            style={{ ...sectionHeaderStyle, color: '#d46b08' }}
            onClick={() => setSectionOpen(s => ({ ...s, tips: !s.tips }))}
            aria-expanded={sectionOpen.tips}
          >
            <span style={{ width: 12, color: '#8c8c8c' }}>{sectionOpen.tips ? '▼' : '▶'}</span>
            提示（{listCounts.tips}）
          </button>
          {sectionOpen.tips &&
            (tipList.length === 0 ? (
              <div style={{ color: '#bfbfbf', paddingLeft: 18 }}>暂无</div>
            ) : (
              tipList.map((item, idx) => {
                const progress =
                  item.scanned != null && item.total != null
                    ? ` · ${item.scanned}/${item.total}`
                    : '';
                let label = item.detail || item.reason || '';
                if (item.type === 'broke_out') {
                  const yyTxt =
                    item.yy != null && Number.isFinite(Number(item.yy))
                      ? ` · yy=${Number(item.yy).toFixed(2)}%`
                      : '';
                  const highTxt =
                    item.rangeHigh != null ? ` · 上沿=${item.rangeHigh}` : '';
                  const lastTxt =
                    item.liveLast != null ? ` · 现价=${item.liveLast}` : '';
                  label = `${item.detail || '已破上沿，未自动挂单 · 可手动评估'}${highTxt}${lastTxt}${yyTxt}`;
                } else if (item.type === 'skipped') {
                  label = `近带内下单跳过 · ${item.reason || ''}${
                    item.detail ? ` · ${item.detail}` : ''
                  }`;
                } else if (item.type === 'min_notional_skip') {
                  label =
                    item.detail ||
                    `最小开仓≥${MONITOR_MAX_MIN_OPEN_USDT}U，跳过挂开多`;
                } else if (item.type === 'max_stop_limit') {
                  label = `条件单已满(-4045)${progress}`;
                } else if (item.type === 'failed_stop') {
                  label = `开仓失败${progress} · ${item.detail || item.reason || ''}`;
                }
                const tipColor =
                  item.type === 'broke_out' || item.type === 'min_notional_skip'
                    ? '#d48806'
                    : '#cf1322';
                return (
                  <div
                    key={`t-${item.at}-${idx}`}
                    style={{
                      color: tipColor,
                      padding: '2px 0 2px 18px',
                      borderBottom: '1px solid #fff7e6',
                    }}
                  >
                    <span style={{ color: '#bfbfbf', marginRight: 6 }}>{fmtTime(item.at)}</span>
                    {exTag(item.exchange)}{' '}
                    <SymbolLink
                      symbol={item.symbol}
                      exchange={item.exchange}
                      color={tipColor}
                    />
                    <span style={{ color: '#8c8c8c' }}> · {label}</span>
                    {item.count > 1 ? (
                      <span style={{ color: '#bfbfbf' }}> · ×{item.count}</span>
                    ) : null}
                  </div>
                );
              })
            ))}
        </div>
      </div>
    </>
  );
};

export default RangeMonitor;
