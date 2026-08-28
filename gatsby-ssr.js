import React from 'react';
import { MarketProvider } from './src/container/market/MarketContext';
import SurgeAlert from './src/pages/quick-calc/tabs/system_1/SurgeAlert';
import TakeProfitCalculator from './src/pages/quick-calc/tabs/system_1/TakeProfitCalculator';
import High100FlowMap from './src/pages/quick-calc/tabs/system_1/High100FlowMap';

const SYSTEM1_BASE_PATH = '/quick-calc/system_1';

export const wrapRootElement = ({ element }) => {
  return <MarketProvider>{element}</MarketProvider>;
};

// 需要跟 gatsby-browser.js 的 wrapPageElement 保持一致，否则 SSR 输出与客户端
// 首次渲染不一致会触发 hydration mismatch。
export const wrapPageElement = ({ element, props }) => {
  const pathname = props?.location?.pathname || '';
  const showSurgeAlert = pathname.startsWith(SYSTEM1_BASE_PATH);
  return (
    <>
      {showSurgeAlert && <SurgeAlert />}
      {showSurgeAlert && <TakeProfitCalculator />}
      {showSurgeAlert && <High100FlowMap />}
      {element}
    </>
  );
};
