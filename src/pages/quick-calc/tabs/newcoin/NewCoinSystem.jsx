import React from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import WatchList from './WatchList';
import PairSelector from './PairSelector';

const NewCoinSystem = ({ location }) => {
  const menuItems = [
    { key: '/quick-calc/newcoin/pair-selector', label: '币对筛选' },
    { key: '/quick-calc/newcoin/watching', label: '观测中' },
  ];

  const currentPath = location?.pathname || '/quick-calc/newcoin/watching';
  const cleanPath = currentPath.split('?')[0];

  const selectedKey = cleanPath.startsWith('/quick-calc/newcoin/pair-selector')
    ? '/quick-calc/newcoin/pair-selector'
    : '/quick-calc/newcoin/watching';

  const showPairSelector = currentPath.includes('/newcoin/pair-selector');
  const showWatchList = !showPairSelector;

  return (
    <Card>
      <Menu
        mode="horizontal"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ marginBottom: 16 }}
      />
      {showPairSelector && <PairSelector />}
      {showWatchList && <WatchList />}
    </Card>
  );
};

export default NewCoinSystem;
