import React from 'react';
import { Table, Tag } from 'antd';
import { Section, TradeCard, Row, Callout, CodeBlock, RuleCard, MetricGrid } from './_components';

// ── 第二阶段 6 笔新交易（按开仓时间排序）──────────────────────────────
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
  { title: '币对', dataIndex: 'symbol', width: 130 },
  { title: '入场价', dataIndex: 'entry', width: 88 },
  { title: '出场价', dataIndex: 'exit', width: 88 },
  { title: '持仓时长', dataIndex: 'duration', width: 80 },
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
    width: 80,
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

// ── 阶段对比数据 ─────────────────────────────────────────────────────
const compareColumns = [
  { title: '指标', dataIndex: 'label', width: 160 },
  {
    title: '第一阶段（笔1-6）',
    dataIndex: 'p1',
    width: 180,
    render: (v, r) => <span style={{ color: r.p1Color || '#262626' }}>{v}</span>,
  },
  {
    title: '第二阶段（笔7-12）',
    dataIndex: 'p2',
    width: 180,
    render: (v, r) => <span style={{ color: r.p2Color || '#262626' }}>{v}</span>,
  },
];

const compareData = [
  {
    key: 1,
    label: '胜率',
    p1: '67%（4/6）',
    p2: '100%（6/6）',
    p1Color: '#888',
    p2Color: '#52c41a',
  },
  {
    key: 2,
    label: '净收益',
    p1: '+9.25 U',
    p2: '+105.1 U',
    p1Color: '#52c41a',
    p2Color: '#52c41a',
  },
  { key: 3, label: '总 R', p1: '+0.93R', p2: '+10.48R', p1Color: '#888', p2Color: '#52c41a' },
  {
    key: 4,
    label: '每笔期望值',
    p1: '+0.16R / 笔',
    p2: '+1.75R / 笔',
    p1Color: '#888',
    p2Color: '#52c41a',
  },
  {
    key: 5,
    label: '最大单笔盈利',
    p1: '+1.88R（STGUSDT）',
    p2: '+3.11R（GWEIUSDT）',
    p1Color: '#52c41a',
    p2Color: '#52c41a',
  },
  {
    key: 6,
    label: '最大单笔亏损',
    p1: '-1R（BOBUSDT×2）',
    p2: '无亏损',
    p1Color: '#f5222d',
    p2Color: '#52c41a',
  },
  { key: 7, label: '违规笔数', p1: '2笔', p2: '0笔', p1Color: '#f5222d', p2Color: '#52c41a' },
  {
    key: 8,
    label: '合规交易期望值',
    p1: '+0.73R / 笔',
    p2: '+1.75R / 笔（全合规）',
    p1Color: '#888',
    p2Color: '#52c41a',
  },
];

// ── 入场差距数据 ──────────────────────────────────────────────────────
const entryDiffData = [
  { key: 1, symbol: 'PROMUSDT', openDiff: '2.62%', note: '接近3日高点，入场精准' },
  { key: 2, symbol: 'IRYSUSDT', openDiff: '4.67%', note: '接近高点' },
  { key: 3, symbol: 'HUSDT', openDiff: '45.74%', note: '主动选择次高点，非失误' },
  { key: 4, symbol: 'INUSDT', openDiff: '0.61%', note: '极接近3日高点，入场质量最高' },
  { key: 5, symbol: 'GWEIUSDT', openDiff: '18.77%', note: '从高点回落确认后入场' },
  { key: 6, symbol: 'BEATUSDT', openDiff: '10.09%', note: '未在最高点，稍早入场' },
];

const entryDiffColumns = [
  { title: '币对', dataIndex: 'symbol', width: 120 },
  {
    title: '入场最优差',
    dataIndex: 'openDiff',
    width: 100,
    render: v => {
      const n = parseFloat(v);
      const color = n < 5 ? '#52c41a' : n < 20 ? '#faad14' : '#f5222d';
      return <span style={{ color, fontWeight: 600 }}>{v}</span>;
    },
  },
  { title: '说明', dataIndex: 'note' },
];

const Phase2 = () => (
  <div>
    <Section title="一、第二阶段交易总览（笔 7-12）">
      <Table
        columns={tradeColumns}
        dataSource={tradeData}
        pagination={false}
        size="small"
        scroll={{ x: 620 }}
      />
      <Callout type="success" style={{ marginTop: 12 }}>
        本阶段 6 笔全部盈利，无违规。净收益 +105.1 U（≈ +10.5R），是第一阶段的
        <strong> 11.3 倍</strong>。
      </Callout>
    </Section>

    <Section title="二、与第一阶段对比">
      <Table
        columns={compareColumns}
        dataSource={compareData}
        pagination={false}
        size="small"
        scroll={{ x: 520 }}
      />
      <Callout type="info">
        <strong>核心变化：</strong>每笔期望值从 +0.15R 跃升至 +1.59R，提升 10 倍。
        驱动因素不是运气——即便去掉 GWEIUSDT 和 BEATUSDT 两笔大单，剩余 4 笔均值依然达到 +0.83R，
        高于第一阶段合规交易水平（+0.73R），说明执行纪律的提升是真实的。
      </Callout>
      <Callout type="warning">
        <strong>需要注意的变量：</strong>第二阶段市场环境未必与第一阶段一致；6 笔样本量仍然较小；
        100% 胜率在统计上是小样本红利，不作为系统有效性的主要依据。
      </Callout>
    </Section>

    <Section title="三、逐笔诊断">
      <TradeCard color="green" title="✅ GWEIUSDT — 标杆操作（+2.83R）">
        <Row label="入场">缩量第 3 天高位开仓，入场时机严格符合系统</Row>
        <Row label="出场">移动止盈自然出场，持仓 11 天</Row>
        <Row label="亮点">全程无干预，最高盈利达 4.6R，实际出场 3.11R，是第二阶段的 STGUSDT</Row>
        <Row label="新发现">
          "盈利达到 4R 后可以考虑直接止盈"——这是从这笔交易里提炼的新假设，待后续验证
        </Row>
        <Callout type="success">
          这笔交易证明第一阶段建立的系统规则在新的市场环境下同样有效。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="✅ BEATUSDT — 变体信号，出场偏早（+2.78R）">
        <Row label="入场">
          量递增+价递增 → 量递减+价仍涨 → 量缩至高点一半时出长上影线 → 次日委托高点入场
        </Row>
        <Row label="模式">不是标准的"暴涨后缩量横盘"，而是"涨势末端量价背离"，属于变体信号</Row>
        <Row label="出场">被一根长上影线触发移动止盈，此后价格继续跌至 1.7（潜在 7.2R）</Row>
        <Row label="遗漏">出场后 3 日最低价为 2.50，实际出场 7.46，出场差距 47%，是本阶段最高</Row>
        <Callout type="warning">
          出场机制本身没有问题（移动止盈是规则）。但这笔交易表明：某些情况下，
          主动在特定盈利目标（如
          4R）直接止盈，可能比等待移动止盈触发更优。这是下一阶段要验证的假设。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="✅ INUSDT — 教科书式操作（+0.90R）">
        <Row label="入场">缩量第 4 天高位入场，入场最优差仅 0.61%，是本阶段入场质量最高的一笔</Row>
        <Row label="出场">移动止盈出局，正常交易</Row>
        <Row label="小结">没有亮点，也不需要亮点。按系统做，按系统出</Row>
      </TradeCard>

      <TradeCard color="green" title="✅ IRYSUSDT — 防御性平仓的正确应用（≈ 0R）">
        <Row label="入场">暴涨后高位横盘一周，挂单成交，入场逻辑成立</Row>
        <Row label="变化">
          成交后复盘图形，判断更像低位突破，同日 BTC 相对强势——两个信号叠加，触发防御性平仓
        </Row>
        <Row label="结果">当天跌了 11%，但后续 3 天累计涨超 27%，判断方向反了，但出场决策正确</Row>
        <Callout type="success">
          这笔的价值不在于盈利，而在于执行了一个高难度决策：
          <strong>承认入场可能有误，主动退出，不扛单。</strong>
          这与系统方向完全一致——在信号失效时快速止损，保留资金用于更好的机会。
        </Callout>
      </TradeCard>

      <TradeCard color="orange" title="⚠️ HUSDT — 主动选择次高点，入场差距大（+1.36R）">
        <Row label="入场">主动选择次高点挂委托单，而非最高点附近开仓</Row>
        <Row label="差距">入场最优差 45.74%——3 日高点 0.411，实际入场 0.282</Row>
        <Row label="结果">最高盈利 2.4R，实际出场 1.36R（1.4R 止盈）</Row>
        <Row label="问题">
          "选择次高点"的依据是什么？这是策略还是对高点的回避心理？
          如果是策略，需要有明确的逻辑；如果是心理原因，则是需要纠正的习惯
        </Row>
        <Callout type="warning">
          主动放弃最优入场点，但依然盈利，这笔数据不能作为"次高点入场有效"的证据——
          它只是恰好在入场之后也跌了。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="✅ PROMUSDT — 变体入场，持仓 21 天（+1.68R）">
        <Row label="入场">暴涨后缩量大阳线拉回接近高位，在"第三高点"附近开仓</Row>
        <Row label="持仓">21 天，中间经历 3-4 次较大回撤，价格始终未触及止损线，按规则持有</Row>
        <Row label="规则细节">
          盈利未超 1R 时止损维持开仓价；超 1R 但未到 2R 时，止损设为开仓价；超 2R 后设定 5% 移动止损
        </Row>
        <Row label="说明">
          这不是扛单——止损线始终存在且未被触发，持仓是系统正常运作的结果， 不是主动选择承受亏损
        </Row>
        <Callout type="info">
          持仓 21 天，方向判断正确，始终浮盈，未出现回撤压力。这是变体入场信号中执行较好的案例。
        </Callout>
      </TradeCard>
    </Section>

    <Section title="四、入场质量分析">
      <Table
        columns={entryDiffColumns}
        dataSource={entryDiffData}
        pagination={false}
        size="small"
      />
      <Callout type="info">
        剔除 HUSDT（主动选择次高点），其余 5 笔平均入场差距约 7.3%。 这意味着：你通常在离 3 日高点约
        7% 的位置入场，这是"等待确认"的成本，不是失误。
        <br />
        <strong>INUSDT（0.61%）和 PROMUSDT（2.62%）的精准入场值得关注</strong>
        ——看看这两笔的判断依据， 找出"接近高点入场"的共性条件。
      </Callout>
    </Section>

    <Section title="五、出场机制探索">
      <Callout type="warning">
        <strong>本阶段新出现的问题：移动止盈可能在最优位置之前过早触发。</strong>
        <br />
        BEATUSDT：实际出场 7.46，后续最低 2.50，遗漏涨幅 197%（出场差距 47%）。
        <br />
        GWEIUSDT：最高盈利 4.6R，实际出场 2.83R。
      </Callout>
      <RuleCard no="待验证" title="假设：盈利达 4R 后直接止盈">
        <div>
          来源：GWEIUSDT（4.6R 最高盈利，2.83R 出场）和 BEATUSDT（潜在 7R+，2.78R 出场）两笔的观察。
          <br />
          <br />
          <strong>假设内容：</strong>当浮盈达到 4R，主动平仓，不等待移动止盈触发。
          <br />
          <br />
          <strong>验证需要：</strong>
          <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>收集更多达到 4R 以上的交易，看直接止盈 vs. 继续持有的结果分布</li>
            <li>4R 这个阈值本身是否合理，还是应该是 3R 或 5R</li>
            <li>样本量至少需要 10 笔达到 4R 的交易才有统计意义</li>
          </ul>
          <br />
          <strong>当前结论：</strong>不改变现有规则，继续使用移动止盈。单独记录每笔到达 4R 的案例。
        </div>
      </RuleCard>
    </Section>

    <Section title="六、系统规则更新（第二阶段新增）">
      <RuleCard no="6.1" title="时间止损规则（正式确认）">
        从扛单数据中归纳：所有成功的扛单最长 50 天内回到盈利。
        <CodeBlock>{`持仓 > 50天，浮亏仍在扩大 → 开始减仓
持仓 > 60-70天，无论盈亏   → 强制平仓

依据：个人交易记录中，最长扛单成功案例约 50 天`}</CodeBlock>
      </RuleCard>
      <RuleCard no="6.2" title="入场标的范围（显式确认）">
        历史数据显示，所有交易均为市值 100
        名开外的小币。这个范围是有效的隐性过滤器，现在显式写入规则。
        <CodeBlock>{`入场条件补充：目标币市值排名 > 100
原因：市值 100 以内的币遭遇"B类情况"（真实基本面驱动涨幅）的概率显著更高`}</CodeBlock>
      </RuleCard>
      <RuleCard no="6.3" title="防御性平仓（正式确认）">
        IRYSUSDT 验证了该操作的价值。触发条件：
        <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>入场后复盘发现信号判断可能有误</li>
          <li>同日 BTC/ETH 出现反向强势信号</li>
          <li>浮亏快速扩大且无合理支撑</li>
        </ul>
        与止损不同，防御性平仓是主动判断，不需要触及止损线。
      </RuleCard>
    </Section>

    <Section title="七、阶段性结论">
      <Callout type="success">
        <strong>第一阶段目标"连续 5 笔全合规"已超额完成：第二阶段 6 笔零违规。</strong>
        <br />
        纪律问题基本解决。系统的核心假设（暴涨后缩量做空获利）在第二阶段得到了更强的数据支撑。
      </Callout>
      <Callout type="info">
        <strong>当前最大的未解问题：出场时机的优化。</strong>
        <br />
        进入阶段，移动止盈偶尔在最优点之前触发。这不是系统缺陷，而是一个可以用数据细化的方向。
        当前策略：积累样本，不急于修改规则。
      </Callout>
      <Callout type="warning">
        <strong>需要持续收集的数据：</strong>
        <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>每笔扛单期间的最大浮亏（验证扛单安全边际）</li>
          <li>每笔达到 4R+ 的案例（验证"4R直接止盈"假设）</li>
          <li>自由交易单独记录，与系统交易对比期望值</li>
        </ul>
      </Callout>
      <div style={{ fontSize: 13, color: '#444', lineHeight: 2 }}>
        <strong>第三阶段目标：</strong>
        <ol style={{ marginTop: 6, paddingLeft: 20 }}>
          <li>
            <strong>出场数据收集：</strong>每笔记录"最高盈利R"和"实际出场R"，积累 10
            笔以上后做出场机制复盘
          </li>
          <li>
            <strong>入场判断量化：</strong>记录每笔实际入场价 vs. 当日最优价，判断偏差是否有规律
          </li>
          <li>
            <strong>扛单数据完善：</strong>补录每笔持仓期间最大浮亏，为时间止损和仓位管理提供依据
          </li>
        </ol>
      </div>
    </Section>
  </div>
);

export default Phase2;
