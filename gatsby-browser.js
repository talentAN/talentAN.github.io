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

// 开发环境清掉旧 Service Worker，避免把 index.html 当成 JS/JSON 解析
export const onClientEntry = () => {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      reg.unregister().catch(() => {});
    });
  });
  if (typeof caches !== 'undefined') {
    caches.keys().then(keys => {
      keys.forEach(key => {
        caches.delete(key).catch(() => {});
      });
    });
  }
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
