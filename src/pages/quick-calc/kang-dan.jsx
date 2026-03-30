import React from 'react';
import QuickCalc from './index';
import Calculator4 from './tabs/Calculator4';

const KangDanPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <Calculator4 />
    </QuickCalc>
  );
};

export default KangDanPage;
