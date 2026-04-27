import React from 'react';
import Layout from '../index';
import NewCoinSystem from '../tabs/newcoin/NewCoinSystem';

const NewCoinPairSelectorPage = ({ location }) => {
  return (
    <Layout location={location}>
      <NewCoinSystem location={location} />
    </Layout>
  );
};

export default NewCoinPairSelectorPage;
