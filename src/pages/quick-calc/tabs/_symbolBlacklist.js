/**
 * 全局交易黑名单：做多 / 做空实盘一律跳过。
 * - 稳定币 / 类稳定
 * - 贵金属 / 工业金属 / 能源（TradFi 商品）
 * - 指数合约
 */
export const SYMBOL_BLACKLIST = new Set([
  // 稳定币 / 类稳定
  'USDCUSDT',
  'USDGUSDT', // Global Dollar；口语里常被写成 USDGO
  'FDUSDUSDT',
  'TUSDUSDT',
  'DAIUSDT',
  'USDPUSDT',
  'USDEUSDT',
  'BFUSDUSDT',
  'USD1USDT',
  'FRAXUSDT',
  'USTCUSDT',
  // 贵金属 / 工业金属
  'PAXGUSDT',
  'XAUTUSDT',
  'XAUUSDT',
  'XAGUSDT',
  'XPTUSDT',
  'XPDUSDT',
  'COPPERUSDT',
  // 能源
  'CLUSDT',
  'BZUSDT',
  'NATGASUSDT',
  // 指数
  'BTCDOMUSDT',
  'ALLUSDT',
]);

export const isBlacklistedSymbol = symbol =>
  SYMBOL_BLACKLIST.has(String(symbol || '').toUpperCase());

export const filterBlacklistedPairs = pairs =>
  (pairs || []).filter(p => !isBlacklistedSymbol(p?.symbol));
