import React, { useState } from 'react';
import { Card, Form, InputNumber, Radio, Button, Typography, Space } from 'antd';

const { Title, Text } = Typography;

const LiquidationCalculator = () => {
  const [liquidationPrice, setLiquidationPrice] = useState(null);

  const calculateLiquidationPrice = (values) => {
    const { openPrice, leverage, direction, initialMargin, additionalMargin = 0, feeRate = 0.0006 } = values;
    const totalMargin = initialMargin + additionalMargin;
    
    const positionSize = initialMargin * leverage / openPrice;
    const totalFee = positionSize * openPrice * feeRate * 2;
    
    let price;
    if (direction === 1) {
      price = (positionSize * openPrice - totalMargin + totalFee) / positionSize;
    } else {
      price = (positionSize * openPrice + totalMargin - totalFee) / positionSize;
    }
    
    setLiquidationPrice(price.toFixed(2));
  };

  return (
    <Card>
      <Form
        layout="vertical"
        onFinish={calculateLiquidationPrice}
        initialValues={{
          leverage: 5,
          direction: -1,
          initialMargin: 10,
          additionalMargin: 0,
          feeRate: 0.0006,
        }}
      >
        <Form.Item
          label="开仓价"
          name="openPrice"
          rules={[{ required: true, message: '请输入开仓价' }]}
        >
          <InputNumber style={{ width: '100%' }} placeholder="请输入开仓价" />
        </Form.Item>

        <Form.Item label="开仓杠杆" name="leverage">
          <InputNumber style={{ width: '100%' }} min={1} max={125} />
        </Form.Item>

        <Form.Item label="开仓方向" name="direction">
          <Radio.Group>
            <Radio value={1}>做多</Radio>
            <Radio value={-1}>做空</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item label="初始保证金" name="initialMargin">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>

        <Form.Item label="追加保证金" name="additionalMargin">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>

        <Form.Item label="手续费率" name="feeRate">
          <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001} />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            计算爆仓价
          </Button>
        </Form.Item>

        {liquidationPrice && (
          <Space direction="vertical" style={{ marginTop: 16 }}>
            <Text strong>爆仓价格：</Text>
            <Title level={3} type="danger">
              {liquidationPrice}
            </Title>
          </Space>
        )}
      </Form>
    </Card>
  );
};

export default LiquidationCalculator;
