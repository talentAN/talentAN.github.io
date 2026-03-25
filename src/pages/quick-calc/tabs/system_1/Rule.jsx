import React from 'react';
import { Card, Typography, Table, Divider } from 'antd';

const { Title, Paragraph, Text } = Typography;

const Rule = () => {
  const quickRefColumns = [
    { title: '总资金', dataIndex: 'total', key: 'total' },
    { title: '单笔最大亏损(2%)', dataIndex: 'maxLoss', key: 'maxLoss' },
    { title: '15%回撤熔断线', dataIndex: 'stop15', key: 'stop15' },
    { title: '20%回撤熔断线', dataIndex: 'stop20', key: 'stop20' },
  ];

  const quickRefData = [
    { key: '1', total: '500U', maxLoss: '10U', stop15: '425U', stop20: '400U' },
    { key: '2', total: '600U', maxLoss: '12U', stop15: '510U', stop20: '480U' },
    { key: '3', total: '700U', maxLoss: '14U', stop15: '595U', stop20: '560U' },
    { key: '4', total: '800U', maxLoss: '16U', stop15: '680U', stop20: '640U' },
    { key: '5', total: '1000U', maxLoss: '20U', stop15: '850U', stop20: '800U' },
  ];

  const positionColumns = [
    { title: '止损幅度 \\ 杠杆', dataIndex: 'stop', key: 'stop' },
    { title: '2x', dataIndex: 'lev2', key: 'lev2' },
    { title: '3x', dataIndex: 'lev3', key: 'lev3' },
    { title: '5x', dataIndex: 'lev5', key: 'lev5' },
  ];

  const positionData = [
    { key: '1', stop: '3%', lev2: '167U', lev3: '111U', lev5: '67U' },
    { key: '2', stop: '5%', lev2: '100U', lev3: '67U', lev5: '40U' },
    { key: '3', stop: '8%', lev2: '63U', lev3: '42U', lev5: '25U' },
    { key: '4', stop: '10%', lev2: '50U', lev3: '33U', lev5: '20U' },
    { key: '5', stop: '15%', lev2: '33U', lev3: '22U', lev5: '13U' },
  ];

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
    { key: '3', condition: '账户从阶段高点回撤达 20%', action: '暂停交易 2 周，完整复盘后才能恢复' },
  ];

  return (
    <Card>
      <Typography>
        <Title level={2}>风控规则 v1.0</Title>
        <Paragraph type="secondary">
          任务 1.1 产出<br />
          创建日期：2026-03-25<br />
          适用资金规模：500U<br />
          状态：<Text strong style={{ color: '#52c41a' }}>生效中</Text>
        </Paragraph>

        <Divider />

        <Title level={3}>〇、核心理念</Title>
        <Paragraph>
          <blockquote style={{ borderLeft: '4px solid #1890ff', paddingLeft: 16, color: '#666' }}>
            交易的第一目标不是赚钱，是活下来。<br />
            只有活着，才有机会等到大行情。
          </blockquote>
        </Paragraph>

        <Divider />

        <Title level={3}>一、单笔风险控制（最重要的一条规则）</Title>
        
        <Title level={4}>规则 R1：单笔最大亏损 ≤ 总资金的 2%</Title>
        <Paragraph>
          <Text code>单笔最大亏损 = 总资金 × 2%</Text>
        </Paragraph>
        <Paragraph>
          <Text strong>示例（总资金 500U）：</Text><br />
          单笔最大亏损 = 500 × 2% = 10U<br />
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

        <Title level={4}>规则 R2：每笔交易入场前必须计算仓位</Title>
        <Paragraph>
          <Text code>仓位大小 = 单笔最大亏损 ÷ (止损幅度% × 杠杆倍数)</Text>
        </Paragraph>
        <Paragraph>
          <Text strong>示例：</Text><br />
          总资金 500U，单笔风险 2%（10U）<br />
          计划止损幅度 5%，杠杆 3x<br />
          <br />
          仓位保证金 = 10 ÷ (5% × 3) = 10 ÷ 0.15 = 66.7U<br />
          <br />
          验证：66.7U × 3x杠杆 = 200U 名义头寸<br />
          亏损 5%：200 × 5% = 10U ✓ 等于最大风险
        </Paragraph>
        <Paragraph>
          <Text strong type="danger">铁律：先定止损，再算仓位。永远不要反过来。</Text>
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

        <Title level={4} style={{ marginTop: 24 }}>规则 R5：阶段熔断</Title>
        <Table 
          columns={meltdownColumns} 
          dataSource={phaseMeltdownData} 
          pagination={false}
          size="small"
        />
        <Paragraph style={{ marginTop: 16 }}>
          <Text strong>熔断的意义</Text>：不是惩罚，而是保护。连续亏损时，心态已经不正常了。继续交易大概率是"报复性交易"，只会加速亏损。
        </Paragraph>

        <Divider />

        <Title level={3}>四、加仓规则</Title>
        
        <Title level={4}>规则 R6：只在盈利仓位上加仓</Title>
        <ul>
          <li>浮亏的仓位<Text strong type="danger">永远不加仓</Text>（"摊低成本"是亏损交易者最常见的错误）</li>
          <li>只有当仓位浮盈，且止损已上移至保本位以上时，才允许加仓</li>
          <li>加仓后的新止损仍需满足 R1（单笔2%风险）</li>
        </ul>

        <Title level={4}>规则 R7：加仓次数 ≤ 1 次</Title>
        <ul>
          <li>最多加仓一次，避免在高位堆积过大头寸</li>
        </ul>

        <Divider />

        <Title level={3}>五、特殊情况规则</Title>
        
        <Title level={4}>规则 R8：不隔夜持有无止损的仓位</Title>
        <ul>
          <li>每一个持仓必须有止损单（限价或市价触发）</li>
          <li>睡觉前必须检查所有仓位的止损是否设置</li>
        </ul>

        <Title level={4}>规则 R9：不在重大事件前重仓</Title>
        <Paragraph>
          已知的重大事件（CPI 数据、FOMC 会议、项目解锁等）前 24 小时：
          <ul>
            <li>不新开仓</li>
            <li>已有仓位减半或收紧止损</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={3}>六、规则执行检查清单</Title>
        <Paragraph>每次开仓前，过一遍这个清单：</Paragraph>
        <Paragraph>
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
{`□ 1. 止损价格已确定
□ 2. 仓位已按公式计算（不是拍脑袋）
□ 3. 当前持仓数 < 3
□ 4. 今日未触发熔断
□ 5. 不处于重大事件前24小时
□ 6. 心态正常，不是在报复交易
□ 7. 有明确的入场理由（不是 FOMO）
□ 8. 止损单已挂好`}
          </pre>
        </Paragraph>
        <Paragraph>
          <Text strong>以上 8 条全部打勾，才允许开仓。</Text>
        </Paragraph>

        <Divider />

        <Title level={3}>七、快速参考表</Title>
        <Paragraph>以下是不同资金量下的关键数值速查：</Paragraph>
        <Table 
          columns={quickRefColumns} 
          dataSource={quickRefData} 
          pagination={false}
          size="small"
        />

        <Divider />

        <Title level={3}>八、仓位速算表</Title>
        <Paragraph>单笔风险 2%，不同止损幅度和杠杆下的保证金（总资金 500U，最大亏损 10U）：</Paragraph>
        <Table 
          columns={positionColumns} 
          dataSource={positionData} 
          pagination={false}
          size="small"
        />
        <Paragraph style={{ marginTop: 16 }}>
          <Text strong>读法</Text>：止损幅度 5%、杠杆 3x → 投入保证金 67U，亏损时最多亏 10U。
        </Paragraph>

        <Divider />

        <Title level={3}>九、违规记录</Title>
        <Paragraph>每次违反以上规则时，在此记录（诚实面对自己）：</Paragraph>
        <Table 
          columns={[
            { title: '日期', dataIndex: 'date', key: 'date' },
            { title: '违反规则', dataIndex: 'rule', key: 'rule' },
            { title: '具体情况', dataIndex: 'detail', key: 'detail' },
            { title: '后果', dataIndex: 'result', key: 'result' },
            { title: '反思', dataIndex: 'reflection', key: 'reflection' },
          ]} 
          dataSource={[]} 
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无违规记录' }}
        />

        <Divider />

        <Paragraph type="secondary" style={{ fontStyle: 'italic', marginTop: 32 }}>
          本规则为 v1.0，随实盘经验积累可微调参数，但核心框架（单笔2%、必须止损、熔断机制）不可动摇。
        </Paragraph>
      </Typography>
    </Card>
  );
};

export default Rule;
