import React from 'react';
import { Layout, Menu } from 'antd';
import { navigate } from 'gatsby';

const { Content } = Layout;

const QuickCalc = ({ children, location }) => {
  const menuItems = [
    { key: '/quick-calc/trade-record', label: '交易记录' },
    { key: '/quick-calc/pattern', label: '模式' },
    { key: '/quick-calc/kang-dan', label: '扛单分析' },
    { key: '/quick-calc/watch-list', label: '观测中' },
    { key: '/quick-calc/bitget-monitor', label: '币对筛选' },
    { key: '/quick-calc/liquidation', label: '预估爆仓价' },
    { key: '/quick-calc/system_1', label: '系统1' },
  ];

  const currentPath = location?.pathname || '/quick-calc/trade-record';
  const cleanPath = currentPath.split('?')[0];

  const getSelectedKey = () => {
    const routes = [
      '/quick-calc/trade-record',
      '/quick-calc/pattern',
      '/quick-calc/kang-dan',
      '/quick-calc/watch-list',
      '/quick-calc/bitget-monitor',
      '/quick-calc/liquidation',
      '/quick-calc/system_1',
    ];
    
    for (const route of routes) {
      if (cleanPath.startsWith(route)) {
        return route;
      }
    }
    
    return '/quick-calc/trade-record';
  };

  const selectedKey = getSelectedKey();

  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <Menu
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginBottom: 16 }}
        />
        <Content>{children}</Content>
      </Layout>
    </Layout>
  );
};

export default QuickCalc;
