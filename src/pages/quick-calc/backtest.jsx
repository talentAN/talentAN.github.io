import React from 'react';
import Layout from './index';
import Backtest from './tabs/backtest/Backtest';

const BacktestPage = ({ location }) => (
  <Layout location={location}>
    <Backtest />
  </Layout>
);

export default BacktestPage;
