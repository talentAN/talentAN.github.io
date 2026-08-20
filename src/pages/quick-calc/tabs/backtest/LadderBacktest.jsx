import React, { useMemo, useState } from 'react';
import { Button, InputNumber } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getTradeUrl } from '@root/src/container/market';
import { DEFAULT_LADDER, EXIT_TYPES, runLadder, summarizeLadder } from './_ladderRules';
import { useMarkerScan } from './_useMarkerScan';
import ResultList from './_ResultList';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const fmtU = value =>
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}U`;

const fmtMult = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(2)}×`;

const EXIT_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'target', label: '止盈' },
  { key: 'stop', label: '止损' },
  { key: 'newHigh', label: '结构失效' },
  { key: 'open', label: '未结束' },
  { key: 'none', label: '未成交' },
];

const exitTone = (type, styles) => {
  if (type === 'target') return styles.badgeGreen;
  if (type === 'stop') return styles.badgeRed;
  if (type === 'newHigh') return styles.badgeOrange || styles.badgeRed;
  return styles.badgeGrey;
};

const LadderBacktest = () => {
  const { markers, errors, running, progress, percent, run, stop } = useMarkerScan();
  const [capital, setCapital] = useState(DEFAULT_LADDER.capital);
  const [levels, setLevels] = useState(DEFAULT_LADDER.levels);
  const [stopMult, setStopMult] = useState(DEFAULT_LADDER.stopMult);
  const [targetMult, setTargetMult] = useState(DEFAULT_LADDER.targetMult);
  const [windowDays, setWindowDays] = useState(DEFAULT_LADDER.windowDays);
  const [exitFilter, setExitFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  const cfg = useMemo(
    () => ({
      ...DEFAULT_LADDER,
      capital,
      levels,
      stopMult,
      targetMult,
      windowDays,
    }),
    [capital, levels, stopMult, targetMult, windowDays]
  );

  const rows = useMemo(() => runLadder(markers, cfg), [markers, cfg]);
  const stats = useMemo(() => summarizeLadder(rows, cfg), [rows, cfg]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    return rows.filter(row => {
      if (query && !row.symbol.includes(query)) return false;
      if (exitFilter !== 'all' && row.exitType !== exitFilter) return false;
      return true;
    });
  }, [rows, keyword, exitFilter]);

  const totalNotional = levels.reduce((sum, level) => sum + level.notional, 0);

  const updateLevel = (index, field, value) =>
    setLevels(prev => prev.map((item, i) => (i === index ? { ...item, [field]: Number(value) || 0 } : item)));

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 110,
      render: row => (
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
      ),
    },
    {
      key: 'markerDate',
      title: '标记日',
      width: 95,
      sortBy: row => row.markerDate,
      render: row => <span className={s.muted}>{row.markerDate}</span>,
    },
    {
      key: 'filled',
      title: '成交层',
      width: 70,
      align: 'center',
      sortBy: row => row.filled,
      render: row => (row.filled ? `${row.filled}/${levels.length}` : <span className={s.muted}>—</span>),
    },
    {
      key: 'notional',
      title: '名义',
      width: 80,
      align: 'right',
      sortBy: row => row.notional,
      render: row => (row.notional ? `${row.notional}U` : <span className={s.muted}>—</span>),
    },
    {
      key: 'avgEntryMult',
      title: '均价(×开盘)',
      width: 95,
      align: 'right',
      sortBy: row => row.avgEntryMult,
      render: row => fmtMult(row.avgEntryMult),
    },
    {
      key: 'maxHighMult',
      title: '持仓最高(×开盘)',
      width: 115,
      align: 'right',
      sortBy: row => row.maxHighMult,
      render: row => fmtMult(row.maxHighMult),
    },
    {
      key: 'peakLoss',
      title: '峰值浮亏',
      width: 90,
      align: 'right',
      sortBy: row => row.peakLoss,
      render: row =>
        row.peakLoss == null ? <span className={s.muted}>—</span> : <span className={s.statRed}>{fmtU(row.peakLoss)}</span>,
    },
    {
      key: 'exitMult',
      title: '出场(×开盘)',
      width: 95,
      align: 'right',
      sortBy: row => row.exitMult,
      render: row => fmtMult(row.exitMult),
    },
    {
      key: 'holdDays',
      title: '持仓日',
      width: 70,
      align: 'right',
      sortBy: row => row.holdDays,
      render: row => (row.holdDays == null ? <span className={s.muted}>—</span> : row.holdDays),
    },
    {
      key: 'exitType',
      title: '出场',
      width: 80,
      align: 'center',
      sortBy: row => row.exitType,
      render: row => (
        <span className={cx(s.badge, exitTone(row.exitType, s))}>{EXIT_TYPES[row.exitType]}</span>
      ),
    },
    {
      key: 'pnl',
      title: '盈亏',
      width: 90,
      align: 'right',
      sortBy: row => row.pnl,
      render: row =>
        row.filled === 0 ? (
          <span className={s.muted}>—</span>
        ) : (
          <span className={row.pnl >= 0 ? s.statGreen : s.statRed}>{fmtU(row.pnl)}</span>
        ),
    },
  ];

  return (
    <div>
      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>总盈亏</span>
          <span className={cx(s.statValue, stats.pnl >= 0 ? s.statGreen : s.statRed)}>
            {fmtU(stats.pnl)}
          </span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>占本金</span>
          <span className={cx(s.statValue, stats.pnlPct >= 0 ? s.statGreen : s.statRed)}>
            {stats.pnl ? `${stats.pnlPct >= 0 ? '+' : ''}${stats.pnlPct.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>胜率</span>
          <span className={cx(s.statValue, s.statBlue)}>
            {stats.winRate == null ? '—' : `${stats.winRate.toFixed(1)}%`}
          </span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>标记/成交</span>
          <span className={s.statValue}>
            {stats.total}/{stats.traded}
          </span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>止盈</span>
          <span className={cx(s.statValue, s.statGreen)}>{stats.target}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>止损</span>
          <span className={cx(s.statValue, s.statRed)}>{stats.stop}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>结构失效</span>
          <span className={s.statValue}>{stats.newHigh}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>单笔最差</span>
          <span className={cx(s.statValue, s.statRed)}>{fmtU(stats.worst)}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>峰值浮亏</span>
          <span className={cx(s.statValue, s.statRed)}>{fmtU(stats.peakLoss)}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>盈亏比</span>
          <span className={s.statValue}>
            {stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}
          </span>
        </div>
      </div>

      <div className={s.ladderBar}>
        <span className={s.distTitle}>本金</span>
        <InputNumber size="small" min={100} step={1000} value={capital} onChange={setCapital} style={{ width: 90 }} />
        {levels.map((level, index) => (
          <span key={index} className={s.ladderItem}>
            <span className={s.distLabel}>L{index + 1}</span>
            <InputNumber
              size="small"
              min={1.1}
              step={0.1}
              value={level.mult}
              onChange={value => updateLevel(index, 'mult', value)}
              style={{ width: 62 }}
            />
            <span className={s.distLabel}>×开盘</span>
            <InputNumber
              size="small"
              min={0}
              step={10}
              value={level.notional}
              onChange={value => updateLevel(index, 'notional', value)}
              style={{ width: 68 }}
            />
            <span className={s.distLabel}>U</span>
          </span>
        ))}
        <span className={s.distTitle}>止损</span>
        <InputNumber size="small" min={1.1} step={0.1} value={stopMult} onChange={setStopMult} style={{ width: 62 }} />
        <span className={s.distTitle}>止盈</span>
        <InputNumber size="small" min={0.1} step={0.1} value={targetMult} onChange={setTargetMult} style={{ width: 62 }} />
        <span className={s.distTitle}>窗口</span>
        <InputNumber size="small" min={1} step={10} value={windowDays} onChange={setWindowDays} style={{ width: 62 }} />
        <span className={s.distTitle}>天</span>
        <span className={s.countBadge}>总名义 {totalNotional}U（本金 {((totalNotional / capital) * 100).toFixed(1)}%）</span>
      </div>

      <div className={s.metaRow}>
        <span className={s.ruleText}>
          标记日确认后一次性挂出全部限价空单，成交后不再加仓；同日先判止损再判止盈（对空单取最坏顺序），
          收盘站上标记日最高价按结构失效离场。标记日样本与「涨幅100%回测」共用同一次扫描。
        </span>
        <div className={s.actions}>
          {displayRows.length > 0 && <span className={s.countBadge}>共 {displayRows.length} 条</span>}
          <Button size="small" type="primary" icon={<ReloadOutlined />} loading={running} onClick={run}>
            {running ? '扫描中...' : markers.length ? '重新扫描' : '开始全量扫描'}
          </Button>
          {running && (
            <Button size="small" onClick={stop}>
              停止
            </Button>
          )}
        </div>
      </div>

      <div className={s.filterRow}>
        {EXIT_FILTERS.map(item => (
          <span
            key={item.key}
            onClick={() => setExitFilter(item.key)}
            className={cx(s.filterChip, exitFilter === item.key && s.filterChipActive)}
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
              ? ` · ${progress.exchange === 'binance' ? 'BN' : 'BG'} ${progress.symbol}`
              : ''}
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className={s.errorBox}>{errors.length} 个币对拉取失败（不计入统计）</div>
      )}

      <ResultList
        key={exitFilter}
        columns={columns}
        rows={displayRows}
        empty={running ? '扫描中...' : '点击「开始全量扫描」，或先在「涨幅100%回测」跑一次'}
        defaultSort={{ key: 'pnl', dir: 'asc' }}
      />
    </div>
  );
};

export default LadderBacktest;
