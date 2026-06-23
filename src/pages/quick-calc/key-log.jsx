import React from 'react';
import QuickCalc from './index';
import KeyLog from './tabs/KeyLog';

const KeyLogPage = ({ location }) => (
  <QuickCalc location={location}>
    <KeyLog />
  </QuickCalc>
);

export default KeyLogPage;
