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

// 分批止盈：档位按 146 条成功样本的回抽深度定，末档留跟踪止盈吃深尾
const EXIT_LEVELS = [
  { label: 'T1', price: '1.6 × O', size: '平 25%', hit: '95.2% 成功样本到达' },
  { label: 'T2', price: '1.4 × O', size: '平 30%', hit: '85.6%' },
  { label: 'T3', price: '1.0 × O', size: '平 25%', hit: '44.5%（中位深度）' },
  { label: 'R', price: '跟踪止盈', size: '留 20%', hit: '17.1% 能到 0.6 × O' },
];

const SCENARIOS = [
  { fill: '只 L1（多数情况）', avg: '2.00 × O', win: '约 +36U', note: '名义 120U' },
  { fill: 'L1+L2', avg: '2.20 × O', win: '约 +94U', note: '名义 260U' },
  { fill: 'L1~L3', avg: '2.45 × O', win: '约 +180U', note: '名义 420U' },
  { fill: 'L1~L4', avg: '2.77 × O', win: '约 +297U', note: '名义 600U' },
];

const RULES = [
  '总名义封顶 600U（本金 6%）；四层限价单在确认标记日后一次性挂出，之后不手动加仓',
  '逐仓保证金 ≥ 550U（约 1x）。保证金不足会在到 5.0×O 之前被强平，止损参数就失效了',
  '硬止损 5.0×O 全平：满仓成交时亏约 480U（本金 4.8%）',
  '上层是低风险仓：L4 在 4.0×O 进、5.0×O 止损只亏该层 25%，L1 要亏 150%，所以名义越往上越重',
  'T1 成交后止损下移到 3.0×O，先把这笔变成不亏',
  '收盘站上标记日最高价 → 结构失效，立刻平，不等止损',
  '最后 20% 不定点平：T2 成交后跟踪位设 1.4×O，之后每再跌 20% 上移一档',
  '同时最多持有 5 笔，且不能是同一天 / 同一板块的共振（那是 1 笔的 5 倍，不是 5 笔）',
];

const Rise100Playbook = () => {
  const content = (
    <div className={s.conclusionBox}>
      <div className={s.conclusionSection}>
        <div className={s.conclusionTitle}>本金 10000U · O = 标记日开盘价</div>
        <div>
          入场阶梯按「日内涨幅分布」定，止盈档位按 146 条成功样本的回抽深度定：中位深度落在低于成功线
          40-50%（≈1.0-1.2×O），四分之一能跌破 0.8×O。混合预期离场价 1.40×O，一笔 2.0×O 的空单约赚名义的
          30%。
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
