/**
 * 兼容入口：门闩在 container/market/_fetchGate。
 */
export {
  withMarketFetchGate,
  withBinanceIpGate,
  waitBinanceBanIfNeeded,
  getMarketFetchGateConfig,
  reportBinanceRateLimit,
  reportBinanceUsedWeight,
  getBinanceBanRemaining,
  getBinanceUsedWeight1m,
  getBinanceRequestCount1m,
  shouldThrottleBinanceBackground,
  acquireBinanceHighPriority,
  releaseBinanceHighPriority,
  getBinanceHighPriorityDepth,
  hasBinanceHighPriorityWork,
} from '@root/src/container/market/_fetchGate';
