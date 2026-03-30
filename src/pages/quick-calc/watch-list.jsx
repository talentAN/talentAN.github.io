import React from 'react';
import QuickCalc from './index';
import WatchList from './tabs/WatchList';

const WatchListPage = ({ location }) => {
  return (
    <QuickCalc location={location}>
      <WatchList />
    </QuickCalc>
  );
};

export default WatchListPage;
