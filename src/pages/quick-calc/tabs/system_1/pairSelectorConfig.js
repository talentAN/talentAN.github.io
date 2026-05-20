/**
 * 币对筛选器 — 关键参数配置
 * 调参时只需改这里，无需改逻辑代码。
 */

/** 模式一：过去 N 天暴涨 */
export const SPIKE_CONFIG = {
  /** 观察窗口（天）：在过去多少天内寻找暴涨 K */
  windowDays: 4,
  /** 单日涨幅阈值（相对开盘价），超过此值视为"暴涨" */
  riseRatio: 0.3, // 30%
};

/** 模式二：90 天内暴涨仍高位 */
export const HOLD_CONFIG = {
  /** K 线拉取根数（≤90，受 Bitget 接口 90 天区间限制） */
  klineLimit: 90,
  /** 单日涨幅阈值（相对开盘价），超过此值视为"暴涨" */
  riseRatio: 0.3, // 30%
  /**
   * 高位保留阈值：当前价或昨日最高价 ≥ 基准价(a) × 此值 才入选
   * 基准价(a) = 暴涨日收盘价，若后续有更高收盘则上调为最高收盘价
   */
  priceRatio: 0.95, // 95%
};

/** 市场行情卡片（BTC / ETH 涨跌幅） */
export const MARKET_CONFIG = {
  /** 拉取历史 K 线天数 */
  klineDays: 20,
  /** 展示的涨跌幅周期（天） */
  periods: [3, 7, 15],
};

/** 表格"当前/基准"比值颜色阈值（单位：%） */
export const RATIO_COLOR = {
  green: 100, // ≥ 此值显示绿色
  orange: 90, // ≥ 此值显示橙色（< green 时）
};
