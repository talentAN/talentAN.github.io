import React from 'react';
import SurgeAlert from './SurgeAlert';
import TakeProfitCalculator from './TakeProfitCalculator';

/**
 * 嵌在行情条右侧；由 PriceTickerBanner（wrapPageElement）挂载，
 * 切 /quick-calc 子路由时保持挂载，暴涨轮询 / 止盈状态不丢。
 */
const QuickCalcToolDock = () => (
  <div className="quick-calc-tool-dock" aria-label="快捷工具">
    <SurgeAlert docked />
    <TakeProfitCalculator docked />
  </div>
);

export default QuickCalcToolDock;
