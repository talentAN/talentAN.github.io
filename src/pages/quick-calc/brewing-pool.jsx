import React from 'react';
import QuickCalc from './index';
import FindPattern from './tabs/FindPattern';

const BrewingPoolPage = ({ location }) => (
  <QuickCalc location={location}>
    <FindPattern />
  </QuickCalc>
);

export default BrewingPoolPage;
