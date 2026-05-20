import React from 'react';
import QuickCalc from './index';
import NewcoinBreakout from './tabs/NewcoinBreakout';

const NewcoinBreakoutPage = ({ location }) => (
  <QuickCalc location={location}>
    <NewcoinBreakout />
  </QuickCalc>
);

export default NewcoinBreakoutPage;
