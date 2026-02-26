import React from 'react';
import { Layout, Tabs, Typography,Card } from 'antd';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import SEO from '../../components/Seo';
import LiquidationCalculator from './tabs/LiquidationCalculator';
import TradeRecord from './tabs/TradeRecord';
import BitgetMonitor from './tabs/BitgetMonitor';

const { Title, Text } = Typography;

const QuickCalc = () => {
  const items = [
    {
      key: '1',
      label: '逐仓保证金 => 爆仓价',
      children: <LiquidationCalculator />,
    },
    {
      key: '2',
      label: '交易记录',
      children: <TradeRecord />,
    },
    {
      key: '3',
      label: 'Bitget监控',
      children: <BitgetMonitor />,
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
          <div className="marginTopTitle">
            <Title level={2}>快速计算</Title>
            <Tabs items={items} defaultActiveKey="2" />
          </div>
      </Layout>
    </Layout>
  );
};

export default QuickCalc;
