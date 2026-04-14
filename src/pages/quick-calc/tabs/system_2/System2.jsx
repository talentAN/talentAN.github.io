import React from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import Rule from './Rule';

const System2 = ({ location }) => {
  const menuItems = [{ key: '/quick-calc/system_2/rule', label: '风控规则' }];

  const currentPath = location?.pathname || '/quick-calc/system_2/rule';
  const cleanPath = currentPath.split('?')[0];

  const selectedKey = '/quick-calc/system_2/rule';

  const showRule =
    currentPath.includes('/system_2/rule') ||
    currentPath === '/quick-calc/system_2' ||
    currentPath === '/quick-calc/system_2/';

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
    </Card>
  );
};

export default System2;
