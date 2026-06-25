import React from 'react';
import { Table, Tag } from 'antd';
import { Section, TradeCard, Row, Callout, RuleCard, MetricGrid } from './_components';

// ── 一、交易明细 ──────────────────────────────────────────────
const tradeData = [
  {
    key: 1,
    no: 1,
    symbol: 'STGUSDT',
    entry: '0.272',
    exit: '0.211',
    duration: '5天',
    pnl: '+18.82',
    r: '+1.88R',
    compliant: 'ok',
  },
  {
    key: 2,
    no: 2,
    symbol: 'ORDERUSDT',
    entry: '0.06402',
    exit: '0.06022',
    duration: '4天',
    pnl: '+4.61',
    r: '+0.46R',
    compliant: 'ok',
  },
  {
    key: 3,
    no: 3,
    symbol: 'JCTUSDT（第1次）',
    entry: '0.003704',
    exit: '0.00369',
    duration: '1天',
    pnl: '+0.28',
    r: '≈ 0R',
    compliant: 'ok',
  },
  {
    key: 4,
    no: 4,
    symbol: 'JCTUSDT（第2次）',
    entry: '0.00392',
    exit: '0.003568',
    duration: '17小时',
    pnl: '+7.06',
    r: '+0.71R',
    compliant: 'ok',
  },
  {
    key: 5,
    no: 5,
    symbol: 'BOBUSDT',
    entry: '0.0082',
    exit: '0.00912',
    duration: '10小时',
    pnl: '-11.12',
    r: '-1R',
    compliant: 'no',
  },
  {
    key: 6,
    no: 6,
    symbol: 'SKYAIUSDT',
    entry: '0.13',
    exit: '0.1495',
    duration: '17分钟',
    pnl: '-10.40',
    r: '-1R',
    compliant: 'no',
  },
];

const tradeColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 145 },
  { title: '入场价', dataIndex: 'entry', width: 88 },
  { title: '出场价', dataIndex: 'exit', width: 88 },
  { title: '持仓', dataIndex: 'duration', width: 72 },
  {
    title: '盈亏(U)',
    dataIndex: 'pnl',
    width: 80,
    render: v => (
      <span style={{ color: v.startsWith('+') ? '#52c41a' : '#f5222d', fontWeight: 600 }}>{v}</span>
    ),
  },
  {
    title: 'R值',
    dataIndex: 'r',
    width: 76,
    render: v => (
      <span
        style={{
          color: v.startsWith('+') ? '#52c41a' : v.startsWith('-') ? '#f5222d' : '#888',
          fontWeight: 600,
        }}
      >
        {v}
      </span>
    ),
  },
  {
    title: '合规',
    dataIndex: 'compliant',
    width: 72,
    render: v => (v === 'ok' ? <Tag color="green">合规</Tag> : <Tag color="red">违规</Tag>),
  },
];

// ── 三、执行质量 ──────────────────────────────────────────────
const qualityData = [
  { key: 1, no: 1, symbol: 'STGUSDT', compliant: 'ok', reason: '入场、持仓、出场全程符合系统逻辑' },
  {
    key: 2,
    no: 2,
    symbol: 'ORDERUSDT',
    compliant: 'ok',
    reason: '入场偏早（缩量2天），但规则尚未明确，不溯及既往',
  },
  {
    key: 3,
    no: 3,
    symbol: 'JCTUSDT（第1次）',
    compliant: 'ok',
    reason: '止损管理得当，被插针出场后未情绪化追单',
  },
  {
    key: 4,
    no: 4,
    symbol: 'JCTUSDT（第2次）',
    compliant: 'ok',
    reason: '合理再入场，信号条件重新满足',
  },
  {
    key: 5,
    no: 5,
    symbol: 'BOBUSDT',
    compliant: 'no',
    reason: '横盘期间实体仍在上移未识别；止损设在前高以下被精确触发',
  },
  {
    key: 6,
    no: 6,
    symbol: 'SKYAIUSDT',
    compliant: 'no',
    reason: '横盘不充分；当前处历史高位无阻力；夜间委托成交后被爆拉止损',
  },
];

const qualityColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 145 },
  {
    title: '合规',
    dataIndex: 'compliant',
    width: 72,
    render: v => (v === 'ok' ? <Tag color="green">合规</Tag> : <Tag color="red">违规</Tag>),
  },
  { title: '说明', dataIndex: 'reason' },
];

const Phase1 = () => (
  <div>
    <Section title="一、交易明细">
      <Table
        columns={tradeColumns}
        dataSource={tradeData}
        pagination={false}
        size="small"
        scroll={{ x: 580 }}
      />
    </Section>

    <Section title="二、阶段指标">
      <MetricGrid
        items={[
          { label: '交易笔数', value: '6' },
          { label: '胜率', value: '67%（4/6）', color: '#888' },
          { label: '总 R', value: '+0.93R', color: '#52c41a' },
          { label: '均值 R/笔', value: '+0.16R', color: '#888' },
          { label: '最大单笔盈利', value: '+1.88R（STGUSDT）', color: '#52c41a' },
          { label: '最大单笔亏损', value: '-1R（×2）', color: '#f5222d' },
          { label: '违规笔数', value: '2', color: '#f5222d' },
          { label: '合规交易均值', value: '+0.76R/笔', color: '#52c41a' },
        ]}
      />
      <Callout type="warning">
        合规交易均值 +0.76R，违规交易均值 -1R。数据直接说明问题不在系统，在执行。
      </Callout>
    </Section>

    <Section title="三、执行质量">
      <Table columns={qualityColumns} dataSource={qualityData} pagination={false} size="small" />
    </Section>

    <Section title="四、逐笔诊断">
      <TradeCard color="green" title="STGUSDT +1.88R">
        <Row label="入场理由">
          放量长上影线 → 缩量观察 2 天盈亏比不足 → 再涨 10% → 再缩量横盘 2 天，第 2 天十字星，第 3
          天入场
        </Row>
        <Row label="出场方式">下跌 4 天，收益达 2R 后移动止盈，第 5 天自然触发</Row>
        <Row label="结论">耐心等信号、严格执行出场，是本阶段标杆。</Row>
      </TradeCard>

      <TradeCard color="green" title="ORDERUSDT +0.46R">
        <Row label="入场理由">缩量 + 实体萎缩第 2 天入场（偏早，3 天规则尚未建立）</Row>
        <Row label="出场方式">盈利超 1R 后设止损线，被一根 15% 插针触发出场</Row>
        <Row label="结论">入场和出场逻辑均合理；插针属币种波动特征，非系统问题。</Row>
      </TradeCard>

      <TradeCard color="green" title="JCTUSDT 第1次 ≈ 0R">
        <Row label="入场理由">暴涨横盘锤子线后 1 天入场，逻辑成立</Row>
        <Row label="出场方式">盈利 1.5R 后止损移到成本价，被 20% 插针触发出场</Row>
        <Row label="结论">止损保护到位；出场后观察形态而非情绪追单，操作正确。</Row>
      </TradeCard>

      <TradeCard color="green" title="JCTUSDT 第2次 +0.71R">
        <Row label="入场理由">
          第 1 次止损出局后，量缩横盘延续，价格回到高点附近，盈亏比重新合格，再次入场
        </Row>
        <Row label="出场方式">移动止盈触发出场</Row>
        <Row label="结论">合理再入场，不是追单，信号条件重新满足。</Row>
      </TradeCard>

      <TradeCard color="red" title="BOBUSDT -1R">
        <Row label="入场理由">
          放量涨 20% → 震荡横盘三天后选相对高位入场（实体仍在向上爬未识别）
        </Row>
        <Row label="出场方式">1R 止损，夜间精确触发后价格回归</Row>
        <Row label="结论">两个错误：横盘不充分；止损设在前高以下。止损设置是明确的执行失误。</Row>
      </TradeCard>

      <TradeCard color="red" title="SKYAIUSDT -1R">
        <Row label="入场理由">
          放量暴涨 60% → 横盘 4 天，第 4
          天十字星认为变盘，夜间挂委托单（实体振幅仍大；处历史高位无阻力）
        </Row>
        <Row label="出场方式">夜间委托成交后被爆拉 60%，1R 止损出局</Row>
        <Row label="结论">
          三个问题叠加：横盘不充分、高位无阻力锚点、夜间执行。同样的十字星在 STGUSDT
          里有层层收敛铺垫，这里没有。
        </Row>
      </TradeCard>
    </Section>

    <Section title="五、规则变更">
      <RuleCard no="新增 5.1" title="最早入场时间：连续缩量横盘 ≥ 3 天">
        来源：BOBUSDT、SKYAIUSDT 均在横盘不充分时过早入场。第 2 天任何形态不构成入场理由。
      </RuleCard>
      <RuleCard no="新增 5.2" title="止损位置：设在横盘区间上沿或确认 K 线最高价以上">
        来源：BOBUSDT 止损设在前高以下，被精确触发后价格回归。
      </RuleCard>
      <RuleCard no="新增 5.3" title="睡前撤单：未成交开仓委托单全部取消">
        来源：BOBUSDT、SKYAIUSDT 均为夜间成交，夜间流动性差，成交质量低。
      </RuleCard>
      <RuleCard no="新增 5.4" title="失效价检查：次日价格突破失效价则放弃">
        失效价 = 横盘区间上沿。信号日收盘后挂单，次日若价格已突破，当日不入场。
      </RuleCard>
      <RuleCard no="新增 5.5" title="时间窗口上限：暴涨后 7 天内未出现信号则移除">
        超过 7 天的横盘性质已改变，从"衰竭"变为"平台蓄力"，属于另一套逻辑。
      </RuleCard>
    </Section>

    <Section title="六、遗留问题">
      <ul style={{ fontSize: 13, lineHeight: 2, paddingLeft: 20, color: '#444' }}>
        <li>出场幅度：移动止盈的触发比例是否合理？插针触发是否属于应该接受的代价？</li>
        <li>样本量不足：4 笔合规交易的 +0.76R 均值，置信区间很宽，待更多样本验证。</li>
      </ul>
    </Section>

    <Section title="七、下阶段目标">
      <Callout type="info">
        连续 6 笔全合规（零违规）。不以盈亏评价，只以执行是否符合系统规则评价。
      </Callout>
    </Section>
  </div>
);

export default Phase1;
