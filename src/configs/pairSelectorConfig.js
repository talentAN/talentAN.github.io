// 币对筛选配置
// 此文件包含币对筛选逻辑的所有可配置参数

export const SPIKE_FILTER_CONFIG = {
  // 检查价格暴涨的过去天数
  days: 4,
  // 最低日涨幅百分比阈值 (0.3 = 30%)
  riseThreshold: 0.3,
  // 暴涨检测的K线粒度
  granularity: '1Dutc',
  // 获取的K线数据点数量
  limit: 5,
};

export const MARKET_DATA_CONFIG = {
  // BTC/ETH市场数据的过去天数（需要覆盖最长展示周期）
  days: 60,
  // 市场数据的K线粒度
  granularity: '1D',
  // 市场数据点数量
  limit: 20,
  // 市场统计显示周期（天数）
  displayPeriods: [7, 15, 45],
};

export const UI_CONFIG = {
  // 标题文本参数
  spikeTitleDays: 3, // 暴涨筛选标题中提到的天数（用于显示）
  spikeTitleThreshold: 30, // 标题中提到的阈值百分比（用于显示）
};
