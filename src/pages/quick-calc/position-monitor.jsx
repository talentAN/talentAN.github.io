import React from 'react';
import QuickCalc from './index';
import PositionMonitor from './tabs/PositionMonitor';

const PositionMonitorPage = ({ location }) => (
  <QuickCalc location={location}>
    <PositionMonitor />
  </QuickCalc>
);

export default PositionMonitorPage;
