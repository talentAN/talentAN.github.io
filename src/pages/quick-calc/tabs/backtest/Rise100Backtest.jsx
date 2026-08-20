import React, { useMemo, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getTradeUrl } from '@root/src/container/market';
import {
  bucketMarkerRise,
  bucketSuccessDrop,
  EXTENDED_WINDOWS,
  FOLLOW_UP_DAYS,
  MIN_LISTING_DAYS,
  summarizeMarkers,
} from './_rise100Rules';
import { useMarkerScan } from './_useMarkerScan';
import ResultList from './_ResultList';
import Rise100Conclusion from './_Rise100Conclusion';
import Rise100Playbook from './_Rise100Playbook';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const fmtPrice = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number >= 1000) return number.toFixed(2);
  if (number >= 1) return number.toFixed(4);
  return number.toPrecision(5);
};

const statusLabel = status =>
  status === 'success' ? '成功' : status === 'failed' ? '失败' : '待观察';

const statusTone = (status, styles) =>
  status === 'success' ? styles.badgeGreen : status === 'failed' ? styles.badgeRed : styles.badgeGrey;

const fmtSignedPct = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${number.toFixed(1)}%`;
};

const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;

const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'success', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'pending', label: '待观察' },
];

const EX_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'binance', label: 'BN' },
  { key: 'bitget', label: 'BG' },
];

const Rise100Backtest = () => {
  const { markers: rows, errors, running, progress, percent, run, stop } = useMarkerScan();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [exFilter, setExFilter] = useState('all');
  const [riseRange, setRiseRange] = useState(null);

  const stats = useMemo(() => summarizeMarkers(rows), [rows]);
  const riseBuckets10 = useMemo(() => bucketMarkerRise(rows, 10), [rows]);
  const dropBuckets = useMemo(() => bucketSuccessDrop(rows, 10), [rows]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    return rows.filter(row => {
      if (query && !row.symbol.includes(query)) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (exFilter !== 'all' && row.exchange !== exFilter) return false;
      if (riseRange && !(row.markerRise >= riseRange.start && row.markerRise < riseRange.end)) return false;
      return true;
    });
  }, [rows, keyword, statusFilter, exFilter, riseRange]);

  const symbolCell = row => (
    <>
      <a
        className={s.symbolLink}
        href={getTradeUrl(row.symbol, row.exchange)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {row.symbol.replace('USDT', '')}
      </a>
      <span className={s.exchangeTag}>{row.exchange === 'binance' ? 'BN' : 'BG'}</span>
    </>
  );

  const columns = [
    { key: 'symbol', title: '币对', width: 110, render: symbolCell },
    {
      key: 'markerDate',
      title: '标记日',
      width: 95,
      sortBy: row => row.markerDate,
      render: row => <span className={s.muted}>{row.markerDate}</span>,
    },
    {
      key: 'markerRise',
      title: '日内涨幅',
      width: 85,
      align: 'right',
      sortBy: row => row.markerRise,
      render: row => <span className={cx(s.badge, s.badgeRed)}>+{fmtPct(row.markerRise)}</span>,
    },
    {
      key: 'markerOpen',
      title: '开盘价',
      width: 90,
      align: 'right',
      sortBy: row => row.markerOpen,
      render: row => fmtPrice(row.markerOpen),
    },
    {
      key: 'markerHigh',
      title: '最高价',
      width: 90,
      align: 'right',
      sortBy: row => row.markerHigh,
      render: row => fmtPrice(row.markerHigh),
    },
    {
      key: 'threshold',
      title: '成功线(开×2)',
      width: 100,
      align: 'right',
      sortBy: row => row.threshold,
      render: row => fmtPrice(row.threshold),
    },
    {
      key: 'twoWeekHigh',
      title: `后${FOLLOW_UP_DAYS}日最高`,
      width: 95,
      align: 'right',
      sortBy: row => row.twoWeekHigh,
      render: row => fmtPrice(row.twoWeekHigh),
    },
    {
      key: 'twoWeekLow',
      title: `后${FOLLOW_UP_DAYS}日最低`,
      width: 95,
      align: 'right',
      sortBy: row => row.twoWeekLow,
      render: row => fmtPrice(row.twoWeekLow),
    },
    {
      key: 'lowVsThreshold',
      title: '最低/成功线',
      width: 95,
      align: 'right',
      sortBy: row => row.lowVsThreshold,
      render: row => (
        <span className={row.lowVsThreshold != null && row.lowVsThreshold < 0 ? s.statGreen : s.statRed}>
          {fmtPct(row.lowVsThreshold)}
        </span>
      ),
    },
    {
      key: 'status',
      title: '结果',
      width: 70,
      align: 'center',
      sortBy: row => row.status,
      render: row => {
        return <span className={cx(s.badge, statusTone(row.status, s))}>{statusLabel(row.status)}</span>;
      },
    },
  ];

  if (statusFilter === 'failed') {
    EXTENDED_WINDOWS.forEach(days => {
      const field = `later${days}`;
      columns.push({
        key: field,
        title: `后${days}日`,
        width: 118,
        align: 'right',
        sortBy: row => row[field]?.highVsThreshold,
        render: row => {
          const later = row[field];
          if (!later) return <span className={s.muted}>需重跑</span>;
          return (
            <span className={s.laterCell}>
              <span className={cx(s.badge, statusTone(later.status, s))}>{statusLabel(later.status)}</span>
              <span className={later.highVsThreshold > 0 ? s.statRed : s.statGreen}>
                {fmtSignedPct(later.highVsThreshold)}
              </span>
            </span>
          );
        },
      });
    });
  }

  return (
    <div>
      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>成功率</span>
          <span className={cx(s.statValue, s.statBlue)}>
            {!stats || stats.successRate == null ? '—' : `${stats.successRate.toFixed(2)}%`}
          </span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>标记</span>
          <span className={s.statValue}>{stats?.total || 0}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>已完成</span>
          <span className={s.statValue}>{stats?.completed || 0}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>成功</span>
          <span className={cx(s.statValue, s.statGreen)}>{stats?.success || 0}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>失败</span>
          <span className={cx(s.statValue, s.statRed)}>{stats?.failed || 0}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>待观察</span>
          <span className={s.statValue}>{stats?.pending || 0}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>后14日最高超成功线</span>
          <span className={cx(s.statValue, stats?.maxHighVsThreshold > 0 ? s.statRed : s.statGreen)}>
            {!stats || stats.maxHighVsThreshold == null
              ? '—'
              : `${stats.maxHighVsThreshold >= 0 ? '+' : ''}${stats.maxHighVsThreshold.toFixed(1)}%`}
          </span>
        </div>
        <Rise100Conclusion stats={stats} />
        <Rise100Playbook />
      </div>

      {stats?.riseBuckets?.length > 0 && (
        <div className={s.distBar}>
          <span className={s.distTitle}>日内最高涨幅</span>
          {stats.riseBuckets.map(bucket => {
            const active = riseRange && riseRange.start === bucket.start;
            const subBuckets = riseBuckets10.filter(
              item => item.start >= bucket.start && item.start < bucket.end
            );
            return (
              <Tooltip
                key={bucket.label}
                placement="bottom"
                overlayStyle={{ maxWidth: 520 }}
                title={
                  <div className={s.rowTip}>
                    <span className={s.rowTipTitle}>
                      {bucket.label}% 内每 10% 一档（共 {bucket.count} 条）
                    </span>
                    <div className={s.rowTipChips}>
                      {subBuckets.length === 0 ? (
                        <span>暂无数据</span>
                      ) : (
                        subBuckets.map(item => (
                          <span key={item.label} className={cx(s.distItem, s.distItemStatic)}>
                            <span className={s.distLabel}>{item.label}%</span>
                            <span className={s.distCount}>{item.count}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                }
              >
                <span
                  className={cx(s.distItem, active && s.distItemActive)}
                  onClick={() =>
                    setRiseRange(prev => (prev && prev.start === bucket.start ? null : { start: bucket.start, end: bucket.end }))
                  }
                >
                  <span className={s.distLabel}>{bucket.label}%</span>
                  <span className={s.distCount}>{bucket.count}</span>
                  <span className={s.distPct}>{bucket.pct.toFixed(1)}%</span>
                </span>
              </Tooltip>
            );
          })}
          <Tooltip
            placement="bottom"
            overlayStyle={{ maxWidth: 560 }}
            title={
              <div className={s.rowTip}>
                <span className={s.rowTipTitle}>
                  成功样本后 {FOLLOW_UP_DAYS} 日最低价低于成功线（开盘×2）的幅度 · 每 10 个点一档（共{' '}
                  {stats?.success || 0} 条）
                </span>
                <div className={s.rowTipChips}>
                  {dropBuckets.length === 0 ? (
                    <span>暂无数据</span>
                  ) : (
                    dropBuckets.map(item => (
                      <span key={item.label} className={cx(s.distItem, s.distItemStatic)}>
                        <span className={s.distLabel}>-{item.label}%</span>
                        <span className={s.distCount}>{item.count}</span>
                        <span className={s.distPct}>{item.pct.toFixed(1)}%</span>
                      </span>
                    ))
                  )}
                </div>
              </div>
            }
          >
            <span className={s.conclusionTag}>回抽深度</span>
          </Tooltip>
        </div>
      )}

      <div className={s.metaRow}>
        <span className={s.ruleText}>
          某日最高价 &gt; 开盘价 ×2 记为标记日（上架未满{' '}
          {MIN_LISTING_DAYS} 天、或当日最高价为历史新高除外），其后 {FOLLOW_UP_DAYS} 个交易日最低价 &lt;
          开盘价 ×2 判定成功，不足 {FOLLOW_UP_DAYS} 天不计入
        </span>
        <div className={s.actions}>
          {displayRows.length > 0 && <span className={s.countBadge}>共 {displayRows.length} 条</span>}
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            loading={running}
            onClick={run}
          >
            {running ? '回测中...' : rows.length ? '重新回测' : '开始全量回测'}
          </Button>
          {running && (
            <Button size="small" onClick={stop}>
              停止
            </Button>
          )}
        </div>
      </div>

      <div className={s.filterRow}>
        {STATUS_FILTERS.map(item => (
          <span
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
            className={cx(s.filterChip, statusFilter === item.key && s.filterChipActive)}
          >
            {item.label}
          </span>
        ))}
        <span className={s.muted}>|</span>
        {EX_FILTERS.map(item => (
          <span
            key={item.key}
            onClick={() => setExFilter(item.key)}
            className={cx(s.filterChip, exFilter === item.key && s.filterChipActive)}
          >
            {item.label}
          </span>
        ))}
        <input
          className={s.search}
          placeholder="筛选币对"
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
        />
      </div>

      {progress.total > 0 && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div className={s.progressBar} style={{ width: `${percent}%` }} />
          </div>
          <span className={s.progressText}>
            {progress.done}/{progress.total}
            {progress.symbol
              ? ` · ${progress.exchange === 'binance' ? 'BN' : 'BG'} ${progress.symbol} · ${
                  progress.page
                }页/${progress.candles}根`
              : ''}
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className={s.errorBox}>
          {errors.length} 个币对拉取失败（不计入统计）：
          {errors
            .slice(0, 6)
            .map(item => `${item.exchange === 'binance' ? 'BN' : 'BG'} ${item.symbol}`)
            .join('、')}
          {errors.length > 6 ? ` 等 ${errors.length} 个` : ''}
        </div>
      )}

      <ResultList
        key={`${statusFilter}-${riseRange?.start ?? 'all'}`}
        columns={columns}
        rows={displayRows}
        empty={running ? '回测中...' : '点击「开始全量回测」获取数据'}
        defaultSort={{ key: 'markerDate', dir: 'desc' }}
        highlightKey={stats?.maxHighVsThresholdKey}
      />
    </div>
  );
};

export default Rise100Backtest;
