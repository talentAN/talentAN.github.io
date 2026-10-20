import React from 'react';
import SurgeAlert from './SurgeAlert';
import RangeMonitor from '../low_vol_range_blast/RangeMonitor';
import SocketLinkStatus from './SocketLinkStatus';

/**
 * 嵌在行情条右侧；由 PriceTickerBanner（wrapPageElement）挂载，
 * 切 /quick-calc 子路由时保持挂载，暴涨/横盘轮询状态不丢。
 */
const QuickCalcToolDock = () => (
  <div className="quick-calc-tool-dock" aria-label="快捷工具">
    <SocketLinkStatus />
    <SurgeAlert docked />
    <RangeMonitor docked />
  </div>
);

export default QuickCalcToolDock;
