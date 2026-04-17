import React, { useEffect } from 'react';
import { Layout, Menu } from 'antd';
import { navigate } from 'gatsby';

const { Content } = Layout;

const QuickCalc = ({ children, location }) => {
  // 当访问 /quick-calc 时，自动导航到 /quick-calc/trade-record
  useEffect(() => {
    const pathname = location?.pathname || '';
    if (pathname === '/quick-calc' || pathname === '/quick-calc/') {
      navigate('/quick-calc/trade-record');
    }
  }, [location]);
  const menuItems = [
    { key: '/quick-calc/trade-record', label: '交易记录' },
    // { key: '/quick-calc/pattern', label: '模式' },
    { key: '/quick-calc/system_1', label: '放量冲关缩量滞涨' },
    { key: '/quick-calc/system_2', label: '开多探索' },
    // { key: '/quick-calc/kang-dan', label: '扛单分析' },
    { key: '/quick-calc/bitget-monitor', label: '币对筛选' },
  ];

  const currentPath = location?.pathname || '/quick-calc/trade-record';
  const cleanPath = currentPath.split('?')[0];

  const getSelectedKey = () => {
    const routes = [
      '/quick-calc/trade-record',
      '/quick-calc/pattern',
      '/quick-calc/kang-dan',
      '/quick-calc/bitget-monitor',
      '/quick-calc/system_1',
      '/quick-calc/system_2',
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
