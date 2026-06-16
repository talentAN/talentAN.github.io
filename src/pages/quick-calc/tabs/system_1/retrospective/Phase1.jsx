import React from 'react';
import { Table, Tag } from 'antd';
import { Section, TradeCard, Row, Callout, CodeBlock, RuleCard, MetricGrid } from './_components';

const tradeData = [
  {
    key: 1,
    no: 1,
    symbol: 'STGUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.272',
    exit: '0.211',
    pnl: '+18.82',
    r: '+1.79R',
    compliant: 'ok',
  },
  {
    key: 2,
    no: 2,
    symbol: 'ORDERUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.06402',
    exit: '0.06022',
    pnl: '+4.61',
    r: '+0.44R',
    compliant: 'partial',
  },
  {
    key: 3,
    no: 3,
    symbol: 'JCTUSDT (第1次)',
    dir: '空',
    lev: '—',
    entry: '0.003704',
    exit: '0.00369',
    pnl: '+0.28',
    r: '≈ 0R',
    compliant: 'partial',
  },
  {
    key: 4,
    no: 4,
    symbol: 'JCTUSDT (第2次)',
    dir: '空',
    lev: '—',
    entry: '0.00392',
    exit: '0.003568',
    pnl: '+7.06',
    r: '+0.67R',
    compliant: 'ok',
  },
  {
    key: 5,
    no: 5,
    symbol: 'BOBUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.0082',
    exit: '0.00912',
    pnl: '-11.12',
    r: '-1R',
    compliant: 'no',
  },
  {
    key: 6,
    no: 6,
    symbol: 'SKYAIUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.13',
    exit: '0.1495',
    pnl: '-10.40',
    r: '-1R',
    compliant: 'no',
  },
];

const tradeColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 150 },
  { title: '方向', dataIndex: 'dir', width: 46 },
  { title: '杠杆', dataIndex: 'lev', width: 54 },
  { title: '入场价', dataIndex: 'entry', width: 88 },
  { title: '出场价', dataIndex: 'exit', width: 88 },
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
    width: 72,
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
    width: 76,
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

const Phase1 = () => (
  <div>
    <Section title="一、交易数据总览">
      <Table
        columns={tradeColumns}
        dataSource={tradeData}
        pagination={false}
        size="small"
        scroll={{ x: 600 }}
      />
    </Section>

    <Section title="二、关键指标">
      <MetricGrid
        items={[
          { label: '总交易笔数', value: '6' },
          { label: '胜率', value: '67%', color: '#52c41a' },
          { label: '净收益', value: '+9.25 U (+0.88R)', color: '#52c41a' },
          { label: '每笔期望值', value: '+0.15R' },
          { label: '最大单笔盈利', value: '+1.79R', color: '#52c41a' },
          { label: '最大单笔亏损', value: '-1R', color: '#f5222d' },
          { label: '观测币对数', value: '43' },
          { label: '入场率', value: '14%' },
        ]}
      />
      <Callout type="info">
        <strong>关键发现：</strong>去掉 STGUSDT 后，其余 5 笔净收益为
        -0.91R。利润高度集中在最符合系统的那一笔。
        <br />
        <strong>仅看合规交易（4 笔）：净收益 +2.90R，每笔期望值 +0.73R。</strong>
        <br />
        严格按系统做的单赚钱，违规的单亏钱。
      </Callout>
    </Section>

    <Section title="三、逐笔诊断">
      <TradeCard color="green" title="✅ STGUSDT — 标杆交易（+1.79R）">
        <Row label="入场">
          放量长上影线 → 缩量 2 天盈亏比不够没入 → 又涨 10% → 再缩量横盘 2 天，第 2 天十字星 → 第 3
          天入场
        </Row>
        <Row label="出场">下跌 4 天，收益达 2R 后设置移动止盈，第 5 天自然止盈</Row>
        <Row label="亮点">耐心等盈亏比、横盘充分（两轮缩量）、移动止盈出场干净</Row>
        <Callout type="success">这笔交易的执行方式是后续 24 笔的模板。</Callout>
      </TradeCard>

      <TradeCard color="green" title="✅ ORDERUSDT — 入场合理，被插针出场（+0.44R）">
        <Row label="入场">缩量 + 实体萎缩第 2 天入场，稍早但信号合理</Row>
        <Row label="出场">盈利超 1R 后设了止损线，被一根 15% 的针打出</Row>
        <Row label="亮点">止损出局后忍住了没有重新开仓，认识到"想重新开空"是冲动型操作</Row>
        <Row label="小结">问题不在操作，在这个币的波动特征</Row>
      </TradeCard>

      <TradeCard color="green" title="✅ JCTUSDT 第1次 — 操作正确但运气不好（≈ 0R）">
        <Row label="入场">暴涨横盘锤子线后一天入场，逻辑成立</Row>
        <Row label="出场">盈利 1.5R 后止损移到成本价，被 20% 的针打出</Row>
        <Row label="亮点">止损保护到位，没亏钱；被打出后观察形态是否被破坏，而不是情绪化操作</Row>
      </TradeCard>

      <TradeCard color="green" title="✅ JCTUSDT 第2次 — 合规再入场（+0.67R）">
        <Row label="入场">第1次止损出局后，量缩横盘延续，价格回到高点附近，盈亏比合适再次入场</Row>
        <Row label="合规依据">
          量缩持续（阶段 2 核心指标满足）；价格在前高附近，符合入场位置逻辑；盈亏比合格
        </Row>
        <Row label="补充">
          当时曾因"实体变大"判为违规，但后续系统迭代中已明确：实体缩比对暴涨日基准区分度极低，且"实体大"不等于方向未明——该指标已从阶段
          2 移除。重新评估后合规。
        </Row>
      </TradeCard>

      <TradeCard color="red" title="❌ BOBUSDT — 两个明确错误（-1R）">
        <Row label="错误1">横盘不够充分。实体整体还在向上爬，尽管缩量也应该避开</Row>
        <Row label="错误2">
          止损价设在前高以下，应该设在前高或阻力位以上，结果被精确触发后价格又回来
        </Row>
        <Row label="备注">还是半夜触发出局</Row>
      </TradeCard>

      <TradeCard color="red" title="❌ SKYAIUSDT — 三个问题叠加（-1R）">
        <Row label="问题1">
          横盘不够充分。前 3 天实体振幅 7-10%，不够小。第 4 天出了十字星，但不是充分收敛后的自然产物
        </Row>
        <Row label="问题2">历史高位无阻力锚点，止损缺乏技术参考</Row>
        <Row label="问题3">半夜委托成交，夜间成交后直接被爆拉 60%</Row>
        <Row label="对比">
          同样是十字星入场，STGUSDT 的十字星前面有层层收敛做铺垫，SKYAIUSDT
          的十字星在实体还很大的时候突然冒出来，可靠程度完全不同
        </Row>
      </TradeCard>
    </Section>

    <Section title="四、核心问题归纳">
      <RuleCard no="问题1" title="入场过早 — 横盘不够充分就进">
        BOBUSDT、SKYAIUSDT
        都有这个问题：量缩不足就认为"差不多了"；把"价格到了一个好的位置"当成入场理由（这是找价格，不是等信号）。
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
          <li>至少连续缩量横盘 3 天，最早第 3 天才能考虑入场</li>
          <li>成交量持续低于暴涨日（具体阈值待样本验证）</li>
          <li>如果"看起来差不多但又不确定"，答案就是再等一天</li>
        </ul>
      </RuleCard>
      <RuleCard no="问题2" title="夜间委托单">
        两笔亏损都是半夜触发止损出局。<strong>改进规则：睡前取消所有未成交的开仓委托单。</strong>
        每天早上 8:00（UTC+0 日线收盘）后重新评估，重新决定。
      </RuleCard>
      <RuleCard no="问题3" title="止损设置不合理">
        BOBUSDT 止损设在前高以下，本应设在前高以上。
        <strong>改进规则：止损必须设在横盘区间上沿或确认 K 线最高价以上。</strong>
      </RuleCard>
    </Section>

    <Section title="五、系统规则补充">
      <RuleCard no="5.1" title="入场前检查「失效价」">
        每次根据收盘 K 线决定做空时，标注一个失效价（确认 K
        线最高价或横盘区间上沿）。如果次日开盘/当前价格已突破失效价，放弃这笔交易。
        <CodeBlock>{`信号日 K 线：看跌吞没，最高价 1.03，收盘 1.00
横盘区间上沿：1.04  →  失效价：1.04

次日价格 0.99 → 正常入场
次日价格 1.05 → 放弃`}</CodeBlock>
      </RuleCard>
      <RuleCard no="5.2" title="横盘阶段「盘面干净」检查">
        横盘阶段（第 2-5 天）任何一根 K 线的影线超过实体 3 倍 → 标记为"盘面不干净"，不入场。
      </RuleCard>
      <RuleCard no="5.3" title="时间窗口上限：7 天">
        暴涨后 7 天内没有出现确认信号 → 从观察列表移除。超过 7
        天的横盘性质已经改变，从"暴涨后衰竭"变为"平台蓄力"，属于另一套系统逻辑。
      </RuleCard>
      <RuleCard no="5.4" title="插针历史筛查">
        最近 30 天内出现 2 次以上极端插针（影线 {'>'} 实体 10 倍）→ 避开；仅在 BTC/ETH
        崩盘日出现的单次插针 → 可接受；关键看横盘阶段是否干净，不是看历史上曾经插过针。
      </RuleCard>
      <RuleCard no="5.5" title="睡前撤单规则">
        UTC+8 时区，日线 UTC+0 收盘 = 早 8:00。
        <CodeBlock>{`08:00  → 日线收盘，确认 K 线形态
08:00+ → 判断信号，决定是否下单
白天    → 挂单等成交
睡前    → 未成交的开仓委托单全部取消
次日 08:00 → 重新评估`}</CodeBlock>
      </RuleCard>
      <RuleCard no="5.6" title="暴涨后最早入场时间">
        至少观察到连续缩量横盘 3 天后，第 3 天才可考虑入场（需同时出现确认 K 线）。第 2
        天的任何形态都不构成入场理由。实体大小不作为判断依据——以暴涨日为基准，实体几乎天然收缩，区分度为零；实体大小本身也无法判定方向。
      </RuleCard>
    </Section>

    <Section title="六、阶段性结论">
      <Callout type="success">
        <strong>系统本身没有问题。</strong>合规交易的每笔期望值
        +0.74R，这个数据很好。问题不在系统的逻辑，而在执行时"凑合入场"稀释了整体收益。
      </Callout>
      <Callout type="warning">
        <strong>当前最大的敌人是"手痒"。</strong>43 个观测 → 4 笔真正合格 → 你做了 6 笔。多出来的 2
        笔（BOBUSDT、SKYAIUSDT）全是"差不多就行"心态的产物。
      </Callout>
      <Callout type="info">
        <strong>下一阶段目标：</strong>先做到连续 5
        笔全部合规。不管盈亏，只管每一笔是否严格符合系统。每笔都像 STGUSDT 那样等、那样进、那样出。
      </Callout>
      <div style={{ fontSize: 13, color: '#444', lineHeight: 2 }}>
        <strong>空窗期可以做的事：</strong>
        <ol style={{ marginTop: 6, paddingLeft: 20 }}>
          <li>
            <strong>回测：</strong>找 10-20 个历史暴涨币，逐天模拟入场，积累形态识别经验
          </li>
          <li>
            <strong>记录放弃理由：</strong>每个没做的币标注为什么放弃，事后验证放弃是否正确
          </li>
          <li>
            <strong>读《Trading in the Zone》：</strong>强化"系统执行 {'>'} 单笔结果"的心理框架
          </li>
        </ol>
      </div>
    </Section>
  </div>
);

export default Phase1;
