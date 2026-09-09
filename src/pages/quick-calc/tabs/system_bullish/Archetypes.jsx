import React, { useMemo, useState } from 'react';
// import reviewSamples from '@root/src/data/market/binance/bullish-base-rate/archetypes-v0.1-review-samples.json';
import DataList from '../system_1/_DataList';
import * as s from '../system_1/pairSelector.module.less';

const reviewSamples = {}
const ALL = 'ALL';
const futuresUrl = symbol => `https://www.binance.com/zh-CN/futures/${symbol}`;
const cx = (...names) => names.filter(Boolean).join(' ');
const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(0)}%`;

const Badge = ({ tone, children }) => (
  <span className={cx(s.badge, s[tone])}>{children}</span>
);

/**
 * 候选分型人工抽检：每型 10 条（含 OTHER 对照）。
 */
const Archetypes = () => {
  const sections = reviewSamples.sections || [];
  const [filter, setFilter] = useState(ALL);

  const rows = useMemo(() => {
    const list = filter === ALL
      ? sections.flatMap(section => section.rows)
      : (sections.find(section => section.key === filter)?.rows || []);
    return list;
  }, [filter, sections]);

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 130,
      render: row => (
        <a className={s.symbolLink} href={futuresUrl(row.symbol)} target="_blank" rel="noreferrer">
          {row.symbol}
        </a>
      ),
    },
    {
      key: 'judgeDate',
      title: '成功开仓日',
      width: 110,
      sortBy: row => row.judgeDate,
      render: row => <span className={s.muted}>{row.judgeDate}</span>,
    },
    {
      key: 'archetype',
      title: '分型',
      width: 140,
      render: row => (
        <Badge tone={row.archetype === 'OTHER' ? 'badgeOrange' : 'badgeBlue'}>
          {row.archetypeLabel || row.archetype}
        </Badge>
      ),
    },
    {
      key: 'code',
      title: '代码',
      width: 150,
      render: row => <span className={s.muted}>{row.archetype}</span>,
    },
    {
      key: 'maxRet',
      title: '20日摸到',
      width: 90,
      align: 'right',
      sortBy: row => row.maxRet,
      render: row => fmtPct(row.maxRet),
    },
    {
      key: 'drawdown',
      title: '回撤',
      width: 70,
      align: 'right',
      sortBy: row => row.drawdown,
      render: row => fmtPct(row.drawdown),
    },
    {
      key: 'recovery',
      title: '修复',
      width: 70,
      align: 'right',
      sortBy: row => row.recovery,
      render: row => fmtPct(row.recovery),
    },
    {
      key: 'ret5',
      title: 'ret5',
      width: 70,
      align: 'right',
      sortBy: row => row.ret5,
      render: row => fmtPct(row.ret5),
    },
    {
      key: 'nearVolVsBox',
      title: '近量/箱',
      width: 80,
      align: 'right',
      sortBy: row => row.nearVolVsBox,
      render: row => (
        row.nearVolVsBox == null || !Number.isFinite(row.nearVolVsBox)
          ? '—'
          : `${row.nearVolVsBox.toFixed(1)}x`
      ),
    },
  ];

  const active = sections.find(section => section.key === filter);

  return (
    <div className={s.panel}>
      <div className={s.metaRow} style={{ marginBottom: 8 }}>
        <span className={s.ruleText}>
          候选分型 · 人工抽检（非纯度验收）· 每型约 10 条
        </span>
        <span className={s.countBadge}>{rows.length} 条</span>
      </div>
      <div className={s.filterRow} style={{ marginBottom: 8 }}>
        <span
          className={cx(s.filterChip, filter === ALL && s.filterChipActive)}
          onClick={() => setFilter(ALL)}
        >
          全部
        </span>
        {sections.map(section => (
          <span
            key={section.key}
            className={cx(s.filterChip, filter === section.key && s.filterChipActive)}
            onClick={() => setFilter(section.key)}
          >
            {section.label}({section.rows.length})
          </span>
        ))}
      </div>
      {active && (
        <div className={s.metaRow} style={{ marginBottom: 8 }}>
          <span className={s.ruleText}>{active.label} · {active.oneLiner}</span>
        </div>
      )}
      <DataList columns={columns} rows={rows} empty="无样例" />
    </div>
  );
};

export default Archetypes;
