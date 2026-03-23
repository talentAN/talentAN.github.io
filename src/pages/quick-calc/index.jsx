import React, { useState } from 'react';
import { Layout, Tabs, Typography, Card } from 'antd';
import LiquidationCalculator from './tabs/LiquidationCalculator';
import TradeRecord from './tabs/TradeRecord';
import BitgetMonitor from './tabs/BitgetMonitor';
import Calculator4 from './tabs/Calculator4';
import WatchList from './tabs/WatchList';
import PatternList from './tabs/PatternList';

const { Title, Text } = Typography;

const QuickCalc = () => {
  const [activeKey, setActiveKey] = useState('2');
  const [bitgetMode, setBitgetMode] = useState('stable');

  const items = [
    {
      key: '1',
      label: '预估爆仓价',
      children: <LiquidationCalculator />,
    },
    {
      key: '2',
      label: '交易复盘',
      children: <TradeRecord />,
    },
    {
      key: '3',
      label: '模式',
      children: <PatternList onPatternMatch={(mode) => {
        setBitgetMode(mode);
        setActiveKey('6');
      }} />,
    },
    {
      key: '4',
      label: '扛单分析',
      children: <Calculator4 />,
    },
    {
      key: '5',
      label: '观测中',
      children: <WatchList />,
    },
    {
      key: '6',
      label: '币对筛选',
      children: <BitgetMonitor mode={bitgetMode} />,
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
        <Tabs items={items} activeKey={activeKey} onChange={setActiveKey} />
      </Layout>
    </Layout>
  );
};

export default QuickCalc;
