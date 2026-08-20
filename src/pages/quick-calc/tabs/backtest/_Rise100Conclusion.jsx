import React from 'react';
import { Tooltip } from 'antd';
import * as s from './backtest.module.less';

// 13 条「14 天未回到成功线」样本的逐条复盘（筛选条件的来源）
const FAILED_REVIEW = [
  { tag: '不做', text: 'AKE：横盘两个半月后破位，再连续暴涨创新高' },
  { tag: '不做', text: 'COAI 上线第 12 天 / 0G 刚上线 / PNUT 上线第 3 天，次新无历史可参照' },
  { tag: '不做', text: 'MYX 连续 4 次、HYPER、DOGE：破历史新高且无长上影，是趋势启动不是竭尽' },
  { tag: '可做', text: 'B：区间震荡半年后拉升，约 1 个月内回到成功线' },
  { tag: '可做', text: 'TNSR：下跌中爆拉两天即回落，不加仓也很快回本' },
  { tag: '可做', text: 'ZEREBRO：下跌中突然爆拉，约一个月回本' },
];

const PLAYBOOK = [
  '上架未满 30 天不做；标记日最高价为历史新高不做（已写进标记日判定）',
  '标记日收在最高附近、几乎无上影，偏趋势启动，不做',
  '横盘许久，直接突破或跌破下限后短时间迅速向上突破的，谨慎',
  '单笔面值 10-20U、逐仓，禁止对着浮亏加仓',
  '14 天只是回测窗口：再收新高即视为无效，不必等满 14 天',
];

const Rise100Conclusion = ({ stats }) => {
  const rate = stats.successRate == null ? '—' : `${stats.successRate.toFixed(2)}%`;
  const maxHigh =
    stats.maxHighVsThreshold == null
      ? '—'
      : `${stats.maxHighVsThreshold >= 0 ? '+' : ''}${stats.maxHighVsThreshold.toFixed(1)}%`;

  const content = (
    <div className={s.conclusionBox}>
      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>回测胜率</div>
        <div>
          {rate}（已完成 {stats.completed} / 成功 {stats.success} / 失败 {stats.failed}）。
          口径是「14 天内触及开盘价 ×2」，不等于一笔空单的已实现盈亏；样本量小，别当实盘胜率。
        </div>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>成功线最大涨幅</div>
        <div>
          后 14 日最高价相对成功线最多走出 {maxHigh}。失败按「无上限亏损」设计，胜率再高也不能重仓。
        </div>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>实际操作方式</div>
        <ul className={s.conclusionList}>
          {PLAYBOOK.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>失败币对复盘</div>
        <ul className={s.conclusionList}>
          {FAILED_REVIEW.map(item => (
            <li key={item.text}>
              <span className={item.tag === '可做' ? s.statGreen : s.statRed}>[{item.tag}]</span>{' '}
              {item.text}
            </li>
          ))}
        </ul>
        <div className={s.conclusionFoot}>
          可行的是「100% 标记日 + 非新高 + 非次新 + 小仓不加仓」，不是「见 100% 就空」。
        </div>
      </div>
    </div>
  );

  return (
    <Tooltip title={content} placement="bottomLeft" overlayStyle={{ maxWidth: 520 }}>
      <span className={s.conclusionTag}>结论</span>
    </Tooltip>
  );
};

export default Rise100Conclusion;
