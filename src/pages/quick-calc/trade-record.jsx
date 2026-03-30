import React from 'react';
import QuickCalc from './index';
import TradeRecord from './tabs/TradeRecord';

const TradeRecordPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <TradeRecord />
    </QuickCalc>
  );
};

export default TradeRecordPage;
