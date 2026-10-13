/** 横盘监控：是否启用自动扫描并挂开仓委托。 */
export const RANGE_MONITOR_SCAN_ENABLED = true;
/** 横盘监控：盈利达到 20% 后，武装开仓价全仓止损（多 1.2E / 空对称 0.8E）。 */
export const RANGE_MONITOR_SL_ARM_MULT = 1.2;

/**
 * 多仓固定止盈（保持原样）：
 * 1.2E / 1.5E / 2.0E，每档平 10%。
 */
export const RANGE_MONITOR_LONG_TP_MULTS = [
  { key: 'tp120', mult: 1.2, gainPct: 20, closePct: 0.1 },
  { key: 'tp150', mult: 1.5, gainPct: 50, closePct: 0.1 },
  { key: 'tp200', mult: 2.0, gainPct: 100, closePct: 0.1 },
];

/**
 * 空仓固定止盈（独立策略）：
 * - priceMult：触发价 = entry × priceMult
 * - mult：与 calcMoveRatio（2−xx/entry）对齐的阶段阈值
 * 一档 0.8E 平 25%；二档 0.7E 平 35%。
 */
export const RANGE_MONITOR_SHORT_TP_MULTS = [
  { key: 'stp80', mult: 1.2, priceMult: 0.8, gainPct: 20, closePct: 0.25 },
  { key: 'stp70', mult: 1.3, priceMult: 0.7, gainPct: 30, closePct: 0.35 },
];

/** @deprecated 等同多仓档位；请用 tpTiersForDirection / RANGE_MONITOR_LONG_TP_MULTS */
export const RANGE_MONITOR_TP_MULTS = RANGE_MONITOR_LONG_TP_MULTS;

/** 多仓：盈利 40%（xx ≥ 1.4E）后允许挂追踪止盈。 */
export const RANGE_MONITOR_LONG_TRAIL_ARM_MULT = 1.4;
/** 空仓：价格 ≤ 开仓价 × 0.75（盈利 25%）后允许挂追踪止盈。 */
export const RANGE_MONITOR_SHORT_TRAIL_ARM_PRICE_MULT = 0.75;
/** @deprecated 等同多仓追踪武装；请用 trail 方向专用常量 */
export const RANGE_MONITOR_TRAIL_ARM_MULT = RANGE_MONITOR_LONG_TRAIL_ARM_MULT;

/** 多仓档位默认平仓比例（兼容兜底）。 */
export const RANGE_MONITOR_TP_CLOSE_PCT = 0.1;
/** 横盘监控：追踪止盈回撤比例。 */
export const RANGE_MONITOR_TRAIL_CALLBACK_PCT = 12;
/** 横盘监控：每个持仓占用的开仓委托槽位数量。 */
export const RANGE_MONITOR_SLOT_PER_POSITION = 2;
/** 横盘监控：账户最多允许保留的开仓委托数量。 */
export const RANGE_MONITOR_MAX_ORDERS = 200;
/** 横盘监控：扫描币对之间的请求/处理间隔，单位毫秒。 */
export const RANGE_MONITOR_SCAN_GAP_MS = 280;
/** 横盘监控：使用日 K 缓存扫描时，每处理多少个币对让出一次事件循环。 */
export const RANGE_MONITOR_CACHED_SCAN_YIELD_EVERY = 40;
/** 横盘监控：连续挂单之间的间隔，单位毫秒。 */
export const RANGE_MONITOR_PLACE_GAP_MS = 400;
/** 横盘监控：一轮完成后到下一轮开始前的休息时间，单位毫秒。 */
export const RANGE_MONITOR_ROUND_IDLE_MS = 2 * 1000;
/** 横盘监控：开仓后最高价小时 K 查询失败时的最大重试次数。 */
export const RANGE_MONITOR_XX_KLINE_RETRY = 3;
/** 横盘监控：小时 K 的时间单位，当前为 1 小时。 */
export const RANGE_MONITOR_XX_HOUR_MS = 3600 * 1000;
/** 横盘监控：开仓后最高价小时 K 缓存有效期，单位毫秒。 */
export const RANGE_MONITOR_XX_KLINE_CACHE_TTL_MS = 60 * 1000;
/** 横盘监控：单次小时 K 请求最多拉取的 K 线数量。 */
export const RANGE_MONITOR_XX_HOUR_LIMIT = 1500;
/** 横盘监控：扫描候选允许的最高高低比上限，UI 参数只能在此范围内调整。 */
export const RANGE_MONITOR_SCAN_MAX_RANGE_MULT = 2;

/** 横盘监控 localStorage key，统一集中维护。 */
export const RANGE_MONITOR_STORAGE_KEYS = Object.freeze({
  running: 'range-monitor-running',
  maxMult: 'range-monitor-max-mult',
  nearBandPct: 'range-monitor-near-band-pct',
  tpOrderTiers: 'range-monitor-tp-order-tiers',
});