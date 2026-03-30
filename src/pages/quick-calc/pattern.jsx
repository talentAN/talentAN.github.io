import React from 'react';
import QuickCalc from './index';
import PatternList from './tabs/PatternList';

const PatternPage = ({ location }) => {
  const handlePatternMatch = (mode) => {
    if (typeof window !== 'undefined') {
      window.location.href = `/quick-calc/bitget-monitor?mode=${mode}`;
    }
  };

  return (
    <QuickCalc location={location}>
      <PatternList onPatternMatch={handlePatternMatch} />
    </QuickCalc>
  );
};

export default PatternPage;
