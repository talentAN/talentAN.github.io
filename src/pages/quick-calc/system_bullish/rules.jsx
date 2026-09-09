import React from 'react';
import Layout from '../index';
import SystemBullish from '../tabs/system_bullish/SystemBullish';

const SystemBullishTabPage = ({ location }) => (
  <Layout location={location}>
    <SystemBullish location={location} />
  </Layout>
);

export default SystemBullishTabPage;
