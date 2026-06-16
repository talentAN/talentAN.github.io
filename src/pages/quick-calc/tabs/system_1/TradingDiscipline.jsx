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
          id: 1.1,
          title: '缩量至少 2 天以上',
          description: '刚缩量一天的，不考虑入场（HUSDT）',
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
          id: 6,
          title: '检查价格',
          description: '入价格已经破了历史新高，不入或慎入',
        },
        {
          id: 7,
          title: '不下隔夜委托单',
          description: '从历史数据看，夜间成交的委托单质量太差，而且经常插针，不考虑',
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
          id: 8,
          title: '插针当天不重新进场',
          description:
            '如果某个币对当日出现插针被止损，当天不再重新进场该币对。等次日看形态后再说，给市场时间复原。',
        },
        {
          id: 11,
          title: '只在盈利仓位上加仓',
          description:
            '加仓必须严格遵循：(1) 浮亏仓位永远不加仓——"摊低成本"是亏损交易者最常见的错误；(2) 只有当仓位浮盈，且止损已上移至保本位以上时，才允许加仓；(3) 加仓后的新止损仍需满足单笔2%风险规则。',
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
