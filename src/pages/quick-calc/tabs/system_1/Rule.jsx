import React from 'react';
import { Card, Typography, Table, Divider } from 'antd';

const { Title, Paragraph, Text } = Typography;

const Rule = () => {
  const meltdownColumns = [
    { title: '条件', dataIndex: 'condition', key: 'condition' },
    { title: '操作', dataIndex: 'action', key: 'action' },
  ];

  const dailyMeltdownData = [
    { key: '1', condition: '单日亏损达到总资金 4%', action: '当日停止交易，不得再开新仓' },
    { key: '2', condition: '单日连亏 2 笔', action: '当日停止交易' },
  ];

  const phaseMeltdownData = [
    { key: '1', condition: '连续亏损 5 笔', action: '暂停交易 3 天，进行全面复盘' },
    { key: '2', condition: '账户从阶段高点回撤达 15%', action: '暂停交易 1 周，审视系统是否失效' },
    {
      key: '3',
      condition: '账户从阶段高点回撤达 20%',
      action: '暂停交易 2 周，完整复盘后才能恢复',
    },
  ];

  return (
    <Card>
      <Typography>
        <Title level={2}>风控规则 v1.0</Title>
        <Paragraph type="secondary">
          创建日期：2026-03-25 更新日期：2026-04-15 适用资金规模：500-1000U 状态：
          <Text strong style={{ color: '#52c41a' }}>
            生效中
          </Text>
        </Paragraph>
        <Paragraph>
          <span style={{ borderLeft: '4px solid #1890ff', paddingLeft: 16, color: '#666' }}>
            交易的第一目标不是赚钱，是活下来。 只有活着，才有机会等到大行情。
          </span>
        </Paragraph>
        <Divider />
        <Title level={3}>一、单笔风险控制（最重要的一条规则）</Title>
        <Title level={4}>规则 R1：单笔最大亏损 ≤ 总资金的 2%</Title>
        <Paragraph>
          <Text code>单笔最大亏损 = 总资金 × 2%</Text>
        </Paragraph>
        <Paragraph>
          <Text strong>示例（总资金 500U）：</Text>
          <br />
          单笔最大亏损 = 500 × 2% = 10U
          <br />
          无论这笔交易用多少杠杆、开多大仓位，如果触发止损，亏损不能超过 10U。
        </Paragraph>
        <Paragraph>
          <Text strong>为什么是 2%？</Text>
          <ul>
            <li>连亏 10 笔，总亏损约 18%（在你的 20% 心理承受线以内）</li>
            <li>连亏 20 笔，总亏损约 33%（极端情况，仍可恢复）</li>
            <li>这意味着你的系统有足够的"试错次数"来找到盈利节奏</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3}>二、持仓限制</Title>
        <Title level={4}>规则 R3：最大同时持仓 ≤ 3 笔</Title>
        <ul>
          <li>同一时间最多持有 3 个仓位</li>
          <li>超过 3 个会导致注意力分散、管理困难</li>
        </ul>

        <Divider />

        <Title level={3}>三、熔断机制（强制休息）</Title>

        <Title level={4}>规则 R4：单日熔断</Title>
        <Table
          columns={meltdownColumns}
          dataSource={dailyMeltdownData}
          pagination={false}
          size="small"
        />

        <Title level={4} style={{ marginTop: 12 }}>
          规则 R5：阶段熔断
        </Title>
        <Table
          columns={meltdownColumns}
          dataSource={phaseMeltdownData}
          pagination={false}
          size="small"
        />
        <Paragraph style={{ marginTop: 8 }}>
          <Text strong>熔断的意义</Text>
          ：不是惩罚，而是保护。连续亏损时，心态已经不正常了。继续交易大概率是"报复性交易"，只会加速亏损。
        </Paragraph>
        <Divider />
        <Paragraph type="secondary" style={{ fontStyle: 'italic', marginTop: 16 }}>
          本规则为
          v1.1，随实盘经验积累可微调参数，但核心框架（单笔2%、必须止损、熔断机制）不可动摇。
        </Paragraph>
      </Typography>
    </Card>
  );
};

export default Rule;
