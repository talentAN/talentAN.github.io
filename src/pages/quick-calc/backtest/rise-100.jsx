import React from 'react';
import Layout from '../index';
import Backtest from '../tabs/backtest/Backtest';

const BacktestRise100Page = ({ location }) => (
  <Layout location={location}>
    <Backtest location={location} />
  </Layout>
);

export default BacktestRise100Page;