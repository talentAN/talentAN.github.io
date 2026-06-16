import React from 'react';
import { Table, Tag } from 'antd';
import {
  Section,
  TradeCard,
  Row,
  Callout,
  CodeBlock,
  RuleCard,
  MetricGrid,
} from '../../tabs/system_1/retrospective/_components';

const tradeData = [
  {
    key: 1,
    no: 1,
    symbol: 'MAGICUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.297',
    exit: '0.266',
    pnl: '+0.84R',
    r: '+0.84R',
    compliant: 'partial',
  },
  {
    key: 2,
    no: 2,
    symbol: 'CFXUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.22',
    exit: '0.264',
    pnl: '-1.20R',
    r: '-1.20R',
    compliant: 'no',
  },
  {
    key: 3,
    no: 3,
    symbol: 'ATHUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.006186',
    exit: '0.002394',
    pnl: '+3.07R',
    r: '+3.07R',
    compliant: 'partial',
  },
  {
    key: 4,
    no: 4,
    symbol: 'LISTAUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.44',
    exit: '0.528',
    pnl: '-1.20R',
    r: '-1.20R',
    compliant: 'no',
  },
  {
    key: 5,
    no: 5,
    symbol: 'ORDERUSDT（第1次）',
    dir: '空',
    lev: '5x',
    entry: '0.1267',
    exit: '0.1267',
    pnl: '0R',
    r: '0R',
    compliant: 'no',
  },
  {
    key: 6,
    no: 6,
    symbol: 'ORDERUSDT（第2次）',
    dir: '空',
    lev: '5x',
    entry: '0.4338',
    exit: '0.162645',
    pnl: '+3.13R',
    r: '+3.13R',
    compliant: 'ok',
  },
  {
    key: 7,
    no: 7,
    symbol: 'MERLUSDT（第1次）',
    dir: '空',
    lev: '5x',
    entry: '0.3625',
    exit: '0.3625',
    pnl: '0R',
    r: '0R',
    compliant: 'ok',
  },
  {
    key: 8,
    no: 8,
    symbol: 'MERLUSDT（第2次）',
    dir: '空',
    lev: '5x',
    entry: '0.38122',
    exit: '0.357',
    pnl: '+0.32R',
    r: '+0.32R',
    compliant: 'partial',
  },
  {
    key: 9,
    no: 9,
    symbol: 'EPICUSDT',
    dir: '空',
    lev: '5x',
    entry: '2.9487',
    exit: '1.785',
    pnl: '+1.97R',
    r: '+1.97R',
    compliant: 'ok',
  },
  {
    key: 10,
    no: 10,
    symbol: 'ZORAUSDT',
    dir: '空',
    lev: '5x',
    entry: '0.09213',
    exit: '0.132',
    pnl: '-2.16R',
    r: '-2.16R',
    compliant: 'no',
  },
];

const tradeColumns = [
  { title: '#', dataIndex: 'no', width: 36 },
  { title: '币对', dataIndex: 'symbol', width: 170 },
  { title: '方向', dataIndex: 'dir', width: 46 },
  { title: '杠杆', dataIndex: 'lev', width: 54 },
  { title: '入场价', dataIndex: 'entry', width: 88 },
  { title: '出场价', dataIndex: 'exit', width: 88 },
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
          { label: '总交易笔数', value: '10' },
          { label: '胜率（>0R）', value: '50%', color: '#faad14' },
          { label: '净收益', value: '+4.77R', color: '#52c41a' },
          { label: '每笔期望值', value: '+0.48R' },
          { label: '最大单笔盈利', value: '+3.13R', color: '#52c41a' },
          { label: '最大单笔亏损', value: '-2.16R', color: '#f5222d' },
          { label: '合规交易', value: '3 笔' },
          { label: '合规交易净收益', value: '+5.10R', color: '#52c41a' },
        ]}
      />
      <Callout type="info">
        <strong>关键发现：</strong>3 笔合规交易（#6、#7、#9）净收益 +5.10R，每笔期望值 +1.70R。4
        笔违规交易（#2、#4、#5、#10）净收益 -4.56R。
        <br />
        <strong>利润集中在严格执行系统的交易中，违规交易整体是负收益。</strong>
      </Callout>
    </Section>

    <Section title="三、逐笔诊断">
      <TradeCard color="orange" title="#1 MAGICUSDT — 基本合规，入场触发方式值得标注（+0.84R）">
        <Row label="入场">暴涨 ✓ → 缩量 ✓ → 触发相同高点（阻力位测试入场）</Row>
        <Row label="问题">
          入场理由没有提到确认 K
          线，触发条件是"价格到了前高"而非"出现了看跌形态"，属于阻力位测试入场
        </Row>
        <Row label="出场">被插针止盈，+0.84R</Row>
        <Callout type="warning">
          入场方式是"阻力位测试"而非系统原始的"确认 K 线"。结果没问题，但入场触发方式需要标注。
        </Callout>
      </TradeCard>

      <TradeCard color="red" title="#2 CFXUSDT — 缩量信息缺失 + 止损未执行（-1.20R）">
        <Row label="入场">暴涨后略回调 → 横盘 6 天 → 相对高点入场</Row>
        <Row label="问题1">入场理由没有提到"缩量"。6 天横盘但量是否充分缩小？缺少量的维度确认</Row>
        <Row label="问题2">
          止损 0.26，实际出场 0.264 — 价格触及止损后没有执行，试图靠爆仓价硬扛
        </Row>
        <Callout type="danger">
          <strong>止损纪律被打破。</strong>"差一点"不是理由 — 这是在用一次结果合理化违规行为。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="#3 ATHUSDT — 入场标杆，风控执行存疑（+3.07R）">
        <Row label="入场">高位 ✓ + 缩量 ✓ + 2 十字 ✓ + 2 小阴线 ✓ — 四个维度全部满足</Row>
        <Row label="出场">移动止盈出场</Row>
        <Row label="风控隐患">
          盈利未超 2R 时止损设在爆仓价。系统规则是 1R 盈利后移止损到成本价，实际做法是"不到 2R
          就设爆仓价"
        </Row>
        <Callout type="warning">
          如果价格在 1.5R 盈利时反转：按系统规则 → 0R 出场保住本金；按实际做法 → 可能亏损超过 -1R。
          <br />
          <strong>这笔入场是标杆，但持仓期间的风控有缺口。</strong>
        </Callout>
      </TradeCard>

      <TradeCard color="red" title="#4 LISTAUSDT — 注意力正在回流，违反核心假设（-1.20R）">
        <Row label="入场">放量暴涨回调后，再次涨回高位</Row>
        <Row label="核心问题">
          量虽然比暴涨日小，但相比前期依然是放量 —
          多头不是在撤退，而是在重新集结。注意力正在回流，消退假设此刻是错的
        </Row>
        <Row label="危险想法">"最高价才差 10%，考虑扛单么？" — 用一次偶然结果修改风控逻辑</Row>
        <Callout type="success">
          <strong>最有价值的一句话：</strong>
          "最危险的就是看着像是机会，但实际要自己妥协的形状，宁可错过也不错"
        </Callout>
      </TradeCard>

      <TradeCard
        color="red"
        title="#5 ORDERUSDT 第1次 — 注意力回流 + 预谋扛单 + 参考基准错误（0R）"
      >
        <Row label="入场">"量不够第一次的一半，比昨天略大，可以多加点保证金扛一下"</Row>
        <Row label="问题1">"比昨天略大" = 量在回升 = 注意力在回流 = 不符合系统假设</Row>
        <Row label="问题2">"可以多加点保证金扛一下"出现在入场理由中 — 开仓前就计划违反止损纪律</Row>
        <Row label="问题3">拿暴涨日的量做基准，几乎任何后续的量都"看起来在缩"。应该对比近几天</Row>
        <Callout type="danger">
          如果你需要计划"扛一下"才敢入场，说明共振信号不够强。正确的做法是不做，不是加保证金。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="#6 ORDERUSDT 第2次 — 标杆交易（+3.13R）">
        <Row label="入场">
          "没放量" ✓ + 第三次冲击高点推不上去 + 取第二高点作为保守入场位 + 两个阳线小实体 ✓
        </Row>
        <Row label="亮点1">多头连续三轮进攻失败，力竭信号明确</Row>
        <Row label="亮点2">保守入场位给了更好的盈亏比和安全边际</Row>
        <Row label="亮点3">
          "大阳线第二次冲上来的时候，差点又要入场，还好 tm 忍住了" — 从 #4、#5 的教训转化为实际行动
        </Row>
        <Callout type="success">
          <strong>标杆交易。</strong>缩量确认、多次阻力测试、保守入场、抵住了诱惑。
        </Callout>
      </TradeCard>

      <TradeCard color="green" title="#7 MERLUSDT 第1次 — 合规，正常运作（0R）">
        <Row label="入场">高位 ✓ + 量持续变小 ✓ + 两根极小实体 ✓ — 入场逻辑干净</Row>
        <Row label="出场">盈利达 1R 后移止损到成本价，价格回来 0R 出场</Row>
        <Callout type="info">0R 不是亏损，是系统在保护你。规则正确执行。</Callout>
      </TradeCard>

      <TradeCard color="orange" title="#8 MERLUSDT 第2次 — 假设过期 + 可能受沉没成本影响（+0.32R）">
        <Row label="入场">缩量高位横盘，相对高点入场</Row>
        <Row label="问题">暴涨后接近一个月的横盘，系统假设（注意力消退后的惯性回归）已过期</Row>
        <Row label="心理">
          距 #7 入场隔了 12 天，持续跟踪同一币 →
          容易产生沉没成本心理："已经关注这么久了，不做一笔太亏了"
        </Row>
        <Callout type="warning">
          下次遇到这种情况，问自己：如果我今天第一次看到这个币，系统会让我做吗？
        </Callout>
      </TradeCard>
      <TradeCard color="green" title="#9 EPICUSDT — 合规，干净（+1.97R）">
        <Row label="入场">二次触碰高点 ✓（阻力测试）+ 两个小实体 ✓ + 缩量 ✓</Row>
        <Row label="出场">收益达 2R 后移动止盈，纪律执行到位</Row>
        <Callout type="success">干净的系统交易。入场、持仓、出场全部合规。</Callout>
      </TradeCard>

      <TradeCard color="red" title="#10 ZORAUSDT — 流动性真空 + 止损未执行 + 重复犯错（-2.16R）">
        <Row label="入场">"缩量 2 次触达高点" — 信息不足：缩到什么程度？有没有小实体？</Row>
        <Row label="问题1">
          止损 0.11，实际出场 0.132 — 价格穿透止损后没有出场，一直到爆仓。亏损是计划的 2.16 倍
        </Row>
        <Row label="问题2">
          单日 11% 大阳线 — 缩量不等于安静，盘口薄时一点买单就能推巨大涨幅（流动性真空）
        </Row>
        <Callout type="danger">
          系统需要"注意力消退 + 市场安静"。这个币注意力消退了（量缩），但市场不安静（单日 11%）。
          <br />
          <strong>量缩 + 盘口薄 = 流动性真空，一根大线就能穿透止损。</strong>
        </Callout>
      </TradeCard>
    </Section>

    <Section title="四、全局模式提取">
      <RuleCard no="模式1" title="你在发展一种「阻力位测试」入场法">
        10 笔交易里有 7 笔的入场逻辑是"价格回到前高/阻力位"。好成绩（#6 +3.13R、#9
        +1.97R）和差成绩（#4 -1.20R、#10 -2.16R）用的都是这种方法。
        <Callout type="info">
          区别在于：<strong>好的那几笔，量是真的在缩；差的那几笔，量在回升。</strong>
          <br />
          "阻力位测试"作为入场触发可以，但必须叠加缩量确认，单独的阻力位测试不够。
        </Callout>
      </RuleCard>

      <RuleCard no="模式2" title="量的对比基准有问题">
        #5 暴露了认知陷阱："量不够第一次的一半"听起来像缩量，但"比昨天略大"说明量在回升。
        <CodeBlock>{`❌ 今天的量 vs 暴涨日的量（几乎永远"缩了"）
✓ 今天的量 vs 昨天/前天的量（检测趋势方向：还在缩还是开始回升）`}</CodeBlock>
      </RuleCard>

      <RuleCard no="模式3" title="入场理由中的语言是红灯信号">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'left',
                  }}
                >
                  好交易
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'left',
                  }}
                >
                  差交易
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #6："没放量"（客观事实）
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #4："再次涨回高位"（描述价格，没提量）
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #9："连续两个小实体，缩量"（客观事实）
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #5："可以多加点保证金扛一下"（计划违规）
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #3："高位缩量 2 十字 + 2 小阴线"（精确）
                </td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>
                  #10："缩量 2 次触达高点"（模糊，缺细节）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout type="warning">
          <strong>写入场理由时，强制回答："今天的量比昨天是大还是小？"</strong>
          如果写不出"量比昨天更小"，就不入场。
        </Callout>
      </RuleCard>

      <RuleCard no="模式4" title="止损违规的代价">
        如果所有交易严格执行 1R 止损：
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'left',
                  }}
                >
                  笔
                </th>
                <th
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'right',
                  }}
                >
                  实际 R
                </th>
                <th
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'right',
                  }}
                >
                  修正 R
                </th>
                <th
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #e8e8e8',
                    textAlign: 'right',
                  }}
                >
                  差值
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>#2 CFX</td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -1.20
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -1.00
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#52c41a',
                  }}
                >
                  +0.20
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>#5 ORDER</td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                  }}
                >
                  0.00
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -1.00
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -1.00
                </td>
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0' }}>#10 ZORA</td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -2.16
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#f5222d',
                  }}
                >
                  -1.00
                </td>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    textAlign: 'right',
                    color: '#52c41a',
                  }}
                >
                  +1.16
                </td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td style={{ padding: '6px 12px' }}>合计</td>
                <td style={{ padding: '6px 12px', textAlign: 'right', color: '#f5222d' }}>-3.36</td>
                <td style={{ padding: '6px 12px', textAlign: 'right', color: '#f5222d' }}>-3.00</td>
                <td style={{ padding: '6px 12px', textAlign: 'right', color: '#52c41a' }}>+0.36</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout type="warning">
          #5 严格止损反而总 R 降低（从 0 变成 -1）。但这是<strong>幸存者偏差</strong> —
          这次运气好扛回来了，下次不会。长期看，扛单是负期望行为。
        </Callout>
      </RuleCard>
    </Section>

    <Section title="五、修正后的系统入场条件">
      <RuleCard no="1" title="放量暴涨">
        {'≥'} 5 日均量 3 倍
      </RuleCard>
      <RuleCard no="2" title="持续缩量">
        量逐日递减 — 不是跟暴涨日比，而是逐日比较
      </RuleCard>
      <RuleCard no="3" title="入场触发">
        价格在缩量状态下回到前高/阻力位
      </RuleCard>
      <RuleCard no="4" title="量的最终确认">
        入场当天的量必须小于等于前一天（量不能回升）
      </RuleCard>
      <RuleCard no="5" title="盈亏比">
        {'≥'} 2R
      </RuleCard>
      <RuleCard no="6" title="窗口关闭条件">
        新放量 / 突破区间 / 超过 2 周
      </RuleCard>
      <Callout type="danger">
        <strong>绝对禁止：</strong>
        <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20 }}>
          <li>入场理由中出现"扛一下""加保证金""差一点"等妥协语言 → 直接放弃</li>
          <li>量比昨天大 → 不管形状多好看都不入场</li>
        </ul>
      </Callout>
    </Section>

    <Section title="六、阶段性结论">
      <Callout type="success">
        <strong>合规交易的每笔期望值 +1.70R。</strong>
        系统本身有效，问题在于执行时的妥协稀释了整体收益。
      </Callout>
      <Callout type="warning">
        <strong>三个重复犯错模式需要根治：</strong>
        <ol style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li>量在回升时仍然入场（#4、#5）</li>
          <li>止损不执行 / 靠爆仓价扛单（#2、#5、#10）</li>
          <li>入场理由模糊，省略量的信息（#2、#10）</li>
        </ol>
      </Callout>
      <Callout type="info">
        <strong>下一阶段要求：</strong>
        每笔入场理由必须包含"今天的量比昨天是大还是小"的明确回答。写不出"量比昨天更小"，就不入场。
      </Callout>
    </Section>
  </div>
);

export default Phase1;
