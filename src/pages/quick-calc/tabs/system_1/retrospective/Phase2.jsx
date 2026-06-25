import React from 'react';
import { Table, Tag } from 'antd';
import { Section, TradeCard, Row, Callout, RuleCard, MetricGrid } from './_components';

// ── 一、交易明细 ──────────────────────────────────────────────
const tradeData = [
  {
    key: 1,
    no: 7,
    symbol: 'PROMUSDT',
    entry: '2.46',
    exit: '1.5586',
    duration: '21天',
    pnl: '+18.44',
    r: '+1.84R',
    compliant: 'partial',
  },
  {
    key: 2,
    no: 8,
    symbol: 'IRYSUSDT',
    entry: '0.03735',
    exit: '0.03729',
    duration: '2.5小时',
    pnl: '+0.13',
    r: '≈ 0R',
    compliant: 'ok',
  },
  {
    key: 3,
    no: 9,
    symbol: 'HUSDT',
    entry: '0.28221',
    exit: '0.2393',
    duration: '10小时',
    pnl: '+14.93',
    r: '+1.49R',
    compliant: 'partial',
  },
  {
    key: 4,
    no: 10,
    symbol: 'INUSDT',
    entry: '0.11145',
    exit: '0.09658',
    duration: '4天',
    pnl: '+9.91',
    r: '+0.99R',
    compliant: 'ok',
  },
  {
    key: 5,
    no: 11,
    symbol: 'GWEIUSDT',
    entry: '0.183',
    exit: '0.12682',
    duration: '11天',
    pnl: '+31.13',
    r: '+3.11R',
    compliant: 'ok',
  },
  {
    key: 6,
    no: 12,
    symbol: 'BEATUSDT',
    entry: '10.52',
    exit: '7.455',
    duration: '9小时',
    pnl: '+30.54',
    r: '+3.05R',
    compliant: 'partial',
  },
];

const tradeColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 110 },
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
    width: 80,
    render: v =>
      v === 'ok' ? (
        <Tag color="green">合规</Tag>
      ) : v === 'partial' ? (
        <Tag color="orange">基本合规</Tag>
      ) : (
        <Tag color="red">违规</Tag>
      ),
  },
];

// ── 三、执行质量 ──────────────────────────────────────────────
const qualityData = [
  {
    key: 1,
    no: 7,
    symbol: 'PROMUSDT',
    compliant: 'partial',
    reason: '变体入场信号（非标准缩量横盘），止损和持仓管理执行正确',
  },
  {
    key: 2,
    no: 8,
    symbol: 'IRYSUSDT',
    compliant: 'ok',
    reason: '入场合理；成交后识别信号可能失效，防御性平仓执行正确',
  },
  {
    key: 3,
    no: 9,
    symbol: 'HUSDT',
    compliant: 'partial',
    reason: '主动选择次高点入场，非最优入场位，依据尚不明确',
  },
  { key: 4, no: 10, symbol: 'INUSDT', compliant: 'ok', reason: '标准执行，无异常' },
  { key: 5, no: 11, symbol: 'GWEIUSDT', compliant: 'ok', reason: '标准执行，全程无干预' },
  {
    key: 6,
    no: 12,
    symbol: 'BEATUSDT',
    compliant: 'partial',
    reason: '变体信号（量价背离末端），入场和出场逻辑清晰',
  },
];

const qualityColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 110 },
  {
    title: '合规',
    dataIndex: 'compliant',
    width: 80,
    render: v =>
      v === 'ok' ? (
        <Tag color="green">合规</Tag>
      ) : v === 'partial' ? (
        <Tag color="orange">基本合规</Tag>
      ) : (
        <Tag color="red">违规</Tag>
      ),
  },
  { title: '说明', dataIndex: 'reason' },
];

const Phase2 = () => (
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
          { label: '胜率', value: '100%（6/6）', color: '#52c41a' },
          { label: '总 R', value: '+10.48R', color: '#52c41a' },
          { label: '均值 R/笔', value: '+1.75R', color: '#52c41a' },
          { label: '最大单笔盈利', value: '+3.11R（GWEIUSDT）', color: '#52c41a' },
          { label: '最大单笔亏损', value: '无', color: '#52c41a' },
          { label: '违规笔数', value: '0', color: '#52c41a' },
          { label: '对比第一阶段', value: '均值 +0.16R → +1.75R', color: '#1677ff' },
        ]}
      />
      <Callout type="info">
        去掉 GWEIUSDT 和 BEATUSDT 两笔大单，剩余 4 笔均值仍达
        +0.83R，高于第一阶段合规交易均值（+0.76R）。 提升来自执行纪律，不依赖单笔大单。
      </Callout>
    </Section>

    <Section title="三、执行质量">
      <Table columns={qualityColumns} dataSource={qualityData} pagination={false} size="small" />
      <Callout type="success" style={{ marginTop: 10 }}>
        本阶段零违规。第一阶段确认的两个主要问题（夜间委托、止损位置）均未复现。
      </Callout>
    </Section>

    <Section title="四、逐笔诊断">
      <TradeCard color="green" title="GWEIUSDT +3.11R">
        <Row label="入场理由">缩量第 3 天高位开仓，标准信号</Row>
        <Row label="出场方式">移动止盈自然触发，持仓 11 天，最高盈利 4.6R</Row>
        <Row label="结论">本阶段标杆交易，全程无干预，系统规则执行完整。</Row>
      </TradeCard>

      <TradeCard color="green" title="BEATUSDT +3.05R">
        <Row label="入场理由">
          量递增价递增 → 量递减价仍涨 → 量缩至高点一半时出长上影线 →
          次日委托高点入场（变体：量价背离末端）
        </Row>
        <Row label="出场方式">
          被一根长上影线触发移动止盈，持仓 9 小时；此后价格继续下跌至 1.7（潜在最大约 8R）
        </Row>
        <Row label="结论">变体信号执行合理；移动止盈被提前触发是机制代价，不是执行错误。</Row>
      </TradeCard>

      <TradeCard color="green" title="PROMUSDT +1.84R">
        <Row label="入场理由">
          暴涨后缩量大阳线拉回接近高位，第三高点附近开仓（变体：非标准缩量横盘）
        </Row>
        <Row label="出场方式">持仓 21 天，价格始终未触及止损线，移动止盈自然触发</Row>
        <Row label="结论">方向判断正确，持仓期间始终浮盈，按规则持有。</Row>
      </TradeCard>

      <TradeCard color="green" title="HUSDT +1.49R">
        <Row label="入场理由">主动选择次高点挂委托单（非最高点入场）</Row>
        <Row label="出场方式">持仓 10 小时，移动止盈触发，最高盈利 2.4R，实际出场 1.49R</Row>
        <Row label="结论">盈利，但次高点入场的依据尚未明确，不能复用直到逻辑清晰。</Row>
      </TradeCard>

      <TradeCard color="green" title="INUSDT +0.99R">
        <Row label="入场理由">缩量第 4 天高位入场，标准信号，入场最优差仅 0.61%</Row>
        <Row label="出场方式">移动止盈触发出场</Row>
        <Row label="结论">标准执行，无需额外说明。</Row>
      </TradeCard>

      <TradeCard color="green" title="IRYSUSDT ≈ 0R">
        <Row label="入场理由">暴涨后高位横盘一周，挂单成交，入场逻辑成立</Row>
        <Row label="出场方式">
          成交后复盘判断信号可能失效（形态更像低位突破 + BTC 同日强势），防御性平仓
        </Row>
        <Row label="结论">
          防御性平仓执行正确；事后价格上涨不影响这个判断——出场决策须在信息已知时评价，不能用事后价格倒推。
        </Row>
      </TradeCard>
    </Section>

    <Section title="五、规则变更">
      <RuleCard no="新增" title="防御性平仓：识别信号失效时主动退出">
        来源：IRYSUSDT 入场后复盘判断信号可能失效，防御性平仓执行正确，将该经验显式写入规则。
        触发条件（满足其一）：入场后复盘判断信号可能有误；BTC/ETH 同日出现明显反向强势。
        与止损不同，不需要触及止损线，主动判断退出。
      </RuleCard>
    </Section>

    <Section title="六、遗留问题">
      <ul style={{ fontSize: 13, lineHeight: 2, paddingLeft: 20, color: '#444' }}>
        <li>
          <strong>4R 直接止盈假设：</strong>GWEIUSDT 最高 4.6R 实际出场 3.11R，BEATUSDT 潜在 8R+
          实际出场 3.05R。 是否应在达到 4R 时主动平仓？需要更多达到 4R
          的样本才能下结论，当前不修改规则。
        </li>
        <li>
          <strong>次高点入场：</strong>HUSDT 主动选择次高点，依据尚不明确。
          下一阶段若再次出现类似操作，需要在备注中记录入场位置选择的具体理由。
        </li>
        <li>
          <strong>变体信号的边界：</strong>PROMUSDT 和 BEATUSDT 均为变体信号且盈利，
          但变体与违规之间的边界尚未明确定义。
        </li>
      </ul>
    </Section>

    <Section title="七、下阶段目标">
      <Callout type="info">
        每笔交易记录最高浮盈 R 值（用于积累 4R
        止盈假设的验证样本），同时对变体信号制定明确的入场判断标准。
      </Callout>
    </Section>
  </div>
);

export default Phase2;
