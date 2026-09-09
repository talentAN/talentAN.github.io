import React, { useEffect, useMemo } from 'react';
import { Layout, Menu } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { navigate } from 'gatsby';
import './quickCalc.less';

const { Content } = Layout;

const MORE_KEY = '__more__';

const PRIMARY_ITEMS = [
  { key: '/quick-calc/trade-record', label: '合约交易记录' },
  { key: '/quick-calc/system_1', label: '系统-放量冲关缩量滞涨' },
  { key: '/quick-calc/system_bullish', label: '系统-横盘抬头' },
  { key: '/quick-calc/backtest', label: '回测' },
];

const MORE_ITEMS = [
  { key: '/quick-calc/spot-record', label: '现货统计' },
  { key: '/quick-calc/key-log', label: '关键日志' },
  { key: '/quick-calc/meta-system', label: '系统-meta' },
  { key: '/quick-calc/system_2', label: '系统-低量高低点抬升' },
];

const ROUTE_PRIORITY = [
  '/quick-calc/spot-record',
  '/quick-calc/trade-record',
  '/quick-calc/key-log',
  '/quick-calc/pattern',
  '/quick-calc/kang-dan',
  '/quick-calc/bitget-monitor',
  '/quick-calc/find-pattern',
  '/quick-calc/newcoin-breakout',
  '/quick-calc/meta-system',
  '/quick-calc/system_1',
  '/quick-calc/system_bullish',
  '/quick-calc/newcoin',
  '/quick-calc/system_2',
  '/quick-calc/backtest',
];

const QuickCalc = ({ children, location }) => {
  useEffect(() => {
    const pathname = location?.pathname || '';
    if (pathname === '/quick-calc' || pathname === '/quick-calc/') {
      navigate('/quick-calc/trade-record');
    }
  }, [location]);

  const cleanPath = (location?.pathname || '/quick-calc/trade-record').split('?')[0];

  const selectedKey = useMemo(() => {
    for (const route of ROUTE_PRIORITY) {
      if (cleanPath.startsWith(route)) return route;
    }
    return '/quick-calc/trade-record';
  }, [cleanPath]);

  const moreActive = MORE_ITEMS.find(item => selectedKey === item.key || selectedKey.startsWith(`${item.key}/`));

  const menuItems = useMemo(
    () => [
      ...PRIMARY_ITEMS,
      {
        key: MORE_KEY,
        label: (
          <span className="quick-calc-more-label">
            {moreActive ? moreActive.label : '更多'}
            <DownOutlined style={{ fontSize: 10, marginLeft: 4 }} />
          </span>
        ),
        children: MORE_ITEMS.map(item => ({
          key: item.key,
          label: item.label,
        })),
      },
    ],
    [moreActive]
  );

  return (
    <Layout className="quick-calc-layout">
      <Layout className="quick-calc-container">
        <Menu
          className="quick-calc-menu"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          triggerSubMenuAction="click"
          onClick={({ key }) => {
            if (key === MORE_KEY) return;
            navigate(key);
          }}
          style={{ marginBottom: 8 }}
        />
        <Content>{children}</Content>
      </Layout>
    </Layout>
  );
};

export default QuickCalc;
