import React from 'react';
import Layout from '../index';
import Backtest from '../tabs/backtest/Backtest';

const BacktestAfter100GainPage = ({ location }) => (
  <Layout location={location}>
    <Backtest location={location} />
  </Layout>
);

export default BacktestAfter100GainPage;
