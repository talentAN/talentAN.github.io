import React from 'react';
import Layout from '../index';
import System1 from '../tabs/system_1/System1';

const PositionCalculatorPage = ({ location }) => {
  return (
    <Layout location={location}>
      <System1 location={location} />
    </Layout>
  );
};

export default PositionCalculatorPage;
