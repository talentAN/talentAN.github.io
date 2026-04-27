import React from 'react';
import Layout from '../index';
import NewCoinSystem from '../tabs/newcoin/NewCoinSystem';

const NewCoinWatchingPage = ({ location }) => {
  return (
    <Layout location={location}>
      <NewCoinSystem location={location} />
    </Layout>
  );
};

export default NewCoinWatchingPage;
