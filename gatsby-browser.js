import React from 'react';
import { MarketProvider } from './src/container/market/MarketContext';
import SurgeAlert from './src/pages/quick-calc/tabs/system_1/SurgeAlert';
import TakeProfitCalculator from './src/pages/quick-calc/tabs/system_1/TakeProfitCalculator';
import High100FlowMap from './src/pages/quick-calc/tabs/system_1/High100FlowMap';

const SYSTEM1_BASE_PATH = '/quick-calc/system_1';

export const wrapRootElement = ({ element }) => {
  return <MarketProvider>{element}</MarketProvider>;
};

// 挂在 wrapPageElement 而不是具体页面组件内部，是因为「币对筛选」下的二级 tab
// 各自对应独立的 Gatsby 页面组件，切换时该组件会被整体卸载重建；wrapPageElement
// 包在页面组件外层且不随路径带 key，只要仍在 system_1 路径下，SurgeAlert 在树中的
// 位置和类型都不变，切 tab 不会重置它的轮询/命中状态。
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
