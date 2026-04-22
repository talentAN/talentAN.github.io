import React from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import Rule from './Rule';
import Volatility from './Volatility';
import VolatilityCalc from './VolatilityCalc';

const System2 = ({ location }) => {
  const menuItems = [
    { key: '/quick-calc/system_2/rule', label: '第一性原理' },
    { key: '/quick-calc/system_2/volatility', label: '波动率' },
    { key: '/quick-calc/system_2/volatility-calc', label: '波动率计算' },
  ];

  const currentPath = location?.pathname || '/quick-calc/system_2/rule';
  const cleanPath = currentPath.split('?')[0];

  const selectedKey = cleanPath.startsWith('/quick-calc/system_2/volatility-calc')
    ? '/quick-calc/system_2/volatility-calc'
    : cleanPath.startsWith('/quick-calc/system_2/volatility')
    ? '/quick-calc/system_2/volatility'
    : '/quick-calc/system_2/rule';

  const showRule =
    currentPath.includes('/system_2/rule') ||
    currentPath === '/quick-calc/system_2' ||
    currentPath === '/quick-calc/system_2/';

  const showVolatility = currentPath.includes('/system_2/volatility') && !currentPath.includes('calc');
  const showVolatilityCalc = currentPath.includes('/system_2/volatility-calc');

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
      {showVolatility && <Volatility />}
      {showVolatilityCalc && <VolatilityCalc />}
    </Card>
  );
};

export default System2;
