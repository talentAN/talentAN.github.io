import React from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import Rule from './Rule';
import TradingDiscipline from './TradingDiscipline';
import PositionCalculator from './PositionCalculator';
import PairSelector from './PairSelector';
import WatchList from './WatchList';
import Retrospective from './Retrospective';

const System1 = ({ location }) => {
  const menuItems = [
    { key: '/quick-calc/system_1/rule', label: '风控规则（数字）' },
    { key: '/quick-calc/system_1/trading-discipline', label: '交易纪律（行为）' },
    { key: '/quick-calc/system_1/pair-selector', label: '币对筛选' },
    { key: '/quick-calc/system_1/watching', label: '观测中' },
    { key: '/quick-calc/system_1/position-calculator', label: '仓位计算器' },
    { key: '/quick-calc/system_1/retrospective', label: '复盘' },
  ];

  const currentPath = location?.pathname || '/quick-calc/system_1/watching';
  const cleanPath = currentPath.split('?')[0];

  const selectedKey = cleanPath.startsWith('/quick-calc/system_1/retrospective')
    ? '/quick-calc/system_1/retrospective'
    : cleanPath.startsWith('/quick-calc/system_1/position-calculator')
      ? '/quick-calc/system_1/position-calculator'
      : cleanPath.startsWith('/quick-calc/system_1/pair-selector')
        ? '/quick-calc/system_1/pair-selector'
        : cleanPath.startsWith('/quick-calc/system_1/watching')
          ? '/quick-calc/system_1/watching'
          : cleanPath.startsWith('/quick-calc/system_1/trading-discipline')
            ? '/quick-calc/system_1/trading-discipline'
            : cleanPath.startsWith('/quick-calc/system_1/rule')
              ? '/quick-calc/system_1/rule'
              : '/quick-calc/system_1/watching';

  const showRule = currentPath.includes('/system_1/rule');
  const showTradingDiscipline = currentPath.includes('/system_1/trading-discipline');
  const showPositionCalculator = currentPath.includes('/system_1/position-calculator');
  const showWatchList = currentPath.includes('/system_1/watching');
  const showRetrospective = currentPath.includes('/system_1/retrospective');
  const showPairSelector = currentPath.includes('/system_1/pair-selector');
  const showDefaultWatchList = showWatchList;
  currentPath === '/quick-calc/system_1' || currentPath === '/quick-calc/system_1/';

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
      {showTradingDiscipline && <TradingDiscipline />}
      {showPositionCalculator && <PositionCalculator />}
      {showPairSelector && <PairSelector />}
      {showDefaultWatchList && <WatchList />}
      {showRetrospective && <Retrospective />}
    </Card>
  );
};

export default System1;
