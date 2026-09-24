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

// 开发环境清掉旧 Service Worker / Cache，避免把 index.html 当成 JS/JSON 解析
// （典型报错：Unexpected token '<' / No codeFrame could be generated）
export const onClientEntry = () => {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof window === 'undefined') return;

  const clearDevCaches = async () => {
    let hadController = false;
    if ('serviceWorker' in navigator) {
      hadController = Boolean(navigator.serviceWorker.controller);
      const regs = await navigator.serviceWorker.getRegistrations();
      hadController = hadController || regs.length > 0;
      await Promise.all(regs.map(reg => reg.unregister().catch(() => {})));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key).catch(() => {})));
    }
    // 清掉控制页的 SW 后必须刷新一次，否则首屏仍可能吃到旧 HTML 响应
    if (hadController && !sessionStorage.getItem('__sw_cleared_once__')) {
      sessionStorage.setItem('__sw_cleared_once__', '1');
      window.location.reload();
    }
  };

  clearDevCaches().catch(() => {});
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
