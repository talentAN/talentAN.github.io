import React from 'react';
import { Tooltip } from 'antd';
import * as s from '../backtest/backtest.module.less';

/**
 * 2026-09-24 手工对照快照（成功线：相对上沿 >20%；过滤：向下突破）
 * 用于 hover「结论」展示，非实时计算。
 */
const SNAPSHOTS = [
  {
    mult: '≤1.6',
    time: '16:09:52',
    rate: '88.9%',
    total: 9,
    success: 8,
    failed: 1,
    pending: 0,
    complete: 9,
    buckets: [
      { label: '<0%', count: 0, pct: '0.0%' },
      { label: '0–20%', count: 1, pct: '11.1%' },
      { label: '20–50%', count: 1, pct: '11.1%' },
      { label: '50–100%', count: 5, pct: '55.6%' },
      { label: '100–200%', count: 1, pct: '11.1%' },
      { label: '200–400%', count: 0, pct: '0.0%' },
      { label: '≥400%', count: 1, pct: '11.1%' },
    ],
  },
  {
    mult: '≤1.65',
    time: '16:10:04',
    rate: '84.2%',
    total: 19,
    success: 16,
    failed: 3,
    pending: 0,
    complete: 17,
    buckets: [
      { label: '<0%', count: 1, pct: '5.9%' },
      { label: '0–20%', count: 2, pct: '11.8%' },
      { label: '20–50%', count: 3, pct: '17.6%' },
      { label: '50–100%', count: 5, pct: '29.4%' },
      { label: '100–200%', count: 3, pct: '17.6%' },
      { label: '200–400%', count: 2, pct: '11.8%' },
      { label: '≥400%', count: 1, pct: '5.9%' },
    ],
  },
  {
    mult: '≤1.8',
    time: '16:10:25',
    rate: '77.7%',
    total: 113,
    success: 87,
    failed: 25,
    pending: 1,
    complete: 105,
    buckets: [
      { label: '<0%', count: 8, pct: '7.6%' },
      { label: '0–20%', count: 17, pct: '16.2%' },
      { label: '20–50%', count: 34, pct: '32.4%' },
      { label: '50–100%', count: 22, pct: '21.0%' },
      { label: '100–200%', count: 13, pct: '12.4%' },
      { label: '200–400%', count: 7, pct: '6.7%' },
      { label: '≥400%', count: 4, pct: '3.8%' },
    ],
  },
  {
    mult: '≤1.85',
    time: '16:10:37',
    rate: '71.7%',
    total: 227,
    success: 160,
    failed: 63,
    pending: 4,
    complete: 213,
    buckets: [
      { label: '<0%', count: 15, pct: '7.0%' },
      { label: '0–20%', count: 48, pct: '22.5%' },
      { label: '20–50%', count: 60, pct: '28.2%' },
      { label: '50–100%', count: 49, pct: '23.0%' },
      { label: '100–200%', count: 27, pct: '12.7%' },
      { label: '200–400%', count: 9, pct: '4.2%' },
      { label: '≥400%', count: 5, pct: '2.3%' },
    ],
  },
];

const LowVolRangeBlastConclusion = () => {
  const content = (
    <div className={s.conclusionBox}>
      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>口径（2026-09-24 快照）</div>
        <div>
          v0.5 · 过滤向下突破 · 成功线：相对上沿 &gt;20%（可提前记成功）· 仅改高低比上限对照。
          样本量随阈值变严而变少，胜率与样本要一起看，勿只盯最高胜率。
        </div>
      </div>

      {SNAPSHOTS.map(item => (
        <div key={item.mult} className={s.conclusionSection}>
          <div className={s.conclusionTitle}>
            高低比 {item.mult}
            <span className={s.muted} style={{ marginLeft: 8, fontWeight: 400 }}>
              {item.time}
            </span>
          </div>
          <div>
            成功率 <strong className={s.statBlue}>{item.rate}</strong>
            （标记 {item.total} / 成功 {item.success} / 失败 {item.failed} / 待观察 {item.pending}）
            · 完整样本 {item.complete}
          </div>
          <div className={s.rowTipChips} style={{ marginTop: 6 }}>
            {item.buckets.map(bucket => (
              <span key={bucket.label} className={`${s.distItem} ${s.distItemStatic}`}>
                <span className={s.distLabel}>{bucket.label}</span>
                <span className={s.distCount}>{bucket.count}</span>
                <span className={s.distPct}>{bucket.pct}</span>
              </span>
            ))}
          </div>
        </div>
      ))}

      <div className={s.conclusionFoot}>
        读法：≤1.6 胜率最高但仅 9 条；≤1.8 约 78% / 113 条，样本与胜率折中更常作试验口径。
      </div>
    </div>
  );

  return (
    <Tooltip title={content} placement="bottomLeft" overlayStyle={{ maxWidth: 560 }}>
      <span className={s.conclusionTag}>结论</span>
    </Tooltip>
  );
};

export default LowVolRangeBlastConclusion;
