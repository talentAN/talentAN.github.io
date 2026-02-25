import React, { useState } from 'react';
import { Layout, Card, Tabs, Form, InputNumber, Radio, Button, Typography, Space } from 'antd';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import SEO from '../../components/Seo';

const { Title, Text } = Typography;

const QuickCalc = () => {
  const [liquidationPrice, setLiquidationPrice] = useState(null);

  const calculateLiquidationPrice = (values) => {
    const { openPrice, leverage, direction, initialMargin, additionalMargin = 0, feeRate = 0.0006 } = values;
    const totalMargin = initialMargin + additionalMargin;
    
    // 逐仓爆仓价计算公式（考虑保证金和手续费）
    // 持仓数量 = 初始保证金 × 杠杆 / 开仓价
    // 做多: 爆仓价 = (持仓数量 × 开仓价 - 总保证金 + 手续费) / 持仓数量
    //            = 开仓价 - 总保证金/持仓数量 + 手续费/持仓数量
    //            = 开仓价 × (1 - 总保证金/(初始保证金×杠杆) + 手续费率)
    // 做空: 爆仓价 = (持仓数量 × 开仓价 + 总保证金 - 手续费) / 持仓数量
    //            = 开仓价 + 总保证金/持仓数量 - 手续费/持仓数量
    //            = 开仓价 × (1 + 总保证金/(初始保证金×杠杆) - 手续费率)
    
    const positionSize = initialMargin * leverage / openPrice; // 持仓数量
    const totalFee = positionSize * openPrice * feeRate * 2; // 开仓+平仓手续费
    
    let price;
    if (direction === 1) {
      // 做多：价格下跌到一定程度爆仓
      price = (positionSize * openPrice - totalMargin + totalFee) / positionSize;
    } else {
      // 做空：价格上涨到一定程度爆仓
      price = (positionSize * openPrice + totalMargin - totalFee) / positionSize;
    }
    
    setLiquidationPrice(price.toFixed(2));
  };

  const items = [
    {
      key: '1',
      label: '逐仓保证金 => 爆仓价',
      children: (
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
      ),
    },
    {
      key: '2',
      label: '计算器2',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '3',
      label: '计算器3',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '4',
      label: '计算器4',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '5',
      label: '计算器5',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '6',
      label: '计算器6',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '7',
      label: '计算器7',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '8',
      label: '计算器8',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '9',
      label: '计算器9',
      children: <Card>功能开发中...</Card>,
    },
    {
      key: '10',
      label: '计算器10',
      children: <Card>功能开发中...</Card>,
    },
  ];

  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <SEO title="快速计算" path="quick-calc" />
        <Header />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <Title level={2}>快速计算</Title>
            <Tabs items={items} />
          </div>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export default QuickCalc;
