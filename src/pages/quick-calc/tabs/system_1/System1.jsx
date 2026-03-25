import React from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import Rule from './Rule';
import PositionCalculator from './PositionCalculator';

const System1 = ({ location }) => {
  const menuItems = [
    { key: '/quick-calc/system_1/rule', label: '风控规则' },
    { key: '/quick-calc/system_1/position-calculator', label: '仓位计算器' },
  ];

  const currentPath = location?.pathname || '/quick-calc/system_1/rule';
  const selectedKey = currentPath.split('?')[0];

  const showRule = currentPath.includes('/system_1/rule') || currentPath === '/quick-calc/system_1' || currentPath === '/quick-calc/system_1/';
  const showPositionCalculator = currentPath.includes('/system_1/position-calculator');

  return (
    <Card>
      <Menu
        mode="horizontal"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ marginBottom: 16 }}
      />
      {showRule && <Rule />}
      {showPositionCalculator && <PositionCalculator />}
    </Card>
  );
};

export default System1;
