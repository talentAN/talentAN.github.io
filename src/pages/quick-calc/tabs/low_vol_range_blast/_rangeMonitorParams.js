/** 横盘监控：是否启用自动扫描并挂开仓委托。 */
export const RANGE_MONITOR_SCAN_ENABLED = true;
/** 横盘监控：最高价达到开仓价的 1.2 倍后，武装开仓价全仓止损。 */
export const RANGE_MONITOR_SL_ARM_MULT = 1.2;
/** 横盘监控：最高价达到开仓价的 1.4 倍后，允许挂追踪止盈。 */
export const RANGE_MONITOR_TRAIL_ARM_MULT = 1.4;
/** 横盘监控：固定止盈档位；按最高价区间选择触发倍数。 */
export const RANGE_MONITOR_TP_MULTS = [
  // 最高价涨幅达到 20% 前，固定止盈触发价为开仓价的 1.2 倍。
  { key: 'tp120', mult: 1.2, gainPct: 20 },
  // 最高价涨幅达到 20% 至 50% 前，固定止盈触发价为开仓价的 1.5 倍。
  { key: 'tp150', mult: 1.5, gainPct: 50 },
  // 最高价涨幅达到 50% 至 100% 前，固定止盈触发价为开仓价的 2 倍。
  { key: 'tp200', mult: 2.0, gainPct: 100 },
];
/** 横盘监控：每个固定止盈档默认平掉当前持仓的 10%。 */
export const RANGE_MONITOR_TP_CLOSE_PCT = 0.1;
/** 横盘监控：追踪止盈回撤比例；传给交易所前需遵守交易所上限。 */
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
  // 监控运行状态。
  running: 'range-monitor-running',
  // 高低比上限。
  maxMult: 'range-monitor-max-mult',
  // 距上沿近带百分比。
  nearBandPct: 'range-monitor-near-band-pct',
  // 已成功下过的固定止盈档位。
  tpOrderTiers: 'range-monitor-tp-order-tiers',
});
