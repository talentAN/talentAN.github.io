import React, { useState } from 'react';
import {
  Card,
  Form,
  InputNumber,
  Button,
  Typography,
  Space,
  Divider,
  Row,
  Col,
  Checkbox,
} from 'antd';

const { Title, Text } = Typography;

const PositionCalculator = () => {
  const [result, setResult] = useState(null);
  const [checkedItems, setCheckedItems] = useState([]);
  const [evResult, setEvResult] = useState(null);

  const calculatePosition = values => {
    const { totalFund, riskPercent, stopLossPercent, leverage } = values;

    // 单笔最大亏损
    const maxLoss = totalFund * (riskPercent / 100);

    // 仓位保证金 = 单笔最大亏损 ÷ (止损幅度% × 杠杆倍数)
    const positionMargin = maxLoss / ((stopLossPercent / 100) * leverage);

    // 名义头寸
    const nominalPosition = positionMargin * leverage;

    // 验证：亏损金额
    const verifyLoss = nominalPosition * (stopLossPercent / 100);

    setResult({
      maxLoss: maxLoss.toFixed(2),
      positionMargin: positionMargin.toFixed(2),
      nominalPosition: nominalPosition.toFixed(2),
      verifyLoss: verifyLoss.toFixed(2),
    });
  };

  const calculateEV = values => {
    const { winRate, avgProfit, avgLoss, numTrades } = values;

    // 转换百分比为小数
    const winRateDecimal = winRate / 100;
    const lossRateDecimal = 1 - winRateDecimal;

    // 单笔期望值 = (胜率 × 平均盈利) - (亏损率 × 平均亏损)
    const singleEV = winRateDecimal * avgProfit - lossRateDecimal * avgLoss;

    // 总期望值
    const tradeCount = numTrades || 1;
    const totalEV = singleEV * tradeCount;

    // 年化期望值（假设一年250个交易日）
    const annualEV = singleEV * tradeCount * 250;

    setEvResult({
      winRate: (winRateDecimal * 100).toFixed(2),
      lossRate: (lossRateDecimal * 100).toFixed(2),
      singleEV: singleEV.toFixed(2),
      totalEV: totalEV.toFixed(2),
      tradeCount: tradeCount,
      annualEV: annualEV.toFixed(2),
      isPositive: singleEV > 0,
    });
  };

  return (
    <>
      <Row gutter={16}>
        <Col span={12}>
          <Card>
            <Title level={3}>开仓检查清单</Title>
            <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
              <Checkbox.Group
                value={checkedItems}
                onChange={setCheckedItems}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                options={[
                  { label: '1. 止损价格已确定', value: '1' },
                  { label: '2. 仓位已按公式计算（不是拍脑袋）', value: '2' },
                  { label: '3. 当前持仓数 < 3', value: '3' },
                  { label: '4. 今日未触发熔断', value: '4' },
                  { label: '5. 不处于重大事件前24小时', value: '5' },
                  { label: '6. 心态正常，不是在报复交易', value: '6' },
                  { label: '7. 有明确的入场理由（不是 FOMO）', value: '7' },
                  { label: '8. 止损单已挂好', value: '8' },
                ]}
              />
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <Title level={3}>仓位计算器</Title>
            <Form
              layout="vertical"
              onFinish={calculatePosition}
              initialValues={{
                totalFund: 500,
                riskPercent: 2,
                stopLossPercent: 5,
                leverage: 3,
              }}
            >
              <Form.Item
                label="总资金 (U)"
                name="totalFund"
                rules={[{ required: true, message: '请输入总资金' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>

              <Form.Item
                label="单笔风险比例 (%)"
                name="riskPercent"
                rules={[{ required: true, message: '请输入风险比例' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
              </Form.Item>

              <Form.Item
                label="止损幅度 (%)"
                name="stopLossPercent"
                rules={[{ required: true, message: '请输入止损幅度' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
              </Form.Item>

              <Form.Item
                label="杠杆倍数"
                name="leverage"
                rules={[{ required: true, message: '请输入杠杆倍数' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={125} />
              </Form.Item>

              {result && (
                <Card size="small" style={{ marginBottom: 16, background: '#f0f9ff' }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <div>
                      <Text strong>单笔最大亏损：</Text>
                      <Text style={{ fontSize: 18, color: '#ff4d4f', marginLeft: 8 }}>
                        {result.maxLoss} U
                      </Text>
                    </div>
                    <Divider style={{ margin: '8px 0' }} />
                    <div>
                      <Text strong>应投入保证金：</Text>
                      <Text style={{ fontSize: 20, color: '#1890ff', marginLeft: 8 }}>
                        {result.positionMargin} U
                      </Text>
                    </div>
                    <div>
                      <Text type="secondary">名义头寸：{result.nominalPosition} U</Text>
                    </div>
                    <Divider style={{ margin: '8px 0' }} />
                    <div>
                      <Text type="secondary">验证：触发止损时亏损 {result.verifyLoss} U</Text>
                      {Math.abs(parseFloat(result.verifyLoss) - parseFloat(result.maxLoss)) <
                        0.01 && (
                        <Text type="success" style={{ marginLeft: 8 }}>
                          ✓ 计算正确
                        </Text>
                      )}
                    </div>
                  </Space>
                </Card>
              )}

              <Form.Item>
                <Button type="primary" htmlType="submit" block>
                  计算仓位
                </Button>
              </Form.Item>
            </Form>

            <Divider />

            <div style={{ background: '#fafafa', padding: 16, borderRadius: 4 }}>
              <Text strong>计算公式：</Text>
              <pre style={{ marginTop: 8, fontSize: 12 }}>
                {`仓位保证金 = 单笔最大亏损 ÷ (止损幅度% × 杠杆倍数)

示例：
  总资金 500U，风险 2%（10U）
  止损 5%，杠杆 3x
  
  仓位保证金 = 10 ÷ (5% × 3) = 66.7U
  名义头寸 = 66.7 × 3 = 200U
  触发止损亏损 = 200 × 5% = 10U ✓`}
              </pre>
            </div>
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card>
            <Title level={3}>系统期望值计算</Title>
            <Form
              layout="vertical"
              onFinish={calculateEV}
              initialValues={{
                winRate: 55,
                avgProfit: 100,
                avgLoss: 80,
                numTrades: 20,
              }}
            >
              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item
                    label="胜率 (%)"
                    name="winRate"
                    rules={[{ required: true, message: '请输入胜率' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label="平均盈利 (U)"
                    name="avgProfit"
                    rules={[{ required: true, message: '请输入平均盈利' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label="平均亏损 (U)"
                    name="avgLoss"
                    rules={[{ required: true, message: '请输入平均亏损' }]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="交易次数 (可选)" name="numTrades">
                    <InputNumber style={{ width: '100%' }} min={0} placeholder="默认按单笔计算" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item>
                <Button type="primary" htmlType="submit" block>
                  计算期望值
                </Button>
              </Form.Item>

              {evResult && (
                <Card
                  size="small"
                  style={{ marginTop: 16, background: evResult.isPositive ? '#f6ffed' : '#fff1f0' }}
                >
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Row gutter={16}>
                      <Col span={6}>
                        <div>
                          <Text strong>胜率</Text>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 'bold',
                              color: '#1890ff',
                              marginTop: 4,
                            }}
                          >
                            {evResult.winRate}%
                          </div>
                        </div>
                      </Col>
                      <Col span={6}>
                        <div>
                          <Text strong>亏损率</Text>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 'bold',
                              color: '#ff4d4f',
                              marginTop: 4,
                            }}
                          >
                            {evResult.lossRate}%
                          </div>
                        </div>
                      </Col>
                      <Col span={12}>
                        <div>
                          <Text strong>单笔期望值</Text>
                          <div
                            style={{
                              fontSize: 24,
                              fontWeight: 'bold',
                              color: evResult.isPositive ? '#52c41a' : '#ff4d4f',
                              marginTop: 4,
                            }}
                          >
                            {evResult.singleEV} U
                            <Text
                              type={evResult.isPositive ? 'success' : 'danger'}
                              style={{ marginLeft: 8, fontSize: 14 }}
                            >
                              {evResult.isPositive ? '✓ 正期望值' : '✗ 负期望值'}
                            </Text>
                          </div>
                        </div>
                      </Col>
                    </Row>

                    <Divider style={{ margin: '12px 0' }} />

                    <Row gutter={16}>
                      <Col span={12}>
                        <div>
                          <Text strong>总期望值</Text>
                          <div
                            style={{
                              fontSize: 18,
                              color: evResult.isPositive ? '#52c41a' : '#ff4d4f',
                              marginTop: 4,
                            }}
                          >
                            {evResult.totalEV} U
                          </div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {evResult.totalEV} U（{evResult.tradeCount} 次交易）
                          </Text>
                        </div>
                      </Col>
                      <Col span={12}>
                        <div>
                          <Text strong>年化期望值</Text>
                          <div
                            style={{
                              fontSize: 18,
                              color: evResult.isPositive ? '#52c41a' : '#ff4d4f',
                              marginTop: 4,
                            }}
                          >
                            {evResult.annualEV} U
                          </div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            假设每年 250 个交易日
                          </Text>
                        </div>
                      </Col>
                    </Row>

                    <Divider style={{ margin: '12px 0' }} />

                    <div style={{ background: '#fafafa', padding: 8, borderRadius: 4 }}>
                      <Text strong>计算公式：</Text>
                      <pre style={{ marginTop: 8, fontSize: 12, margin: '8px 0 0 0' }}>
                        {`单笔期望值 = (胜率 × 平均盈利) - (亏损率 × 平均亏损)

示例：
  胜率 55%，平均盈利 100U，平均亏损 80U
  
  单笔 EV = (55% × 100) - (45% × 80) = 55 - 36 = 19U
  20 次交易期望值 = 19 × 20 = 380U
  年化期望值 = 19 × 20 × 250 = 95,000U`}
                      </pre>
                    </div>
                  </Space>
                </Card>
              )}
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default PositionCalculator;
