import React from 'react';
import SurgeAlert from './SurgeAlert';
import TakeProfitCalculator from './TakeProfitCalculator';
import RangeMonitor from '../low_vol_range_blast/RangeMonitor';
import SocketLinkStatus from './SocketLinkStatus';

/**
 * 嵌在行情条右侧；由 PriceTickerBanner（wrapPageElement）挂载，
 * 切 /quick-calc 子路由时保持挂载，暴涨/横盘轮询与止盈状态不丢。
 *
 * 止盈计算器暂隐藏（代码保留）；改 true 即可重新挂上。
 */
const SHOW_TAKE_PROFIT_CALCULATOR = false;

const QuickCalcToolDock = () => (
  <div className="quick-calc-tool-dock" aria-label="快捷工具">
    <SocketLinkStatus />
    <SurgeAlert docked />
    <RangeMonitor docked />
    {SHOW_TAKE_PROFIT_CALCULATOR ? <TakeProfitCalculator docked /> : null}
  </div>
);

export default QuickCalcToolDock;
