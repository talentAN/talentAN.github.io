import React from 'react';
import QuickCalc from './index';
import LiquidationCalculator from './tabs/LiquidationCalculator';

const LiquidationPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <LiquidationCalculator />
    </QuickCalc>
  );
};

export default LiquidationPage;
