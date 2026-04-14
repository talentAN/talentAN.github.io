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
  Segmented,
  Progress,
  Alert,
  message,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const PositionCalculator = () => {
  const [direction, setDirection] = useState('long');
  const [result, setResult] = useState(null);
  const [rrResult, setRrResult] = useState(null);
  const [checkedItems, setCheckedItems] = useState([]);
  const [form] = Form.useForm();

  const calculatePosition = values => {
    const { capital, riskPct, entry, stopLoss, target, leverage } = values;

    if (!capital || !riskPct || !entry || !stopLoss || !leverage) {
      message.error('请填写所有必填项');
      return;
    }

    // 验证方向
    const isLongValid = direction === 'long' && stopLoss < entry;
    const isShortValid = direction === 'short' && stopLoss > entry;

    if (!isLongValid && !isShortValid) {
      const directionText = direction === 'long' ? '做多' : '做空';
      const expectedText = direction === 'long' ? '止损价应该小于入场价' : '止损价应该大于入场价';
      message.error(`${directionText}方向与止损价不匹配，${expectedText}`);
      return;
    }

    // 止损幅度
    const stopDist = Math.abs(entry - stopLoss) / entry;
    const stopDistPct = stopDist * 100;

    // 最大亏损
    const maxLoss = capital * (riskPct / 100);

    // 名义仓位
    const notional = maxLoss / stopDist;

    // 保证金
    const margin = notional / leverage;

    // 数量
    const qty = notional / entry;

    // 强平距离
    const liqDist = (1 / leverage) * 100;

    // 验证亏损
    const verifyLoss = notional * stopDist;
    const verifyPct = (verifyLoss / capital) * 100;

    const alerts = [];

    if (margin > capital) {
      alerts.push({
        type: 'error',
        message: `保证金 ${margin.toFixed(0)}U 超过总资金 — 请降低杠杆或增大止损距离`,
      });
    }

    if (stopDistPct >= liqDist) {
      alerts.push({
        type: 'error',
        message: `止损幅度 ${stopDistPct.toFixed(1)}% ≥ 强平距离 ${liqDist.toFixed(1)}% — 会被爆仓！请降低杠杆`,
      });
    }

    if (riskPct > 2) {
      alerts.push({
        type: 'warning',
        message: `单笔风险 ${riskPct}% 超过建议上限 2%`,
      });
    }

    setResult({
      stopDistPct,
      maxLoss,
      notional,
      margin,
      qty,
      liqDist,
      verifyLoss,
      verifyPct,
      alerts,
      marginPct: (margin / capital) * 100,
    });

    // 计算盈亏比
    if (target && target > 0) {
      const isValidTarget =
        (direction === 'long' && target > entry) || (direction === 'short' && target < entry);

      if (isValidTarget) {
        const profitDist = Math.abs(target - entry) / entry;
        const lossDist = stopDist;
        const rr = profitDist / lossDist;
        const profitU = notional * profitDist;
        const profitR = profitU / maxLoss;

        const rrAlerts = [];
        if (rr < 2) {
          rrAlerts.push({
            type: 'error',
            message: `盈亏比 ${rr.toFixed(2)} < 2 — 系统要求 ≥ 2`,
          });
        } else {
          rrAlerts.push({
            type: 'success',
            message: `盈亏比 ${rr.toFixed(2)} ≥ 2 ✓`,
          });
        }

        setRrResult({
          rr,
          profitU,
          profitR,
          rrAlerts,
          barTotal: 1 + rr,
        });
      } else {
        setRrResult(null);
      }
    } else {
      setRrResult(null);
    }
  };

  const handleConfirmOrder = () => {
    if (!result) {
      alert('请先计算仓位');
      return;
    }

    const orderInfo = {
      direction,
      capital: form.getFieldValue('capital'),
      riskPct: form.getFieldValue('riskPct'),
      entry: form.getFieldValue('entry'),
      stopLoss: form.getFieldValue('stopLoss'),
      target: form.getFieldValue('target'),
      leverage: form.getFieldValue('leverage'),
      ...result,
      timestamp: new Date().toLocaleString(),
    };

    console.log('下单信息：', orderInfo);
    alert(
      `已确认${direction === 'long' ? '做多' : '做空'} — 请前往交易所下单\n\n名义仓位: ${result.notional.toFixed(2)}U\n所需保证金: ${result.margin.toFixed(2)}U\n止损价格: ${form.getFieldValue('stopLoss')}`
    );
  };

  const handleCopyOrderInfo = () => {
    if (!result) {
      message.warning('请先计算仓位');
      return;
    }

    const entry = form.getFieldValue('entry');
    const stopLoss = form.getFieldValue('stopLoss');
    const target = form.getFieldValue('target');
    const rrText = rrResult ? `，盈亏比：1:${rrResult.rr.toFixed(2)}` : '';

    const copyText = `计划开仓价：${entry}，止损：${stopLoss}，止盈：${target || '待定'}${rrText}`;

    navigator.clipboard
      .writeText(copyText)
      .then(() => {
        message.success('已复制');
      })
      .catch(() => {
        message.error('复制失败');
      });
  };

  const isAllChecked = checkedItems.length === 8;

  return (
    <>
      {/* 计算器和结果 - 左右并排 */}
      <Row gutter={16}>
        {/* 左列：仓位计算器 */}
        <Col span={12}>
          <Card style={{ height: '100%' }}>
            <Title level={4} style={{ marginBottom: 12 }}>
              仓位计算器
            </Title>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                方向
              </label>
              <Segmented
                value={direction}
                onChange={setDirection}
                options={[
                  { label: '做多 Long', value: 'long' },
                  { label: '做空 Short', value: 'short' },
                ]}
                block
                className={`direction-toggle direction-${direction}`}
                style={{ fontSize: 12 }}
              />
              <style>{`
                .direction-toggle.direction-long .ant-segmented-item-selected {
                  background-color: #52c41a !important;
                  color: white !important;
                }
                .direction-toggle.direction-short .ant-segmented-item-selected {
                  background-color: #ff4d4f !important;
                  color: white !important;
                }
              `}</style>
            </div>

            <Form
              form={form}
              layout="vertical"
              onFinish={calculatePosition}
              initialValues={{
                capital: 500,
                riskPct: 2,
                leverage: 5,
              }}
            >
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item
                    label="总资金"
                    name="capital"
                    rules={[{ required: true, message: '必填' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={0}
                      step={1}
                      placeholder="USDT"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="风险 %"
                    name="riskPct"
                    rules={[{ required: true, message: '必填' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={0}
                      max={5}
                      step={0.1}
                      placeholder="LE ≤ 2%"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item
                    label="入场价"
                    name="entry"
                    rules={[{ required: true, message: '必填' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={0}
                      step="any"
                      placeholder="USDT"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="止损价"
                    name="stopLoss"
                    rules={[{ required: true, message: '必填' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={0}
                      step="any"
                      placeholder="USDT"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label="目标价（可选）" name="target" style={{ marginBottom: 8 }}>
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={0}
                      step="any"
                      placeholder="USDT"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="杠杆"
                    name="leverage"
                    rules={[{ required: true, message: '必填' }]}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%', fontSize: 12 }}
                      min={1}
                      max={125}
                      step={1}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item style={{ marginBottom: 0 }}>
                <Space style={{ width: '100%' }} size={8}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    style={{ fontSize: 14, flex: 8, height: 40 }}
                  >
                    计算仓位
                  </Button>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={handleCopyOrderInfo}
                    size="large"
                    style={{ fontSize: 12, flex: 1, height: 40 }}
                    title="复制: 开仓价、止损、止盈、盈亏比"
                  />
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* 右列：计算结果 */}
        <Col span={12}>
          {result ? (
            <Card style={{ background: '#f0f9ff', height: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ fontSize: 12 }}>
                    止损幅度
                  </Text>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff', marginTop: 2 }}>
                    {result.stopDistPct.toFixed(2)}%
                  </div>
                </div>

                <Divider style={{ margin: '6px 0' }} />

                <Row gutter={12} style={{ marginBottom: 6 }}>
                  <Col span={12}>
                    <div
                      style={{
                        minHeight: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        最大亏损
                      </Text>
                      <div style={{ fontSize: 14, color: '#ff4d4f', marginTop: 2 }}>
                        {result.maxLoss.toFixed(2)} U
                      </div>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div
                      style={{
                        minHeight: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        名义仓位
                      </Text>
                      <div style={{ fontSize: 14, color: '#1890ff', marginTop: 2 }}>
                        {result.notional.toFixed(2)} U
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        ≈ {result.qty.toFixed(4)}
                      </Text>
                    </div>
                  </Col>
                </Row>

                <Row gutter={12} style={{ marginBottom: 6 }}>
                  <Col span={12}>
                    <div
                      style={{
                        minHeight: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        所需保证金
                      </Text>
                      <div style={{ fontSize: 14, color: '#52c41a', marginTop: 2 }}>
                        {result.margin.toFixed(2)} U
                      </div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {result.marginPct.toFixed(1)}%
                      </Text>
                    </div>
                  </Col>
                  <Col span={12}>
                    <div
                      style={{
                        minHeight: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-start',
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        强平距离
                      </Text>
                      <div style={{ fontSize: 14, marginTop: 2 }}>{result.liqDist.toFixed(1)}%</div>
                    </div>
                  </Col>
                </Row>

                <Divider style={{ margin: '6px 0' }} />

                <div style={{ marginBottom: 6 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    验算：止损时亏损 {result.verifyLoss.toFixed(2)} U
                    {Math.abs(result.verifyLoss - result.maxLoss) < 0.01 && (
                      <Text type="success" style={{ marginLeft: 4, fontSize: 11 }}>
                        ✓
                      </Text>
                    )}
                  </Text>
                </div>

                {result.alerts.map((alert, idx) => (
                  <Alert
                    key={idx}
                    type={alert.type}
                    message={alert.message}
                    showIcon
                    style={{ marginTop: 6, fontSize: 12, padding: '6px 12px' }}
                  />
                ))}

                {rrResult && (
                  <>
                    <Divider style={{ margin: '8px 0' }} />
                    <div style={{ marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 12 }}>
                        盈亏比分析
                      </Text>
                    </div>
                    <Row gutter={12} style={{ marginBottom: 6 }}>
                      <Col span={8}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                          }}
                        >
                          <Text strong style={{ fontSize: 11 }}>
                            R:R
                          </Text>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 'bold',
                              color: rrResult.rr >= 2 ? '#52c41a' : '#ff4d4f',
                              marginTop: 2,
                            }}
                          >
                            1 : {rrResult.rr.toFixed(2)}
                          </div>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                          }}
                        >
                          <Text strong style={{ fontSize: 11 }}>
                            潜在盈利
                          </Text>
                          <div style={{ fontSize: 14, color: '#52c41a', marginTop: 2 }}>
                            +{rrResult.profitU.toFixed(2)} U
                          </div>
                          <Text type="secondary" style={{ fontSize: 10 }}>
                            {rrResult.profitR.toFixed(1)}R
                          </Text>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-start',
                          }}
                        >
                          <Text strong style={{ fontSize: 11 }}>
                            风险/收益
                          </Text>
                          <div style={{ fontSize: 10, marginTop: 4 }}>
                            <Progress
                              type="line"
                              percent={Math.round((1 / rrResult.barTotal) * 100)}
                              strokeColor="#ff4d4f"
                              showInfo={false}
                            />
                            <Progress
                              type="line"
                              percent={Math.round((rrResult.rr / rrResult.barTotal) * 100)}
                              strokeColor="#52c41a"
                              showInfo={false}
                              style={{ marginTop: 2 }}
                            />
                          </div>
                        </div>
                      </Col>
                    </Row>
                    {rrResult.rrAlerts.map((alert, idx) => (
                      <Alert
                        key={idx}
                        type={alert.type}
                        message={alert.message}
                        showIcon
                        style={{ marginBottom: 6, fontSize: 12, padding: '6px 12px' }}
                      />
                    ))}
                  </>
                )}
              </Space>
            </Card>
          ) : (
            <Card
              style={{
                background: '#f5f5f5',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text type="secondary">计算结果将在此显示</Text>
            </Card>
          )}
        </Col>
      </Row>

      {/* 开仓检查清单 - 两列展示 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card>
            <Title level={4} style={{ marginBottom: 12 }}>
              开仓检查清单
            </Title>
            <Row gutter={16} align="stretch">
              <Col span={12}>
                <div
                  style={{
                    background: '#fafafa',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('1')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '1']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '1'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      BTC 方向过滤通过
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('2')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '2']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '2'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      关键位已标记，价格触及关键位
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('3')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '3']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '3'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      出现合格的确认 K 线
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('4')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '4']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '4'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      24h 成交量 ≥ 200 万 USDT
                    </Checkbox>
                  </div>
                </div>
              </Col>
              <Col span={12}>
                <div
                  style={{
                    background: '#fafafa',
                    padding: 10,
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('5')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '5']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '5'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      止损已确定，止损单将同时挂出
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('6')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '6']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '6'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      仓位大小由计算器确定
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('7')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '7']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '7'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      同时持仓不超过 3 个
                    </Checkbox>
                  </div>
                  <div style={{ minHeight: 20, display: 'flex', alignItems: 'flex-start' }}>
                    <Checkbox
                      checked={checkedItems.includes('8')}
                      onChange={e => {
                        if (e.target.checked) {
                          setCheckedItems([...checkedItems, '8']);
                        } else {
                          setCheckedItems(checkedItems.filter(item => item !== '8'));
                        }
                      }}
                      style={{ fontSize: 12 }}
                    >
                      未触发熔断线
                    </Checkbox>
                  </div>
                </div>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default PositionCalculator;
