import React from 'react';
import { Tooltip } from 'antd';
import * as s from './backtest.module.less';

// 入场阶梯：越往上概率越低、价格越好，所以名义越往上越重
const ENTRY_LEVELS = [
  { label: 'L1', price: '2.0 × O', notional: '120U', hit: '100%（标记日定义）' },
  { label: 'L2', price: '2.4 × O', notional: '140U', hit: '约 40%' },
  { label: 'L3', price: '3.0 × O', notional: '160U', hit: '约 14%' },
  { label: 'L4', price: '4.0 × O', notional: '180U', hit: '约 6%' },
];

// 分批止盈：按成功样本的回抽深度分布定档，重心压在 1.4×O
const EXIT_LEVELS = [
  { label: 'T1', price: '1.8 × O', size: '平 25%', hit: '96.6% 成功样本到达' },
  { label: 'T2', price: '1.4 × O', size: '平 45%', hit: '79.3%' },
  { label: 'T3', price: '1.1 × O', size: '平 30%', hit: '55.2%' },
];

const SCENARIOS = [
  { fill: '只 L1（多数情况）', avg: '2.00 × O', win: '约 +35U', note: '名义 120U' },
  { fill: 'L1+L2', avg: '2.20 × O', win: '约 +97U', note: '名义 260U' },
  { fill: 'L1~L3', avg: '2.45 × O', win: '约 +185U', note: '名义 420U' },
  { fill: 'L1~L4', avg: '2.77 × O', win: '约 +295U', note: '名义 600U' },
];

const RULES = [
  '总名义封顶 600U（本金 6%）；四层限价单在确认标记日后一次性挂出，之后不手动加仓',
  '逐仓保证金 ≥ 550U（约 1x）。保证金不足会在到 5.0×O 之前被强平，止损参数就失效了',
  '硬止损 5.0×O 全平：满仓成交时亏约 480U（本金 4.8%）',
  'T1 成交后止损下移到 3.2×O，先把这笔变成不亏',
  '收盘站上标记日最高价 → 结构失效，立刻平，不等止损',
  'T3 未到：窗口末或价格反弹回 2.0×O 时平掉剩余',
  '同时最多持有 5 笔，且不能是同一天 / 同一板块的共振（那是 1 笔的 5 倍，不是 5 笔）',
];

const Rise100Playbook = () => {
  const content = (
    <div className={s.conclusionBox}>
      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>本金 10000U · O = 标记日开盘价</div>
        <div>
          入场阶梯按「日内涨幅分布」定，止盈档位按「成功样本回抽深度」定。1.6×O 被 96.6% 的成功样本跌破，
          偏浅，重心下移到 1.4×O。
        </div>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>入场（挂空单）</div>
        <table className={s.playbookTable}>
          <tbody>
            {ENTRY_LEVELS.map(item => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.price}</td>
                <td>{item.notional}</td>
                <td className={s.playbookMuted}>{item.hit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>分批止盈</div>
        <table className={s.playbookTable}>
          <tbody>
            {EXIT_LEVELS.map(item => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.price}</td>
                <td>{item.size}</td>
                <td className={s.playbookMuted}>{item.hit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>各成交情形</div>
        <table className={s.playbookTable}>
          <tbody>
            {SCENARIOS.map(item => (
              <tr key={item.fill}>
                <td>{item.fill}</td>
                <td>{item.avg}</td>
                <td className={s.statGreen}>{item.win}</td>
                <td className={s.playbookMuted}>{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>风控</div>
        <ul className={s.conclusionList}>
          {RULES.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <Tooltip title={content} placement="bottomRight" overlayStyle={{ maxWidth: 560 }}>
      <span className={s.conclusionTag}>操作</span>
    </Tooltip>
  );
};

export default Rise100Playbook;
