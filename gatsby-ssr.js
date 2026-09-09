import React from 'react';
import { MarketProvider } from './src/container/market/MarketContext';
import PriceTickerBanner from './src/pages/quick-calc/tabs/system_1/PriceTickerBanner';
import High100FlowMap from './src/pages/quick-calc/tabs/system_1/High100FlowMap';
import './src/pages/quick-calc/quickCalc.less';

const QUICK_CALC_BASE_PATH = '/quick-calc';
const SYSTEM1_BASE_PATH = '/quick-calc/system_1';

export const wrapRootElement = ({ element }) => {
  return <MarketProvider>{element}</MarketProvider>;
};

export const wrapPageElement = ({ element, props }) => {
  const pathname = props?.location?.pathname || '';
  const showQuickCalc = pathname.startsWith(QUICK_CALC_BASE_PATH);
  const showSystem1 = pathname.startsWith(SYSTEM1_BASE_PATH);
  return (
    <>
      {showQuickCalc && <PriceTickerBanner />}
      {showSystem1 && <High100FlowMap />}
      {element}
    </>
  );
};
