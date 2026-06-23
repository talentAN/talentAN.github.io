import React from 'react';
import Layout from '../index';
import System2 from '../tabs/system_2/System2';

const WatchingPage = ({ location }) => (
  <Layout location={location}>
    <System2 location={location} />
  </Layout>
);

export default WatchingPage;
