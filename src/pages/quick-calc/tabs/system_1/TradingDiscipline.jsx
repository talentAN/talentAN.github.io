import React from 'react';
import { Card, Typography, Divider, List } from 'antd';

const { Title, Paragraph, Text } = Typography;

const TradingDiscipline = () => {
  const disciplines = [
    {
      category: '开仓前',
      icon: '📋',
      items: [
        {
          id: 1,
          title: '只看已收盘的K线判断',
          description:
            '入场判断基于已经收盘的K线形态，不要看未收盘的K线。不要被当前价格波动盘中信号所迷惑。',
        },
        {
          id: 2,
          title: '先定止损再算仓位',
          description:
            '在任何情况下，必须先确定止损点位和幅度，然后根据止损幅度计算仓位大小。永远不要先入场再想止损和仓位。',
        },
        {
          id: 3,
          title: '确认盈亏比合理',
          description:
            '入场前必须计算预期盈利与可能亏损的比例。低于 1:2 的盈亏比不值得交易。确保每笔交易的期望值为正。',
        },
        {
          id: 4,
          title: '不要追高买入',
          description:
            '标的物价格已经大幅上涨后，不要再追高买入。应该等待技术性回调或新的入场信号后再考虑建仓。',
        },
        {
          id: 5,
          title: '检查持仓数量限制',
          description: '入场前确认当前持仓数量是否已达上限（最多3个持仓）。超过限制时不得再开新仓。',
        },
      ],
    },
    {
      category: '持仓中',
      icon: '📈',
      items: [
        {
          id: 6,
          title: '止损必须立即执行',
          description:
            '一旦触发预设止损点位，必须立即执行，不要有任何心理活动和犹豫。止损是对过去判断错误的认可，也是保护后续资金的必要措施。',
        },
        {
          id: 7,
          title: '不要在盘中改仓位',
          description:
            '持仓中不要根据当前价格波动改变仓位大小。只看价格是否符合自己预设的止损/止盈，不要有其他操作。',
        },
        {
          id: 8,
          title: '插针当天不重新进场',
          description:
            '如果某个币对当日出现插针被止损，当天不再重新进场该币对。等次日看形态后再说，给市场时间复原。',
        },
        {
          id: 9,
          title: '持仓时间过长要平仓',
          description:
            '如果持仓已经超过预期时间太久还没有发展成预期方向，及时平仓离场。不要死抱不放。',
        },
        {
          id: 10,
          title: '不要追加仓位摊平',
          description:
            '亏损中的头寸不要再追加仓位来摊低成本。这样只会扩大总亏损风险。按原计划执行止损是唯一选择。',
        },
      ],
    },
  ];

  return (
    <Card>
      <Typography>
        <Title level={2}>交易纪律</Title>
        <Paragraph type="secondary">
          在频繁交易中容易忽视的关键纪律。交易前仔细阅读，有助于规避人性弱点。
        </Paragraph>

        <Divider />

        <Paragraph
          style={{
            padding: '12px',
            background: '#e6f7ff',
            borderRadius: 4,
            borderLeft: '4px solid #1890ff',
          }}
        >
          <Text strong>💡 核心理念</Text>
          <br />
          交易纪律不是为了让你赚更多钱，而是为了让你持续活在市场上。活得久，机会就多。
        </Paragraph>

        <Divider />

        {disciplines.map(section => (
          <div key={section.category} style={{ marginBottom: 32 }}>
            <Title level={3} style={{ color: '#1890ff', marginBottom: 16 }}>
              {section.icon} {section.category}
            </Title>
            <List
              dataSource={section.items}
              renderItem={item => (
                <List.Item style={{ paddingLeft: 0, paddingRight: 0, marginBottom: 16 }}>
                  <List.Item.Meta
                    title={
                      <Text strong style={{ fontSize: 14 }}>
                        {item.title}
                      </Text>
                    }
                    description={
                      <Paragraph
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          color: '#666',
                          lineHeight: 1.6,
                        }}
                      >
                        {item.description}
                      </Paragraph>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        ))}

        <Divider />

        <Paragraph style={{ padding: '12px', background: '#f6ffed', borderRadius: 4 }}>
          <Text type="success" strong>
            ✓ 遵守纪律的回报
          </Text>
          <ul style={{ marginTop: 8, marginBottom: 0 }}>
            <li>降低重复犯错的概率</li>
            <li>更稳定的交易表现</li>
            <li>长期生存和盈利的基石</li>
          </ul>
        </Paragraph>
      </Typography>
    </Card>
  );
};

export default TradingDiscipline;
