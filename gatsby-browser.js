import React from 'react';
import { MarketProvider } from './src/container/market/MarketContext';

export const wrapRootElement = ({ element }) => {
  return <MarketProvider>{element}</MarketProvider>;
};
