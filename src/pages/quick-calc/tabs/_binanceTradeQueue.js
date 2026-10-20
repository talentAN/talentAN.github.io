/**
 * Binance 交易队兼容入口（全部转发 `_binanceRestQueue`）。
 *
 * - SURGE_* / RANGE_* → 对应 REST 优先级
 * - 其余未归类 key → REST DEFAULT
 */
import {
  getBinanceHighPriorityDepth,
} from './_marketFetchGate';
import {
  enqueueBinanceRestJob,
  getBinanceRestQueueSnapshot,
  getBinanceRestQueueDepth,
  hasBinanceRestQueueWork,
  BINANCE_REST_PRIORITY,
} from './_binanceRestQueue';

/** @deprecated 请用 BINANCE_REST_PRIORITY；此处仅兼容旧引用 */
export const TRADE_JOB_PRIORITY = {
  SURGE_OPEN: BINANCE_REST_PRIORITY.SURGE_OPEN,
  EXIT: 80,
  RANGE: BINANCE_REST_PRIORITY.RANGE_OPEN,
};

const isSurgeOpenKey = key => String(key || '').toUpperCase().startsWith('SURGE_OPEN:');
const isSurgeExitKey = key => String(key || '').toUpperCase().startsWith('SURGE_EXIT:');
const isRangeExitKey = key => String(key || '').toUpperCase().startsWith('RANGE_EXIT:');
/** RANGE:SYM 开仓/清理（勿匹配 RANGE_EXIT:） */
const isRangeOpenKey = key => {
  const k = String(key || '').toUpperCase();
  return k.startsWith('RANGE:') && !k.startsWith('RANGE_EXIT:');
};

export const getBinanceTradeQueueDepth = () => getBinanceRestQueueDepth();

export const getBinanceTradeQueueSnapshot = () => {
  const rest = getBinanceRestQueueSnapshot();
  return {
    depth: rest.depth,
    pending: rest.pending || 0,
    pendingOpen: rest.pending || 0,
    pendingOther: 0,
    pendingRest: rest.pending || 0,
    pumping: Boolean(rest.pumping),
    pumpingOpen: Boolean(rest.pumping),
    pumpingOther: false,
    pumpingRest: Boolean(rest.pumping),
    currentJobKey: rest.currentJobKey || '',
    highPriorityDepth: getBinanceHighPriorityDepth(),
    headKeys: rest.headKeys || [],
  };
};

export const hasBinanceTradeQueueWork = () => hasBinanceRestQueueWork();

/**
 * @param {string} key 去重键：SURGE_OPEN: / SURGE_EXIT: / RANGE: / RANGE_EXIT: / 其它
 * @param {(meta: { key: string, enqueuedAt: number }) => Promise<any>} run
 * @param {{ priority?: number }} [opts]
 * @returns {Promise<any>}
 */
export const enqueueBinanceTradeJob = (key, run, opts = {}) => {
  const jobKey = String(key || '').toUpperCase();
  if (!jobKey || typeof run !== 'function') {
    return Promise.reject(new Error('binance trade job invalid'));
  }

  if (isSurgeOpenKey(jobKey)) {
    return enqueueBinanceRestJob(jobKey, run, {
      priority: opts.priority ?? BINANCE_REST_PRIORITY.SURGE_OPEN,
    });
  }
  if (isSurgeExitKey(jobKey)) {
    return enqueueBinanceRestJob(jobKey, run, {
      priority: opts.priority ?? BINANCE_REST_PRIORITY.SURGE_EXIT,
    });
  }
  if (isRangeExitKey(jobKey)) {
    return enqueueBinanceRestJob(jobKey, run, {
      priority: opts.priority ?? BINANCE_REST_PRIORITY.RANGE_EXIT,
    });
  }
  if (isRangeOpenKey(jobKey)) {
    return enqueueBinanceRestJob(jobKey, run, {
      priority: opts.priority ?? BINANCE_REST_PRIORITY.RANGE_OPEN,
    });
  }

  return enqueueBinanceRestJob(jobKey, run, {
    priority: opts.priority ?? BINANCE_REST_PRIORITY.DEFAULT,
  });
};

/** @deprecated 兼容旧名 */
export const enqueueSurgeOrderJob = enqueueBinanceTradeJob;
export const getSurgeOrderQueueDepth = getBinanceTradeQueueDepth;
export const hasSurgeOrderQueueWork = hasBinanceTradeQueueWork;
