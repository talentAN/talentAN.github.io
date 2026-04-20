import React from 'react';
import { Card, Typography, Table, Tag, Divider, Alert, Tabs } from 'antd';

const { Title, Paragraph, Text } = Typography;

const bayesLines = [
  { signal: '初始', prob: '50%', desc: '无信息' },
  { signal: '+ 独立信号 A 成立', prob: '55%', desc: '' },
  { signal: '+ 独立信号 B 成立', prob: '62%', desc: '' },
  { signal: '+ 独立信号 C 成立', prob: '70%', desc: '' },
  { signal: '+ 独立信号 D 成立', prob: '75%', desc: '' },
  { signal: '+ 独立信号 E 成立', prob: '78%', desc: '' },
];

const redundantLines = [
  { signal: '+ 信号 A 成立', prob: '55%', desc: '' },
  { signal: '+ 信号 B 成立（与 A 高度相关）', prob: '56%', desc: '几乎没增量' },
];

const signalCategory1 = [
  {
    id: 1,
    name: '成交量变化',
    measure: '参与的人还多不多',
    independence: '基础维度',
    source: 'K线图直接看',
  },
  {
    id: 2,
    name: 'K线实体变化',
    measure: '还有没有人在推价格',
    independence: '与成交量中等相关（量缩时实体通常也缩，但存在例外）',
    source: 'K线图直接看',
  },
  {
    id: 3,
    name: '时间窗口',
    measure: '衰退持续了多久',
    independence: '与量价独立——时间是独立变量',
    source: '数日期',
  },
  {
    id: 4,
    name: '确认K线（看跌吞没/流星线等）',
    measure: '空方是否已开始主动出手',
    independence: '与前三者独立——缩量横盘可以一直没有确认信号',
    source: 'K线图直接看',
  },
];

const signalCategory2 = [
  {
    id: 5,
    name: '资金费率',
    measure: '多头拥挤到什么程度',
    independence: '与量价完全独立——价格可以横盘但费率极高',
    source: '交易所合约页面',
  },
  {
    id: 6,
    name: '合约持仓量（OI）变化',
    measure: '多头是还扛着，还是已经跑了',
    independence: '与资金费率相关但不冗余——费率高+OI不降=多头还在死扛',
    source: '交易所合约页面',
  },
];

const signalCategory3 = [
  {
    id: 7,
    name: '盘口深度',
    measure: '买盘挂单厚不厚',
    independence: '与量价独立——量可以缩但做市商挂单还在',
    source: '盘口实时观察',
  },
];

const signalCategory4 = [
  {
    id: 8,
    name: '交易所净流入/流出',
    measure: '持有者是准备卖（转入交易所）还是囤（转出）',
    independence: '与量价完全独立——价格不动时链上可以大量搬家',
    source: 'Glassnode / CryptoQuant',
  },
];

const signalCategory5 = [
  {
    id: 9,
    name: '催化剂性质',
    measure: '暴涨的原因是什么',
    independence: '与量价完全独立——同样的放量，纯投机和消息面驱动衰退速度不同',
    source: '看新闻/社群',
  },
  {
    id: 10,
    name: '同板块联动',
    measure: '只有这一个币涨，还是整个板块在涨',
    independence: '与个币量价独立——个币缩量但板块可能还在轮动',
    source: '扫一眼同板块其他币',
  },
  {
    id: 11,
    name: '价格历史位置',
    measure: '暴涨后的价格在历史中是高位、中位还是低位',
    independence: '与量价、时间完全独立——纯空间维度',
    source: '拉长K线看一眼',
  },
];

const signalCategory6 = [
  {
    id: 12,
    name: '周内/时段效应',
    measure: '市场在这个时间段是活跃还是沉寂',
    independence: '与所有其他维度正交——纯时间变量',
    source: '经验积累',
  },
];

const envFilterData = [
  {
    key: '1',
    condition: 'BTC/ETH 趋势',
    effect: '大盘强势上涨时山寨币被连带拉升，做空信号可靠性下降',
    rule: 'MA50 方向判断强势/中性/弱势，强势时不做空',
  },
  {
    key: '2',
    condition: '极端行情（黑天鹅）',
    effect: '市场恐慌时所有技术信号失效',
    rule: '人工判断，暂无量化规则',
  },
];

const correlationData = [
  {
    key: '1',
    pair: '成交量 ↔ K线实体',
    level: '中等相关',
    note: '量缩时实体通常缩，但可分离（薄市场缩量大波动，或高频对敲量大实体小）',
  },
  {
    key: '2',
    pair: '资金费率 ↔ 合约持仓量',
    level: '中等相关',
    note: '通常同向变动，但可分离（费率降了但 OI 没降 = 多头换手但没跑）',
  },
  {
    key: '3',
    pair: '催化剂性质 ↔ 同板块联动',
    level: '低相关',
    note: '板块轮动时可能没有个币催化剂，个币消息面催化时板块可能不动',
  },
  {
    key: '4',
    pair: '其余信号对',
    level: '低/无相关',
    note: '基本独立',
  },
];

const signalColumns = [
  { title: '#', dataIndex: 'id', key: 'id', width: 50 },
  { title: '信号', dataIndex: 'name', key: 'name', width: 180 },
  { title: '测量什么', dataIndex: 'measure', key: 'measure', width: 240 },
  { title: '独立性说明', dataIndex: 'independence', key: 'independence' },
  { title: '获取方式', dataIndex: 'source', key: 'source', width: 160 },
];

const sectionStyle = { marginBottom: 32 };
const cardStyle = { marginBottom: 16 };
const hypothesisStyle = {
  background: '#f6ffed',
  border: '1px solid #b7eb8f',
  borderRadius: 6,
  padding: '8px 16px',
  marginTop: 8,
  marginBottom: 8,
  fontSize: 13,
};
const noteStyle = {
  background: '#fff7e6',
  border: '1px solid #ffd591',
  borderRadius: 6,
  padding: '8px 16px',
  marginTop: 8,
  fontSize: 13,
  color: '#ad6800',
};
const PlaceholderTab = ({ name }) => (
  <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 0' }}>
    <Typography>
      <div style={{ textAlign: 'center', color: '#bfbfbf' }}>
        <Title level={3} type="secondary">
          {name}
        </Title>
        <Paragraph type="secondary">系统描述待补充……</Paragraph>
      </div>
    </Typography>
  </div>
);

const loopholeTagColor = { high: 'red', medium: 'orange', low: 'blue' };

const System1Content = () => (
  <div style={{ maxWidth: 960, margin: '0 auto' }}>
    <Typography>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          放量冲关缩量滞涨
        </Title>
        <Text type="secondary">系统核心逻辑与待验证漏洞</Text>
      </div>

      {/* 系统公式 */}
      <Card
        style={{
          background: 'linear-gradient(135deg, #f0f5ff 0%, #f6ffed 100%)',
          border: '1px solid #d9d9d9',
          marginBottom: 24,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <Text strong style={{ fontSize: 17 }}>
            系统 = 共振（独立信号叠加） × 环境过滤 × 风控
          </Text>
          <Divider style={{ margin: '12px 0' }} />
          <Text style={{ fontSize: 14 }}>底层假设：注意力涌入 → 注意力消退 → 价格回归</Text>
        </div>
      </Card>

      {/* 待验证漏洞 */}
      <Title level={3}>待验证漏洞</Title>
      <Paragraph type="secondary">以下漏洞不一定致命，但值得在 30 笔交易数据里追踪验证。</Paragraph>

      {/* 漏洞一 */}
      <Card
        style={{ marginBottom: 16, borderLeft: '4px solid #ff4d4f' }}
        title={
          <span>
            <Tag color={loopholeTagColor.medium}>待验证</Tag>
            漏洞一：暴涨幅度没有被区分
          </span>
        }
        size="small"
      >
        <Paragraph>
          规则 2 只要求 <Text code>量 ≥ 3x</Text>
          ，但没有区分涨幅。一个涨 10% 的放量和一个涨 80% 的放量，注意力强度完全不同：
        </Paragraph>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 240,
              background: '#fff7e6',
              border: '1px solid #ffd591',
            }}
          >
            <Text strong style={{ color: '#fa8c16' }}>
              涨 10%
            </Text>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              可能只是小范围关注，注意力消退快但下跌空间也小
            </div>
          </Card>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 240,
              background: '#fff1f0',
              border: '1px solid #ffa39e',
            }}
          >
            <Text strong style={{ color: '#f5222d' }}>
              涨 80%
            </Text>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              吸引大量关注，可能形成更持久的叙事（"这个币会到xxx"），注意力消退未必那么快
            </div>
          </Card>
        </div>

        <Alert
          type="info"
          showIcon
          message={
            <span>
              <Text strong>第一性原理分析：</Text>
              暴涨的幅度影响注意力的持续时间，而系统对所有幅度一视同仁。
            </span>
          }
          description={
            <span>
              <Text strong>当前影响评估：</Text>可能不大，因为 <Text code>盈亏比 ≥ 2R</Text>{' '}
              间接过滤了涨幅太小的（跌不下去就没有 2R 空间）。但值得在 30
              笔数据里留意——大涨和小涨的胜率是否有差异。
            </span>
          }
          style={{ marginTop: 8 }}
        />

        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: '#f6ffed',
            borderRadius: 6,
            border: '1px solid #b7eb8f',
            fontSize: 13,
          }}
        >
          <Text strong>验证方法：</Text>30 笔数据收集后，按暴涨幅度分桶（&lt;20% / 20-50% /
          &gt;50%），对比各桶胜率。
        </div>
      </Card>

      {/* 漏洞二 */}
      <Card
        style={{ marginBottom: 16, borderLeft: '4px solid #faad14' }}
        title={
          <span>
            <Tag color={loopholeTagColor.medium}>待验证</Tag>
            漏洞二：横盘位置没有被区分
          </span>
        }
        size="small"
      >
        <Paragraph>一个币涨了 50% 后，存在两种截然不同的横盘场景：</Paragraph>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 280,
              borderTop: '3px solid #ff4d4f',
            }}
          >
            <Text strong style={{ color: '#ff4d4f' }}>
              场景 A：顶部横盘
            </Text>
            <div style={{ fontSize: 13, marginTop: 4 }}>涨了 50%，目前还在 +48% 附近</div>
            <Divider style={{ margin: '8px 0' }} />
            <ul style={{ fontSize: 13, paddingLeft: 20, marginBottom: 0 }}>
              <li>买方还能在高位撑住，可能有真实需求</li>
              <li>做空后如果跌，空间大</li>
              <li>
                <Text type="danger">但如果不跌，可能是强势整理后继续涨</Text>
              </li>
            </ul>
          </Card>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 280,
              borderTop: '3px solid #52c41a',
            }}
          >
            <Text strong style={{ color: '#52c41a' }}>
              场景 B：回落后横盘
            </Text>
            <div style={{ fontSize: 13, marginTop: 4 }}>先回落到 +25%，然后在这里横盘</div>
            <Divider style={{ margin: '8px 0' }} />
            <ul style={{ fontSize: 13, paddingLeft: 20, marginBottom: 0 }}>
              <li>买方力量更弱，更符合"注意力消退"假设</li>
              <li>
                <Text type="warning">但利润空间也缩小了</Text>
              </li>
            </ul>
          </Card>
        </div>

        <Alert
          type="info"
          showIcon
          message={
            <span>
              <Text strong>第一性原理分析：</Text>场景 B
              更符合系统假设（注意力确实在消退，价格已经开始回归），而场景 A
              有可能是"强势整理"而非"衰竭"。
            </span>
          }
          description={
            <span>
              <Text strong>当前间接覆盖：</Text>
              规则 7（干净横盘）和规则
              4（确认K线）可能间接覆盖了一部分——强势整理通常不会出确认K线。但这是一个值得追踪的变量。
            </span>
          }
          style={{ marginTop: 8 }}
        />

        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: '#f6ffed',
            borderRadius: 6,
            border: '1px solid #b7eb8f',
            fontSize: 13,
          }}
        >
          <Text strong>验证方法：</Text>记录每笔交易的"横盘位置相对涨幅百分比"，对比顶部横盘 vs
          回落后横盘的胜率差异。
        </div>
      </Card>

      {/* 漏洞三 */}
      <Card
        style={{ marginBottom: 16, borderLeft: '4px solid #1890ff' }}
        title={
          <span>
            <Tag color={loopholeTagColor.low}>低优先级</Tag>
            漏洞三：7 天窗口是经验值，缺乏底层推导
          </span>
        }
        size="small"
      >
        <Paragraph>为什么是 7 天而不是 5 天或 10 天？从注意力消退的角度：</Paragraph>

        <Table
          columns={[
            { title: '时间窗口', dataIndex: 'window', key: 'window', width: 120 },
            { title: '注意力状态', dataIndex: 'state', key: 'state' },
            { title: '判断', dataIndex: 'judge', key: 'judge', width: 160 },
          ]}
          dataSource={[
            {
              key: '1',
              window: '< 3 天',
              state: '注意力可能还没充分消退',
              judge: '太短，信号不可靠',
            },
            {
              key: '2',
              window: '3 - 7 天',
              state: '注意力逐步消退，买盘开始枯竭',
              judge: '合理窗口',
            },
            {
              key: '3',
              window: '> 10 天',
              state: '暴涨的记忆已经淡化，市场进入新状态',
              judge: '模型可能不再适用',
            },
          ]}
          pagination={false}
          size="small"
          style={{ marginBottom: 16 }}
        />

        <Alert
          type="info"
          showIcon
          message={<span>7 天是一个合理的经验值，但 30 笔数据出来后值得精确化。</span>}
          style={{ marginTop: 8 }}
        />

        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: '#f6ffed',
            borderRadius: 6,
            border: '1px solid #b7eb8f',
            fontSize: 13,
          }}
        >
          <Text strong>验证方法：</Text>统计第 3-4 天入场 vs 第 6-7
          天入场的胜率是否有显著差异，如果有则精确化窗口。
        </div>
      </Card>
    </Typography>
  </div>
);

const PrincipleContent = () => (
  <div style={{ maxWidth: 960, margin: '0 auto' }}>
    <Typography>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          交易系统第一性原理
        </Title>
        <Text type="secondary">创建：2026-04-13 · 更新：2026-04-13</Text>
      </div>

      {/* 一、系统的本质目的 */}
      <div style={sectionStyle}>
        <Title level={3}>一、系统的本质目的</Title>
        <Paragraph>
          交易系统不是预测工具，是<Text strong>概率压缩器</Text>。
        </Paragraph>
        <Paragraph>
          市场在没有任何信息时，涨跌概率接近 50/50。系统的目的是通过叠加多个
          <Text strong>独立证据</Text>
          ，把概率从 50% 推向 70%、75%、78%……永远到不了 100%，但不需要到
          100%——只要概率足够偏、风控兜底，长期就是正期望。
        </Paragraph>
      </div>

      {/* 二、概率靠什么提升 */}
      <div style={sectionStyle}>
        <Title level={3}>二、概率靠什么提升</Title>
        <Paragraph>两条路径，缺一不可：</Paragraph>

        <Card title="路径一：共振（多个独立信号指向同一方向）" size="small" style={cardStyle}>
          <Paragraph>
            核心逻辑：每叠加一个<Text strong>独立</Text>
            的证据，概率就往目标方向推一级。
          </Paragraph>
          <Paragraph>
            关键词是<Text strong>独立</Text>
            。如果两个信号本质上测量的是同一件事（高度相关），第二个信号的增量价值接近于零。
            只有测量不同维度的信号，叠加后才能有效压缩不确定性。
          </Paragraph>

          <Text strong>贝叶斯直觉：</Text>
          <div
            style={{
              background: '#f0f5ff',
              borderRadius: 6,
              padding: '12px 16px',
              margin: '8px 0',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            {bayesLines.map((l, i) => (
              <div key={i}>
                {l.signal} → <Text strong>{l.prob}</Text>
                {l.desc && <Text type="secondary"> ({l.desc})</Text>}
              </div>
            ))}
          </div>

          <Text type="secondary">如果 B 和 A 高度相关（测量同一件事）：</Text>
          <div
            style={{
              background: '#fff1f0',
              borderRadius: 6,
              padding: '12px 16px',
              margin: '8px 0',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            {redundantLines.map((l, i) => (
              <div key={i}>
                {l.signal} → <Text strong>{l.prob}</Text>
                {l.desc && (
                  <Text type="danger" style={{ marginLeft: 8 }}>
                    ({l.desc})
                  </Text>
                )}
              </div>
            ))}
          </div>

          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message={
              <span>
                判断两个信号是否独立的方法：问自己"A 成立时，B
                一定成立吗？"如果答案是"不一定"，它们就有独立性。如果答案是"几乎一定"，它们就是冗余的。
              </span>
            }
          />
        </Card>

        <Card title="路径二：环境过滤（排除概率被压制的场景）" size="small" style={cardStyle}>
          <Paragraph>共振负责"提升命中率"，环境过滤负责"排除不该出手的场景"。</Paragraph>
          <Paragraph>再强的共振信号，在错误的环境下也会失效：</Paragraph>
          <ul>
            <li>所有做空信号都亮了，但 BTC 当天暴涨 10% → 山寨币被连带拉升，信号失效</li>
            <li>所有做多信号都亮了，但 BTC 正在崩盘 → 泥沙俱下，信号失效</li>
          </ul>
          <Paragraph>
            环境过滤不直接提升概率，而是
            <Text strong>砍掉概率被严重扭曲的场景</Text>
            ，让共振信号在剩余场景中的有效性更高。
          </Paragraph>
        </Card>
      </div>

      {/* 三、独立信号维度全景 */}
      <div style={sectionStyle}>
        <Title level={3}>三、独立信号维度全景</Title>
        <Paragraph>每个维度测量市场的一个不同侧面。按照"测量什么"分类：</Paragraph>

        <Card
          title={
            <span>
              第一类：行为衰竭信号 <Tag color="blue">检测"上涨动力是否耗尽"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory1}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={hypothesisStyle}>
            <Text strong>检验假设：</Text>
            暴涨后的 FOMO 注意力已经耗尽，买盘枯竭。
          </div>
        </Card>

        <Card
          title={
            <span>
              第二类：仓位结构信号 <Tag color="purple">检测"有没有被挤压的多头仓位"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory2}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={hypothesisStyle}>
            <Text strong>检验假设：</Text>
            做多仓位拥挤，存在踩踏式平仓的燃料。
          </div>
        </Card>

        <Card
          title={
            <span>
              第三类：市场微观结构信号 <Tag color="orange">检测"一旦跌了，跌起来容易不容易"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory3}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={hypothesisStyle}>
            <Text strong>检验假设：</Text>
            一旦下跌触发，市场有没有足够的"地板"来接住。盘口越薄，穿透越快。
          </div>
          <div style={noteStyle}>
            盘口是实时数据，变化快，适合作为辅助参考，不适合作为硬性入场条件。
          </div>
        </Card>

        <Card
          title={
            <span>
              第四类：链上资金流信号 <Tag color="cyan">检测"持有者在做什么"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory4}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={hypothesisStyle}>
            <Text strong>检验假设：</Text>
            聪明钱或大户是否在暗中出货。
          </div>
          <div style={noteStyle}>
            数据门槛较高，并非所有山寨币都有好的链上数据覆盖。主流币效果好，小币酌情使用。
          </div>
        </Card>

        <Card
          title={
            <span>
              第五类：背景与归因信号 <Tag color="magenta">检测"这次暴涨的性质"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory5}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={hypothesisStyle}>
            <Text strong>检验假设：</Text>
            这次暴涨的"回落概率"从外部视角看是否偏高。
            <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
              <li>纯投机催化 → 回落快</li>
              <li>单独暴涨（板块没跟）→ 更可能是一次性事件</li>
              <li>价格已在历史高位 → 获利盘抛压更大</li>
            </ul>
          </div>
        </Card>

        <Card
          title={
            <span>
              第六类：时间节律信号 <Tag color="default">检测"市场自身的节奏"</Tag>
            </span>
          }
          size="small"
          style={cardStyle}
        >
          <Table
            columns={signalColumns}
            dataSource={signalCategory6}
            rowKey="id"
            pagination={false}
            size="small"
          />
          <div style={noteStyle}>效果较弱，属于锦上添花，不是核心判断依据。</div>
        </Card>
      </div>

      {/* 四、环境过滤层 */}
      <div style={sectionStyle}>
        <Title level={3}>四、环境过滤层（不是信号，是开关）</Title>
        <Paragraph>环境过滤决定的是"今天该不该开机"，而不是"该不该下单"。</Paragraph>
        <Table
          columns={[
            {
              title: '过滤条件',
              dataIndex: 'condition',
              key: 'condition',
              width: 180,
            },
            { title: '作用', dataIndex: 'effect', key: 'effect' },
            {
              title: '当前规则',
              dataIndex: 'rule',
              key: 'rule',
              width: 280,
            },
          ]}
          dataSource={envFilterData}
          pagination={false}
          size="small"
        />
      </div>

      {/* 五、信号之间的相关性矩阵 */}
      <div style={sectionStyle}>
        <Title level={3}>五、信号之间的相关性矩阵（避免虚假共振）</Title>
        <Paragraph>并非所有信号组合都有增量价值。以下是需要注意的相关性：</Paragraph>
        <Table
          columns={[
            { title: '信号对', dataIndex: 'pair', key: 'pair', width: 200 },
            {
              title: '相关程度',
              dataIndex: 'level',
              key: 'level',
              width: 120,
              render: level => {
                const color =
                  level === '中等相关' ? 'orange' : level === '低相关' ? 'green' : 'default';
                return <Tag color={color}>{level}</Tag>;
              },
            },
            { title: '说明', dataIndex: 'note', key: 'note' },
          ]}
          dataSource={correlationData}
          pagination={false}
          size="small"
        />
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message={`如果两个信号的相关程度为"中等"，它们仍然值得同时保留（因为存在可分离场景），但不要把它们当成两个完整的独立证据来计数。"`}
        />
      </div>

      {/* 六、如何使用这套框架 */}
      <div style={sectionStyle}>
        <Title level={3}>六、如何使用这套框架</Title>

        <Paragraph>
          <Text strong>不要追求 12 个全满足</Text>
          ——全满足的机会极其稀少。实操建议：
        </Paragraph>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 240,
              background: '#fff7e6',
              border: '1px solid #ffd591',
            }}
          >
            <Text strong style={{ color: '#fa8c16' }}>
              涨 10%
            </Text>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              可能只是小范围关注，注意力消退快但下跌空间也小
            </div>
          </Card>
          <Card
            size="small"
            style={{
              flex: 1,
              minWidth: 240,
              background: '#fff1f0',
              border: '1px solid #ffa39e',
            }}
          >
            <Text strong style={{ color: '#f5222d' }}>
              涨 80%
            </Text>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              吸引大量关注，可能形成更持久的叙事（"这个币会到xxx"），注意力消退未必那么快
            </div>
          </Card>
        </div>

        <Alert
          type="info"
          showIcon
          message={
            <span>
              <Text strong>第一性原理分析：</Text>
              暴涨的幅度影响注意力的持续时间，而系统对所有幅度一视同仁。
            </span>
          }
          description={
            <span>
              <Text strong>当前影响评估：</Text>可能不大，因为 <Text code>盈亏比 ≥ 2R</Text>{' '}
              间接过滤了涨幅太小的（跌不下去就没有 2R 空间）。但值得在 30
              笔数据里留意——大涨和小涨的胜率是否有差异。
            </span>
          }
          style={{ marginTop: 8 }}
        />

        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: '#f6ffed',
            borderRadius: 6,
            border: '1px solid #b7eb8f',
            fontSize: 13,
          }}
        >
          <Text strong>验证方法：</Text>30 笔数据收集后，按暴涨幅度分桶（&lt;20% / 20-50% /
          &gt;50%），对比各桶胜率。
        </div>

        {/* 漏洞二 */}
        <Card
          style={{ marginBottom: 16, borderLeft: '4px solid #faad14' }}
          title={
            <span>
              <Tag color={loopholeTagColor.medium}>待验证</Tag>
              漏洞二：横盘位置没有被区分
            </span>
          }
          size="small"
        >
          <Paragraph>一个币涨了 50% 后，存在两种截然不同的横盘场景：</Paragraph>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <Card
              size="small"
              style={{
                flex: 1,
                minWidth: 280,
                borderTop: '3px solid #ff4d4f',
              }}
            >
              <Text strong style={{ color: '#ff4d4f' }}>
                场景 A：顶部横盘
              </Text>
              <div style={{ fontSize: 13, marginTop: 4 }}>涨了 50%，目前还在 +48% 附近</div>
              <Divider style={{ margin: '8px 0' }} />
              <ul style={{ fontSize: 13, paddingLeft: 20, marginBottom: 0 }}>
                <li>买方还能在高位撑住，可能有真实需求</li>
                <li>做空后如果跌，空间大</li>
                <li>
                  <Text type="danger">但如果不跌，可能是强势整理后继续涨</Text>
                </li>
              </ul>
            </Card>
            <Card
              size="small"
              style={{
                flex: 1,
                minWidth: 280,
                borderTop: '3px solid #52c41a',
              }}
            >
              <Text strong style={{ color: '#52c41a' }}>
                场景 B：回落后横盘
              </Text>
              <div style={{ fontSize: 13, marginTop: 4 }}>先回落到 +25%，然后在这里横盘</div>
              <Divider style={{ margin: '8px 0' }} />
              <ul style={{ fontSize: 13, paddingLeft: 20, marginBottom: 0 }}>
                <li>买方力量更弱，更符合"注意力消退"假设</li>
                <li>
                  <Text type="warning">但利润空间也缩小了</Text>
                </li>
              </ul>
            </Card>
          </div>

          <Alert
            type="info"
            showIcon
            message={
              <span>
                <Text strong>第一性原理分析：</Text>场景 B
                更符合系统假设（注意力确实在消退，价格已经开始回归），而场景 A
                有可能是"强势整理"而非"衰竭"。
              </span>
            }
            description={
              <span>
                <Text strong>当前间接覆盖：</Text>
                规则 7（干净横盘）和规则
                4（确认K线）可能间接覆盖了一部分——强势整理通常不会出确认K线。但这是一个值得追踪的变量。
              </span>
            }
            style={{ marginTop: 8 }}
          />

          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: '#f6ffed',
              borderRadius: 6,
              border: '1px solid #b7eb8f',
              fontSize: 13,
            }}
          >
            <Text strong>验证方法：</Text>记录每笔交易的"横盘位置相对涨幅百分比"，对比顶部横盘 vs
            回落后横盘的胜率差异。
          </div>
        </Card>

        {/* 漏洞三 */}
        <Card
          style={{ marginBottom: 16, borderLeft: '4px solid #1890ff' }}
          title={
            <span>
              <Tag color={loopholeTagColor.low}>低优先级</Tag>
              漏洞三：7 天窗口是经验值，缺乏底层推导
            </span>
          }
          size="small"
        >
          <Paragraph>为什么是 7 天而不是 5 天或 10 天？从注意力消退的角度：</Paragraph>

          <Table
            columns={[
              { title: '时间窗口', dataIndex: 'window', key: 'window', width: 120 },
              { title: '注意力状态', dataIndex: 'state', key: 'state' },
              { title: '判断', dataIndex: 'judge', key: 'judge', width: 160 },
            ]}
            dataSource={[
              {
                key: '1',
                window: '< 3 天',
                state: '注意力可能还没充分消退',
                judge: '太短，信号不可靠',
              },
              {
                key: '2',
                window: '3 - 7 天',
                state: '注意力逐步消退，买盘开始枯竭',
                judge: '合理窗口',
              },
              {
                key: '3',
                window: '> 10 天',
                state: '暴涨的记忆已经淡化，市场进入新状态',
                judge: '模型可能不再适用',
              },
            ]}
            pagination={false}
            size="small"
            style={{ marginBottom: 16 }}
          />

          <Alert
            type="info"
            showIcon
            message={<span>7 天是一个合理的经验值，但 30 笔数据出来后值得精确化。</span>}
            style={{ marginTop: 8 }}
          />
        </Card>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, minWidth: 260, borderTop: '3px solid #ff4d4f' }}>
            <Text strong style={{ color: '#ff4d4f' }}>
              必要条件（缺一不可）
            </Text>
            <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
              行为衰竭信号（#1-4）+ 环境过滤通过
            </Paragraph>
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 260, borderTop: '3px solid #faad14' }}>
            <Text strong style={{ color: '#faad14' }}>
              强化条件（有则更好）
            </Text>
            <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
              仓位拥挤（#5-6）、催化剂为纯投机（#9）、非板块轮动（#10）
            </Paragraph>
          </Card>
          <Card size="small" style={{ flex: 1, minWidth: 260, borderTop: '3px solid #1890ff' }}>
            <Text strong style={{ color: '#1890ff' }}>
              辅助参考（锦上添花）
            </Text>
            <Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
              盘口深度（#7）、链上数据（#8）、历史位置（#11）、时间节律（#12）
            </Paragraph>
          </Card>
        </div>

        <Card title="核心原则" size="small" style={cardStyle}>
          <ul style={{ marginBottom: 0 }}>
            <li>必要条件是门槛，过不了门槛不讨论后面的</li>
            <li>强化条件每多满足一个，可以对这笔交易多一分信心（比如仓位可以稍微靠近上限）</li>
            <li>辅助参考不作为开仓依据，但可以在犹豫时帮助决策</li>
          </ul>
        </Card>

        <Card title="系统迭代方向" size="small" style={cardStyle}>
          <Paragraph>改进系统的正确方式不是"加更多 K 线形态规则"，而是：</Paragraph>
          <ol style={{ marginBottom: 0 }}>
            <li>
              寻找新的<Text strong>独立维度</Text>来增加共振
            </li>
            <li>
              更精确地<Text strong>测量现有维度</Text>
              （比如量化"缩量"的具体倍数标准）
            </li>
            <li>
              <Text strong>验证各维度的实际独立性</Text>
              （通过 30 笔交易数据回测）
            </li>
          </ol>
        </Card>
      </div>

      {/* 七、一句话总结 */}
      <div style={sectionStyle}>
        <Title level={3}>七、一句话总结</Title>
        <Card
          style={{
            background: 'linear-gradient(135deg, #f0f5ff 0%, #f6ffed 100%)',
            border: '1px solid #d9d9d9',
          }}
        >
          <Paragraph style={{ fontSize: 15, textAlign: 'center', marginBottom: 0 }}>
            <Text strong style={{ fontSize: 16 }}>
              系统 = 独立信号的共振（提升命中概率） × 环境过滤（排除失效场景） ×
              风控（兜底错误时的损失）
            </Text>
            <Divider style={{ margin: '12px 0' }} />
            三者缺一，系统就不完整。共振不够，胜率低；过滤不做，信号被噪声淹没；风控没有，一次错误就出局。
          </Paragraph>
        </Card>
      </div>
    </Typography>
  </div>
);

const MetaSystem = () => {
  const tabItems = [
    {
      key: 'principle',
      label: '第一性原理',
      children: <PrincipleContent />,
    },
    {
      key: 'system1',
      label: '放量冲关缩量滞涨',
      children: <System1Content />,
    },
    {
      key: 'system2',
      label: '开多探索',
      children: <PlaceholderTab name="开多探索" />,
    },
    {
      key: 'system3',
      label: '系统3（待定）',
      children: <PlaceholderTab name="系统3" />,
    },
  ];

  return <Tabs defaultActiveKey="principle" items={tabItems} size="large" />;
};

export default MetaSystem;
