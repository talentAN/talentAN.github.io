/**
 * @deprecated 请改用 `../_binanceTradeQueue`（暴100/横盘共用交易队）。
 * 此处只做旧名 re-export，无独立逻辑。
 */
export {
  enqueueBinanceTradeJob,
  enqueueBinanceTradeJob as enqueueSurgeOrderJob,
  getBinanceTradeQueueDepth,
  getBinanceTradeQueueDepth as getSurgeOrderQueueDepth,
  hasBinanceTradeQueueWork,
  hasBinanceTradeQueueWork as hasSurgeOrderQueueWork,
} from '../_binanceTradeQueue';
