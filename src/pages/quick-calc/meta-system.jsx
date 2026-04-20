import React from 'react';
import QuickCalc from './index';
import MetaSystem from './tabs/MetaSystem';

const PairSelectorPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <MetaSystem />
    </QuickCalc>
  );
};

export default PairSelectorPage;
