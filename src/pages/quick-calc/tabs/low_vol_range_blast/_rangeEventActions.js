/**
 * 横盘事件驱动：单币清理开多 / 近带挂开多（内存盒子 + 账户镜像）。
 */
import {
  getBinanceAccountSnapshot,
  getSharedBinanceAccountMirror,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import { isBlacklistedSymbol } from '../_symbolBlacklist';
import { isLiveOrderEnabled } from '../system_1/_autoOrderModel';
import {
  calcDistBelowRangeHighPct,
  normalizeNearBandPct,
  MONITOR_OPEN_NOTIONAL_MULT,
  MONITOR_MAX_MIN_OPEN_USDT,
  RANGE_MONITOR_NEAR_BAND_PCT,
  RANGE_MONITOR_MAX_MULT,
} from './_rangeScan';
import {
  cancelLongOpenOrders,
  listLiveLongOpenOrders,
  placeBreakoutTriggerOrder,
  getRecentBreakoutOrder,
  resolveMinOpenNotionalUsdt,
} from './_breakoutOrder';
import {
  RANGE_MONITOR_MAX_ORDERS,
  RANGE_MONITOR_PLACE_GAP_MS,
  RANGE_MONITOR_SCAN_ENABLED,
} from './_rangeMonitorParams';
import { evalRangeBox, normalizeMaxRangeMult } from './_rangeBoxEval';
import { getSharedMiniTickerFeed } from './_rangeMonitorPriceFeed';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pairIdOf = ({ exchange, symbol }) =>
  `${String(exchange || 'binance').toLowerCase()}:${String(symbol || '').toUpperCase()}`;

const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));

/** 仅撤横盘监控自己挂的开多（clientId 前缀 lvb），避免误伤出场/手工/暴涨单 */
const isRangeMonitorOpenOrder = order =>
  /^lvb/i.test(String(order?.clientOid || order?.clientAlgoId || order?.clientOrderId || ''));

/** 同币挂/撤串行 */
const actionTail = new Map();
const withSymbolLock = (symbol, task) => {
  const key = String(symbol || '').toUpperCase();
  const prev = actionTail.get(key) || Promise.resolve();
  const run = prev.then(task, task);
  const settled = run.catch(() => undefined);
  actionTail.set(key, settled);
  settled.finally(() => {
    if (actionTail.get(key) === settled) actionTail.delete(key);
  });
  return run;
};

export const peekMirrorSnapshot = () => getSharedBinanceAccountMirror().snapshot();

export const hasLongPositionInMirror = symbol => {
  const key = String(symbol || '').toUpperCase();
  const snap = peekMirrorSnapshot();
  if (!snap?.ok) return false;
  return (snap.positions || []).some(p => {
    if (String(p?.symbol || '').toUpperCase() !== key) return false;
    const amt = Number(p.positionAmt || 0);
    const side = String(p.positionSide || '').toUpperCase();
    return side === 'LONG' || (side !== 'SHORT' && amt > 0);
  });
};

/** 镜像里是否有横盘监控自己挂的开多（lvb 前缀），轻量、不打 REST */
export const hasRangeMonitorOpenOrderInMirror = symbol => {
  const key = String(symbol || '').toUpperCase();
  const snap = peekMirrorSnapshot();
  if (!snap?.ok) return false;
  const match = order =>
    String(order?.symbol || '').toUpperCase() === key && isRangeMonitorOpenOrder(order);
  return (
    (snap.openOrders || []).some(match) || (snap.algoOrders || []).some(match)
  );
};

/**
 * 是否值得进交易队：近带可能挂、离带/有单可能撤。
 * 远带且无 lvb 单 → 不入队，避免灌爆共用串行队列拖死暴100开仓。
 */
export const shouldEnqueueRangeTradeAction = (symbol, box) => {
  if (!box || box.miss) return false;
  if (box.nearBand) return true;
  if (box.leaveBand) return true;
  const key = String(symbol || '').toUpperCase();
  if (hasRangeMonitorOpenOrderInMirror(key)) return true;
  return false;
};

export const countActiveMirrorOrders = () => {
  const snap = peekMirrorSnapshot();
  if (!snap?.ok) return 0;
  const keys = new Set();
  const push = order => {
    const status = String(order?.status || '').toUpperCase();
    if (['CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FILLED', 'FINISHED', 'TRIGGERED'].includes(status)) {
      return;
    }
    const key =
      order?.orderId != null
        ? `o:${order.orderId}`
        : order?.algoId != null
          ? `a:${order.algoId}`
          : order?.clientOrderId || order?.clientAlgoId;
    if (key) keys.add(String(key));
  };
  (snap.openOrders || []).forEach(push);
  (snap.algoOrders || []).forEach(push);
  return keys.size;
};

/**
 * 单币：若有开多且应清理则撤。
 * @returns {{ acted: boolean, cancelled?: number, reason?: string }}
 */
export const maybeCleanupSymbol = (symbol, opts = {}) =>
  withSymbolLock(symbol, () => maybeCleanupSymbolUnlocked(symbol, opts));

const maybeCleanupSymbolUnlocked = async (
  symbol,
  {
    maxRangeMult = RANGE_MONITOR_MAX_MULT,
    nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
    priceFeed,
    stockSymbols,
    onLog,
    onStatus,
    binanceSnapshot,
  } = {}
) => {
  if (!isLiveOrderEnabled()) return { acted: false, reason: 'live_disabled' };
  const key = String(symbol || '').toUpperCase();
  const feed = priceFeed || getSharedMiniTickerFeed();
  const mult = normalizeMaxRangeMult(maxRangeMult);
  const bandPct = normalizeNearBandPct(nearBandPct);
  const leavePct = bandPct + 1;

  const recent = getRecentBreakoutOrder(key);
  if (recent && Date.now() - recent.at < 10000) {
    return { acted: false, reason: 'cooldown' };
  }

  let snap = binanceSnapshot;
  if (!snap?.ok) {
    try {
      snap = await getBinanceAccountSnapshot({ ensureStarted: true, maxStaleMs: 60_000 });
    } catch (_) {
      snap = peekMirrorSnapshot();
    }
  }

  const { orders, error } = await listLiveLongOpenOrders({
    exchanges: ['binance'],
    binanceSnapshot: snap,
  });
  if (error) return { acted: false, reason: 'orders_error', detail: error };
  const pairOrders = (orders || []).filter(
    o =>
      String(o.symbol || '').toUpperCase() === key && isRangeMonitorOpenOrder(o)
  );
  if (!pairOrders.length) return { acted: false, reason: 'no_orders' };

  let reason = null;
  if (stockSymbols?.has?.(key)) reason = 'stock';
  else if (isBlacklistedSymbol(key)) reason = 'blacklist';
  else {
    const box = evalRangeBox(key, {
      maxRangeMult: mult,
      nearBandPct: bandPct,
      priceFeed: feed,
      pair: { exchange: 'binance', symbol: key },
    });
    if (box.miss) return { acted: false, reason: 'miss_cache' };
    // 无横盘几何盒子 → 撤；已破上沿要留着等突破单成交，绝不能当 out_of_range
    if (!box.hasBox) reason = 'out_of_range';
    else if (box.leaveBand) reason = 'far_from_band';
    // yy≤0（现价≥上沿）：keep
  }

  if (!reason) return { acted: false, reason: 'keep' };

  onStatus?.(`清理：${key} · ${reason}`);
  const summary = await cancelLongOpenOrders(pairOrders);
  if (summary.ok > 0) {
    onLog?.({
      type: 'cancelled',
      exchange: 'binance',
      symbol: key,
      count: summary.ok,
      reason,
    });
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[RangeEvent] refresh after cancel', e);
    }
  }
  return { acted: summary.ok > 0, cancelled: summary.ok, failed: summary.failed, reason };
};

/**
 * 单币：近带且无仓无单则挂开多。
 */
export const maybeOpenSymbol = (symbol, opts = {}) =>
  withSymbolLock(symbol, () => maybeOpenSymbolUnlocked(symbol, opts));

const maybeOpenSymbolUnlocked = async (
  symbol,
  {
    maxRangeMult = RANGE_MONITOR_MAX_MULT,
    nearBandPct = RANGE_MONITOR_NEAR_BAND_PCT,
    priceFeed,
    stockSymbols,
    onLog,
    onStatus,
    binanceSnapshot,
  } = {}
) => {
  if (!RANGE_MONITOR_SCAN_ENABLED) return { acted: false, reason: 'scan_disabled' };
  if (!isLiveOrderEnabled()) return { acted: false, reason: 'live_disabled' };

  const key = String(symbol || '').toUpperCase();
  if (isBlacklistedSymbol(key)) return { acted: false, reason: 'blacklist' };
  if (stockSymbols?.has?.(key)) return { acted: false, reason: 'stock' };

  const feed = priceFeed || getSharedMiniTickerFeed();
  const mult = normalizeMaxRangeMult(maxRangeMult);
  const bandPct = normalizeNearBandPct(nearBandPct);
  const pair = { exchange: 'binance', symbol: key };

  // 仓位/委托以 placeBreakoutTriggerOrder → checkBreakoutOrderExposure 的 REST 为准；
  // 此处不再用本机镜像短路（双开网页会漏拦或误拦）。槽位仍用镜像近似。
  const actualOrderCount = countActiveMirrorOrders();
  if (!(RANGE_MONITOR_MAX_ORDERS - actualOrderCount > 0)) {
    return { acted: false, reason: 'slot_full' };
  }

  const box = evalRangeBox(key, {
    maxRangeMult: mult,
    nearBandPct: bandPct,
    priceFeed: feed,
    pair,
  });
  if (box.miss) return { acted: false, reason: 'miss_cache' };
  if (!box.hit || !(box.rangeHigh > 0)) return { acted: false, reason: 'no_box' };
  if (box.broke) {
    return { acted: false, reason: 'broke_precheck' };
  }
  if (!box.nearBand) return { acted: false, reason: 'far_band', yy: box.yy };

  const rangeHigh = box.rangeHigh;
  const yy =
    box.yy != null
      ? box.yy
      : calcDistBelowRangeHighPct(box.last, rangeHigh);

  const minUsdt = await resolveMinOpenNotionalUsdt({
    symbol: key,
    exchange: 'binance',
    price: rangeHigh,
  });
  if (!(minUsdt > 0)) return { acted: false, reason: 'min_usdt_invalid' };
  if (!(minUsdt < MONITOR_MAX_MIN_OPEN_USDT)) {
    onLog?.({
      type: 'min_notional_skip',
      symbol: key,
      exchange: 'binance',
      reason: 'min_open_ge_20',
      minUsdt,
      detail: `最小开仓 ${Number(minUsdt).toFixed(2)}U ≥ ${MONITOR_MAX_MIN_OPEN_USDT}U，跳过挂开多`,
    });
    return { acted: false, reason: 'min_notional' };
  }

  const openNotionalUsdt = roundNum(minUsdt * MONITOR_OPEN_NOTIONAL_MULT, 2);
  onStatus?.(
    `开仓：${key} ~${openNotionalUsdt}U · yy=${yy != null ? yy.toFixed(2) : '?'}%≤${bandPct}%`
  );

  const row = {
    ...box.hit,
    symbol: key,
    exchange: 'binance',
    rangeHigh,
    openNotionalUsdt,
  };
  const result = await placeBreakoutTriggerOrder(row);

  if (result.ok) {
    onLog?.({
      type: 'placed',
      symbol: key,
      exchange: 'binance',
      openNotionalUsdt,
      triggerPrice: result.triggerPrice,
      yy,
    });
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[RangeEvent] refresh after place', e);
    }
    await sleep(RANGE_MONITOR_PLACE_GAP_MS);
    return { acted: true, placed: 1, yy };
  }

  if (result.skipped) {
    onLog?.({
      type: 'skipped',
      symbol: key,
      exchange: 'binance',
      reason: result.reason,
      detail: result.detail,
    });
    return { acted: false, reason: result.reason, detail: result.detail };
  }

  const resp = result?.result?.response ?? result?.response;
  const code = Number(resp?.code);
  const msg = String(resp?.msg || result?.detail || '');
  if (code === -2021 || /immediately trigger/i.test(msg)) {
    onLog?.({
      type: 'broke_out',
      symbol: key,
      exchange: 'binance',
      rangeHigh,
      liveLast: box.last,
      yy,
      detail: result.detail || '挂单会立刻触发(-2021)，未挂上',
    });
    return { acted: false, reason: 'broke_out' };
  }

  if (code === -4045 || /max stop order limit/i.test(msg)) {
    onLog?.({
      type: 'max_stop_limit',
      symbol: key,
      exchange: 'binance',
      detail: result.detail || '账户级/上限类失败',
    });
    return { acted: false, reason: 'account_stop', fatalOpen: true };
  }

  onLog?.({
    type: 'failed_stop',
    symbol: key,
    exchange: 'binance',
    reason: result.reason,
    detail: result.detail,
  });
  return { acted: false, reason: 'failed', detail: result.detail };
};

/**
 * 价变后：先清理（若有开多）；无单/已撤后再尝试近带开仓。
 */
export const handleRangeSymbolPriceEvent = async (symbol, opts = {}) => {
  const key = String(symbol || '').toUpperCase();
  const cleanup = await maybeCleanupSymbol(key, opts);
  if (
    cleanup.reason === 'keep' ||
    cleanup.reason === 'cooldown' ||
    cleanup.reason === 'miss_cache'
  ) {
    return {
      cleanup,
      open: null,
      needRest: cleanup.reason === 'miss_cache',
    };
  }
  const open = await maybeOpenSymbol(key, opts);
  return {
    cleanup,
    open,
    needRest: open?.reason === 'miss_cache',
  };
};

export { pairIdOf };
