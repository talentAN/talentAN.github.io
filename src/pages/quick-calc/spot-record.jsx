import React from 'react';
import QuickCalc from './index';
import SpotRecord from './tabs/SpotRecord';

const SpotRecordPage = ({ location }) => (
  <QuickCalc location={location}>
    <SpotRecord />
  </QuickCalc>
);

export default SpotRecordPage;
