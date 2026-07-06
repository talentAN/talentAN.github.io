import React, { useEffect } from 'react';
import { Card, Menu } from 'antd';
import { navigate } from 'gatsby';
import Rule from './Rule';
import TradingDiscipline from './TradingDiscipline';
import PairSelector from './PairSelector';
import WatchList from './WatchList';
import Retrospective from './retrospective';
import Simulate from './Simulate';
import SimulateRetrospective from './SimulateRetrospective';
import DeathMechanism from './DeathMechanism';
import MilestoneWarning from './MilestoneWarning';

const SYSTEM1_BASE_PATH = '/quick-calc/system_1';
const SYSTEM1_PATHS = {
  rule: `${SYSTEM1_BASE_PATH}/rule`,
  tradingDiscipline: `${SYSTEM1_BASE_PATH}/trading-discipline`,
  pairSelector: `${SYSTEM1_BASE_PATH}/pair-selector`,
  retrospective: `${SYSTEM1_BASE_PATH}/retrospective`,
  milestoneWarning: `${SYSTEM1_BASE_PATH}/milestone-warning`,
  deathMechanism: `${SYSTEM1_BASE_PATH}/death-mechanism`,
  watching: `${SYSTEM1_BASE_PATH}/watching`,
  simulate: `${SYSTEM1_BASE_PATH}/simulate`,
  simulateRetrospective: `${SYSTEM1_BASE_PATH}/simulate-retrospective`,
};

const System1 = ({ location }) => {
  const menuItems = [
    { key: SYSTEM1_PATHS.rule, label: '风控规则（数字）' },
    { key: SYSTEM1_PATHS.tradingDiscipline, label: '交易纪律（行为）' },
    { key: SYSTEM1_PATHS.pairSelector, label: '币对筛选' },
    // { key: SYSTEM1_PATHS.watching, label: '观测中' },
    { key: SYSTEM1_PATHS.retrospective, label: '复盘' },
    // { key: SYSTEM1_PATHS.simulate, label: '模拟' },
    // { key: SYSTEM1_PATHS.simulateRetrospective, label: '模拟盘复盘' },
    { key: SYSTEM1_PATHS.milestoneWarning, label: '阶段预警' },
    { key: SYSTEM1_PATHS.deathMechanism, label: '系统死亡机制' },
  ];

  const cleanPath = (location?.pathname || SYSTEM1_PATHS.pairSelector).split('?')[0];
  const currentPath = cleanPath;

  const pathOrder = [
    SYSTEM1_PATHS.simulateRetrospective,
    SYSTEM1_PATHS.simulate,
    SYSTEM1_PATHS.retrospective,
    SYSTEM1_PATHS.pairSelector,
    SYSTEM1_PATHS.watching,
    SYSTEM1_PATHS.tradingDiscipline,
    SYSTEM1_PATHS.rule,
    SYSTEM1_PATHS.milestoneWarning,
    SYSTEM1_PATHS.deathMechanism,
  ];

  const selectedKey =
    pathOrder.find(path => currentPath.startsWith(path)) || SYSTEM1_PATHS.pairSelector;

  const matchesPath = path => currentPath === path || currentPath.startsWith(`${path}/`);

  const showRule = matchesPath(SYSTEM1_PATHS.rule);
  const showTradingDiscipline = matchesPath(SYSTEM1_PATHS.tradingDiscipline);
  const showWatchList = matchesPath(SYSTEM1_PATHS.watching);
  const showRetrospective = matchesPath(SYSTEM1_PATHS.retrospective);
  const showSimulateRetrospective = matchesPath(SYSTEM1_PATHS.simulateRetrospective);
  const showSimulate = !showSimulateRetrospective && matchesPath(SYSTEM1_PATHS.simulate);
  const showMilestoneWarning = matchesPath(SYSTEM1_PATHS.milestoneWarning);
  const showDeathMechanism = matchesPath(SYSTEM1_PATHS.deathMechanism);
  const showPairSelector = matchesPath(SYSTEM1_PATHS.pairSelector);
  const showDefaultPairSelector =
    showPairSelector || cleanPath === SYSTEM1_BASE_PATH || cleanPath === `${SYSTEM1_BASE_PATH}/`;

  useEffect(() => {
    if (cleanPath === SYSTEM1_BASE_PATH || cleanPath === `${SYSTEM1_BASE_PATH}/`) {
      navigate(SYSTEM1_PATHS.pairSelector);
    }
  }, [cleanPath]);

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
      {showDefaultPairSelector && <PairSelector />}
      {showWatchList && <WatchList />}
      {showRetrospective && <Retrospective />}
      {showSimulate && <Simulate />}
      {showSimulateRetrospective && <SimulateRetrospective />}
      {showMilestoneWarning && <MilestoneWarning />}
      {showDeathMechanism && <DeathMechanism />}
    </Card>
  );
};

export default System1;
