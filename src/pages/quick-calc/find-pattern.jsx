import React from 'react';
import QuickCalc from './index';
import FindPattern from './tabs/FindPattern';

const FindPatternPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <FindPattern />
    </QuickCalc>
  );
};

export default FindPatternPage;
