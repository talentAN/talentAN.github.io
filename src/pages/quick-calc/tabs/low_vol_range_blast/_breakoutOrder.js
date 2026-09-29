import { getContracts } from '@root/src/container/market';
import {
  placeFuturePlanMarketOrder,
  cancelFutureOrder as cancelBitgetOrder,
  cancelFuturePlanOrder as cancelBitgetPlanOrder,
} from '@root/src/container/bitget/api/order';
import {
  getPendingPlanOrders,
  getPendingOrders as getBitgetPendingOrders,
  getAllPositions as getBitgetAllPositions,
} from '@root/src/container/bitget/api/query';
import {
  placeFutureOpenStopMarketAlgo,
  cancelFutureOrder as cancelBinanceOrder,
  cancelFutureAlgoOrder as cancelBinanceAlgoOrder,
} from '@root/src/container/binance/api/order';
import { getPositionMode as getBinancePositionMode } from '@root/src/container/binance/api/query';
import { getContracts as getBinanceContracts } from '@root/src/container/binance/api';
import { getBinanceAccountSnapshot } from '@root/src/container/binance/accountMirror';
import {
  checkExistingExposure,
  isLiveOrderEnabled,
  quantizePrice,
  quantizeQuantity,
  SKIP_REASON_LABEL,
} from '../system_1/_autoOrderModel';
import { isBlacklistedSymbol } from '../_symbolBlacklist';
import { PNL_NOTIONAL_USDT } from '../backtest/_breakoutPnlSim';

/**
 * 与收益回测开仓对齐：
 * - 入场参考价 = 区间上沿 rangeHigh（回测以该价成交）
 * - 突破条件 = 价严格 > 上沿（回测 marker：high > maxH）
 * - 实盘名义：币对最小开仓金额 × OPEN_NOTIONAL_MULT
 */
export const BREAKOUT_NOTIONAL_USDT = PNL_NOTIONAL_USDT;
/** 开仓名义 = 最小开仓金额 × 该倍数 */
export const OPEN_NOTIONAL_MULT = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));
const roundUsdt = n => roundNum(n, 2);

const pickMaxPositive = (...vals) => {
  let max = null;
  vals.forEach(v => {
    const n = Number(v);
    if (n > 0 && (max == null || n > max)) max = n;
  });
  return max;
};

/**
 * 严格上破触发价：第一个 > rangeHigh 的合法价位（+1 tick / 最小精度）。
 * 避免挂在上沿本身时，「盒内摸高」就误触发（与回测 high>上沿 不一致）。
 */
export const calcBreakoutTriggerAboveRangeHigh = (rangeHigh, opts = {}) => {
  const high = Number(rangeHigh);
  if (!(high > 0)) return null;
  const tickSize = Number(opts.tickSize);
  const pricePrecision = Number.isFinite(Number(opts.pricePrecision))
    ? Number(opts.pricePrecision)
    : 8;
  if (tickSize > 0) {
    let price = quantizePrice(high, tickSize, pricePrecision);
    if (!(price > high)) price = roundNum(price + tickSize, pricePrecision);
    return price > high ? price : null;
  }
  const place = Number.isFinite(Number(opts.pricePlace)) ? Number(opts.pricePlace) : 8;
  const step = 10 ** -place;
  let price = roundNum(high, place);
  if (!(price > high)) price = roundNum(price + step, place);
  return price > high ? price : null;
};

let bitgetContractsPromise = null;
const getBitgetSymbolRules = async symbol => {
  if (!bitgetContractsPromise) bitgetContractsPromise = getContracts({}, 'bitget');
  const contracts = await bitgetContractsPromise;
  const contract = (contracts || []).find(c => c.symbol === symbol) || {};
  const volumePlace = Number(contract.volumePlace);
  const pricePlace = Number(contract.pricePlace);
  return {
    sizeMultiplier: Number(contract.sizeMultiplier) || null,
    minTradeNum: Number(contract.minTradeNum) || null,
    minTradeUSDT: Number(contract.minTradeUSDT) || null,
    volumePlace: Number.isFinite(volumePlace) ? volumePlace : 8,
    pricePlace: Number.isFinite(pricePlace) ? pricePlace : 8,
  };
};

let binanceContractsPromise = null;
const getBinanceSymbolRules = async symbol => {
  if (!binanceContractsPromise) binanceContractsPromise = getBinanceContracts();
  const contracts = await binanceContractsPromise;
  const contract = (contracts || []).find(c => c.symbol === symbol);
  const filters = Array.isArray(contract?.filters) ? contract.filters : [];
  const findFilter = (...types) => filters.find(filter => types.includes(filter.filterType));
  const priceFilter = findFilter('PRICE_FILTER');
  const lotFilter = findFilter('LOT_SIZE');
  const marketLotFilter = findFilter('MARKET_LOT_SIZE') || lotFilter;
  const notionalFilter = findFilter('NOTIONAL', 'MIN_NOTIONAL');
  return {
    pricePrecision: contract?.pricePrecision ?? 8,
    quantityPrecision: contract?.quantityPrecision ?? 8,
    tickSize: Number(priceFilter?.tickSize) || null,
    stepSize: Number(lotFilter?.stepSize) || Number(marketLotFilter?.stepSize) || null,
    minQty: Number(lotFilter?.minQty) || Number(marketLotFilter?.minQty) || null,
    minNotional: Number(notionalFilter?.minNotional) || Number(notionalFilter?.notional) || null,
  };
};

/**
 * 币对开仓最小名义（USDT）：取「最小名义」与「最小数量×参考价」的较大者。
 * @param {{ symbol: string, exchange: string, price: number }} opts
 */
export const resolveMinOpenNotionalUsdt = async ({ symbol, exchange, price }) => {
  const px = Number(price);
  if (!symbol || !exchange || !(px > 0)) return null;

  if (exchange === 'bitget') {
    const rules = await getBitgetSymbolRules(symbol);
    return pickMaxPositive(
      rules.minTradeUSDT,
      rules.minTradeNum > 0 ? rules.minTradeNum * px : null
    );
  }

  if (exchange === 'binance') {
    const rules = await getBinanceSymbolRules(symbol);
    return pickMaxPositive(rules.minNotional, rules.minQty > 0 ? rules.minQty * px : null);
  }

  return null;
};

/**
 * 预估开仓金额 = 最小开仓名义 × OPEN_NOTIONAL_MULT。
 * @returns {{ minUsdt: number|null, openNotionalUsdt: number|null }}
 */
export const resolveOpenNotionalUsdt = async ({ symbol, exchange, price }) => {
  const minUsdt = await resolveMinOpenNotionalUsdt({ symbol, exchange, price });
  if (!(minUsdt > 0)) return { minUsdt: null, openNotionalUsdt: null };
  return {
    minUsdt: roundUsdt(minUsdt),
    openNotionalUsdt: roundUsdt(minUsdt * OPEN_NOTIONAL_MULT),
  };
};

let binanceHedgePromise = null;
const isBinanceHedgeMode = async () => {
  if (!binanceHedgePromise) binanceHedgePromise = getBinancePositionMode();
  const { response } = await binanceHedgePromise;
  return response?.dualSidePosition === true;
};

const pickErr = result =>
  result?.error ||
  result?.response?.msg ||
  result?.response?.message ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

const isLongOpenPlan = order => {
  const side = String(order?.side || '').toLowerCase();
  if (side !== 'buy') return false;
  const tradeSide = String(order?.tradeSide || '').toLowerCase();
  if (tradeSide === 'close') return false;
  const reduceOnly =
    order?.reduceOnly === true || order?.reduceOnly === 'true' || order?.reduceOnly === 'YES';
  return !reduceOnly;
};

const isBuySideLoose = side => String(side || '').toLowerCase() === 'buy';

const isLongOpenAlgo = order => {
  const side = String(order?.side || '').toUpperCase();
  if (side !== 'BUY') return false;
  if (order?.reduceOnly === true || order?.reduceOnly === 'true') return false;
  const ps = String(order?.positionSide || '').toUpperCase();
  if (ps === 'SHORT') return false;
  return true;
};

const isLongOpenPending = order => {
  const reduceOnly =
    order?.reduceOnly === true || order?.reduceOnly === 'true' || order?.reduceOnly === 'YES';
  if (reduceOnly) return false;
  const tradeSide = String(order?.tradeSide || '').toLowerCase();
  if (tradeSide === 'close') return false;
  if (!isBuySideLoose(order?.side)) return false;
  const ps = String(order?.positionSide || '').toUpperCase();
  if (ps === 'SHORT') return false;
  return true;
};

const pairIdOf = ({ exchange, symbol }) => `${exchange}:${symbol}`;

const isBinanceLongPosition = p => {
  const amt = Number(p?.positionAmt || 0);
  const ps = String(p?.positionSide || '').toUpperCase();
  if (ps === 'LONG') return amt > 0;
  if (ps === 'SHORT') return false;
  return amt > 0;
};

const isBitgetLongPosition = p => {
  const side = String(p?.holdSide || '').toLowerCase();
  const size = Math.abs(Number(p?.total ?? p?.available ?? p?.posSize ?? 0));
  return size > 0 && (side === 'long' || side === 'buy');
};

/** Bitget 委托列表分页（单页 ≤100） */
const fetchBitgetEntrustedAll = async fetchPage => {
  const all = [];
  let idLessThan;
  for (let page = 0; page < 20; page += 1) {
    const result = await fetchPage(idLessThan);
    if (!result?.ok) {
      return { ok: false, detail: pickErr(result), list: all };
    }
    const list = result.response?.data?.entrustedList;
    const chunk = Array.isArray(list) ? list : [];
    all.push(...chunk);
    const endId = result.response?.data?.endId;
    if (!chunk.length || !endId || chunk.length < 100) {
      return { ok: true, list: all };
    }
    idLessThan = String(endId);
    await sleep(120);
  }
  return { ok: true, list: all };
};

/**
 * 批量刷新开多委托 / 多头持仓状态：每所仅拉全量接口若干次，再映射到列表币对。
 * 避免按币对打 positionRisk + openOrders + openAlgoOrders 触发 429。
 * @param {Array<{ exchange: string, symbol: string }>} rows
 * @returns {{ orderedMap: Record<string, boolean>, positionMap: Record<string, boolean>, error?: string }}
 */
export const fetchLiveOrderStatusMaps = async rows => {
  const orderedMap = {};
  const positionMap = {};
  if (!isLiveOrderEnabled()) {
    return { orderedMap, positionMap, error: 'auto_order_disabled' };
  }

  const unique = [];
  const seen = new Set();
  (rows || []).forEach(row => {
    if (!row?.symbol || !row?.exchange) return;
    const id = pairIdOf(row);
    if (seen.has(id)) return;
    seen.add(id);
    unique.push({ exchange: row.exchange, symbol: row.symbol, id });
    orderedMap[id] = false;
    positionMap[id] = false;
  });
  if (!unique.length) return { orderedMap, positionMap };

  const needBn = unique.some(r => r.exchange === 'binance');
  const needBg = unique.some(r => r.exchange === 'bitget');
  const errors = [];

  if (needBn) {
    try {
      // 复用 User Data Stream 账户镜像，避免每轮全量 openOrders（weight≈40）
      const snap = await getBinanceAccountSnapshot();
      if (!snap?.ok) {
        errors.push(['BN', snap?.error || 'account mirror not ready'].filter(Boolean).join(' / '));
      } else {
        const longPos = new Set();
        (snap.positions || []).forEach(p => {
          if (p?.symbol && isBinanceLongPosition(p)) longPos.add(p.symbol);
        });
        const longOrders = new Set();
        (snap.openOrders || []).forEach(o => {
          if (o?.symbol && isLongOpenPending(o)) longOrders.add(o.symbol);
        });
        (snap.algoOrders || []).forEach(o => {
          if (o?.symbol && isLongOpenAlgo(o)) longOrders.add(o.symbol);
        });
        unique.forEach(r => {
          if (r.exchange !== 'binance') return;
          orderedMap[r.id] = longOrders.has(r.symbol);
          positionMap[r.id] = longPos.has(r.symbol);
        });
      }
    } catch (e) {
      errors.push(`BN ${e?.message || e}`);
    }
  }

  if (needBg) {
    try {
      await sleep(needBn ? 150 : 0);
      const [posResult, pendingPack, planPack] = await Promise.all([
        getBitgetAllPositions({}),
        fetchBitgetEntrustedAll(idLessThan => getBitgetPendingOrders({ idLessThan })),
        fetchBitgetEntrustedAll(idLessThan =>
          getPendingPlanOrders({ planType: 'normal_plan', idLessThan })
        ),
      ]);
      if (!posResult?.ok || !pendingPack.ok || !planPack.ok) {
        errors.push(
          ['BG', pickErr(posResult), pendingPack.detail, planPack.detail]
            .filter(Boolean)
            .join(' / ')
        );
      } else {
        const longPos = new Set();
        const posList = Array.isArray(posResult.response?.data) ? posResult.response.data : [];
        posList.forEach(p => {
          const sym = String(p?.symbol || '').toUpperCase();
          if (sym && isBitgetLongPosition(p)) longPos.add(sym);
        });
        const longOrders = new Set();
        pendingPack.list.forEach(o => {
          const sym = String(o?.symbol || '').toUpperCase();
          if (sym && isLongOpenPending(o)) longOrders.add(sym);
        });
        planPack.list.forEach(o => {
          const sym = String(o?.symbol || '').toUpperCase();
          if (sym && isLongOpenPlan(o)) longOrders.add(sym);
        });
        unique.forEach(r => {
          if (r.exchange !== 'bitget') return;
          const sym = String(r.symbol).toUpperCase();
          orderedMap[r.id] = longOrders.has(sym);
          positionMap[r.id] = longPos.has(sym);
        });
      }
    } catch (e) {
      errors.push(`BG ${e?.message || e}`);
    }
  }

  return {
    orderedMap,
    positionMap,
    error: errors.length ? errors.join('；') : undefined,
  };
};

/**
 * 列出账户全部「多头开仓」未成交委托（普通挂单 + 计划/条件单），带撤单所需 id。
 * 不含止盈止损等 reduce-only。
 * @param {{ exchanges?: string[] }} [opts] 默认 BN+BG；传 `['binance']` 可跳过 Bitget 签名代理
 */
export const listLiveLongOpenOrders = async ({ exchanges } = {}) => {
  const orders = [];
  if (!isLiveOrderEnabled()) {
    return { orders, error: 'auto_order_disabled' };
  }
  const allow =
    Array.isArray(exchanges) && exchanges.length
      ? new Set(exchanges.map(e => String(e).toLowerCase()))
      : null;
  const wantBn = !allow || allow.has('binance');
  const wantBg = !allow || allow.has('bitget');
  const errors = [];

  if (wantBn) {
    try {
      const snap = await getBinanceAccountSnapshot();
      if (!snap?.ok) {
        errors.push(['BN', snap?.error || 'account mirror not ready'].filter(Boolean).join(' / '));
      } else {
        (snap.openOrders || []).forEach(o => {
          if (!o?.symbol || !isLongOpenPending(o)) return;
          orders.push({
            exchange: 'binance',
            symbol: o.symbol,
            kind: 'pending',
            orderId: o.orderId,
            clientOid: o.clientOrderId,
          });
        });
        (snap.algoOrders || []).forEach(o => {
          if (!o?.symbol || !isLongOpenAlgo(o)) return;
          orders.push({
            exchange: 'binance',
            symbol: o.symbol,
            kind: 'algo',
            algoId: o.algoId,
            clientOid: o.clientAlgoId,
          });
        });
      }
    } catch (e) {
      errors.push(`BN ${e?.message || e}`);
    }
  }

  if (wantBg) {
    try {
      await sleep(wantBn ? 120 : 0);
      const [pendingPack, planPack] = await Promise.all([
        fetchBitgetEntrustedAll(idLessThan => getBitgetPendingOrders({ idLessThan })),
        fetchBitgetEntrustedAll(idLessThan =>
          getPendingPlanOrders({ planType: 'normal_plan', idLessThan })
        ),
      ]);
      if (!pendingPack.ok || !planPack.ok) {
        errors.push(['BG', pendingPack.detail, planPack.detail].filter(Boolean).join(' / '));
      } else {
        pendingPack.list.forEach(o => {
          const symbol = String(o?.symbol || '').toUpperCase();
          if (!symbol || !isLongOpenPending(o)) return;
          orders.push({
            exchange: 'bitget',
            symbol,
            kind: 'pending',
            orderId: o.orderId,
            clientOid: o.clientOid,
          });
        });
        planPack.list.forEach(o => {
          const symbol = String(o?.symbol || '').toUpperCase();
          if (!symbol || !isLongOpenPlan(o)) return;
          orders.push({
            exchange: 'bitget',
            symbol,
            kind: 'plan',
            orderId: o.orderId,
            clientOid: o.clientOid,
            planType: o.planType || 'normal_plan',
          });
        });
      }
    } catch (e) {
      errors.push(`BG ${e?.message || e}`);
    }
  }

  return { orders, error: errors.length ? errors.join('；') : undefined };
};
/** 撤销单笔多头开仓委托（普通 / 计划 / 条件） */
export const cancelLongOpenOrder = async order => {
  if (!order?.exchange || !order?.symbol) {
    return { ok: false, detail: '缺少币对' };
  }
  if (!isLiveOrderEnabled()) {
    return { ok: false, skipped: true, reason: 'auto_order_disabled' };
  }

  if (order.exchange === 'binance') {
    if (order.kind === 'algo') {
      const result = await cancelBinanceAlgoOrder({
        symbol: order.symbol,
        algoId: order.algoId,
        clientAlgoId: order.clientOid,
      });
      return {
        ok: Boolean(result?.ok),
        detail: result?.ok ? null : pickErr(result) || '撤条件单失败',
        result,
      };
    }
    const result = await cancelBinanceOrder({
      symbol: order.symbol,
      orderId: order.orderId,
      origClientOrderId: order.clientOid,
    });
    return {
      ok: Boolean(result?.ok),
      detail: result?.ok ? null : pickErr(result) || '撤挂单失败',
      result,
    };
  }

  if (order.exchange === 'bitget') {
    if (order.kind === 'plan') {
      const result = await cancelBitgetPlanOrder({
        symbol: order.symbol,
        orderId: order.orderId,
        clientOid: order.clientOid,
        planType: order.planType || 'normal_plan',
      });
      return {
        ok: Boolean(result?.ok),
        detail: result?.ok ? null : pickErr(result) || '撤计划单失败',
        result,
      };
    }
    const result = await cancelBitgetOrder({
      symbol: order.symbol,
      orderId: order.orderId,
      clientOid: order.clientOid,
    });
    return {
      ok: Boolean(result?.ok),
      detail: result?.ok ? null : pickErr(result) || '撤挂单失败',
      result,
    };
  }

  return { ok: false, detail: `不支持交易所 ${order.exchange}` };
};

/**
 * 串行撤销一组多头开仓委托（带间隔，避免 429）。
 */
export const cancelLongOpenOrders = async (orders, { onProgress } = {}) => {
  const summary = { total: orders.length, ok: 0, failed: 0, results: [] };
  for (let i = 0; i < orders.length; i += 1) {
    const order = orders[i];
    const result = await cancelLongOpenOrder(order);
    summary.results.push({ order, result });
    if (result.ok) summary.ok += 1;
    else summary.failed += 1;
    onProgress?.({ index: i, order, result, summary: { ...summary } });
    await sleep(150);
  }
  return summary;
};

/**
 * 是否已有同向（多头开仓）未成交委托：普通挂单 + 计划/条件单。
 * 不含持仓；用于列表禁用「一键下单」与「过滤已下单」。
 */
export const checkLongOpenOrders = async ({ symbol, exchange }) => {
  if (!isLiveOrderEnabled()) {
    return { hasOrders: false, unavailable: true, reason: 'auto_order_disabled' };
  }
  try {
    if (exchange === 'bitget') {
      const [orderResult, planResult] = await Promise.all([
        getBitgetPendingOrders({ symbol }),
        getPendingPlanOrders({ symbol, planType: 'normal_plan' }),
      ]);
      if (!orderResult?.ok || !planResult?.ok) {
        return {
          hasOrders: false,
          unavailable: true,
          reason: 'query_failed',
          detail: [pickErr(orderResult), pickErr(planResult)].filter(Boolean).join(' / '),
        };
      }
      const pending = orderResult.response?.data?.entrustedList;
      const plans = planResult.response?.data?.entrustedList || planResult.response?.data || [];
      const hasPending = Array.isArray(pending) && pending.some(isLongOpenPending);
      const hasPlan = Array.isArray(plans) && plans.some(isLongOpenPlan);
      return {
        hasOrders: hasPending || hasPlan,
        reason: hasPending || hasPlan ? 'has_orders' : null,
      };
    }

    if (exchange === 'binance') {
      const snap = await getBinanceAccountSnapshot();
      if (!snap?.ok) {
        return {
          hasOrders: false,
          unavailable: true,
          reason: 'query_failed',
          detail: snap?.error || 'account mirror not ready',
        };
      }
      const sym = String(symbol || '').toUpperCase();
      const pending = (snap.openOrders || []).filter(
        o => String(o?.symbol || '').toUpperCase() === sym
      );
      const algos = (snap.algoOrders || []).filter(
        o => String(o?.symbol || '').toUpperCase() === sym
      );
      const hasPending = pending.some(isLongOpenPending);
      const hasAlgo = algos.some(isLongOpenAlgo);
      return {
        hasOrders: hasPending || hasAlgo,
        reason: hasPending || hasAlgo ? 'has_orders' : null,
      };
    }

    return { hasOrders: false, unavailable: true, reason: 'unsupported_exchange' };
  } catch (e) {
    return {
      hasOrders: false,
      unavailable: true,
      reason: 'query_error',
      detail: e?.message || String(e),
    };
  }
};

/**
 * 开多前：只检查多头持仓 / 多头开仓挂单 / 多头计划·条件单。
 * 空头敞口不挡（双向持仓下可与 SurgeAlert 开空并存）。
 */
export const checkBreakoutOrderExposure = async ({ symbol, exchange }) => {
  const base = await checkExistingExposure({ symbol, exchange, side: 'long' });
  if (base.exposed) return base;

  try {
    if (exchange === 'bitget') {
      const planResult = await getPendingPlanOrders({ symbol, planType: 'normal_plan' });
      if (!planResult?.ok) {
        return {
          exposed: true,
          reason: 'query_failed',
          detail: pickErr(planResult) || '计划委托查询失败',
        };
      }
      const list = planResult.response?.data?.entrustedList || planResult.response?.data || [];
      const hasPlan = Array.isArray(list) && list.some(isLongOpenPlan);
      if (hasPlan) return { exposed: true, reason: 'has_orders', side: 'long' };
      return { exposed: false, reason: null, side: 'long' };
    }

    if (exchange === 'binance') {
      const snap = await getBinanceAccountSnapshot();
      if (!snap?.ok) {
        return {
          exposed: true,
          reason: 'query_failed',
          detail: snap?.error || '条件单查询失败',
        };
      }
      const sym = String(symbol || '').toUpperCase();
      const list = (snap.algoOrders || []).filter(
        o => String(o?.symbol || '').toUpperCase() === sym
      );
      const openOrders = (snap.openOrders || []).filter(
        o => String(o?.symbol || '').toUpperCase() === sym
      );
      if (list.some(isLongOpenAlgo) || openOrders.some(isLongOpenPending)) {
        return { exposed: true, reason: 'has_orders', side: 'long' };
      }
      return { exposed: false, reason: null, side: 'long' };
    }

    return { exposed: true, reason: 'unsupported_exchange' };
  } catch (e) {
    const msg = e?.message || String(e);
    return { exposed: true, reason: 'query_error', detail: msg };
  }
};

const skipLabel = reason => SKIP_REASON_LABEL[reason] || reason || '已跳过';

/**
 * 对单条横盘结果下「严格上破上沿 → 市价开多」计划/条件单。
 * 开仓口径对齐收益回测：入场参考价=rangeHigh，数量按 rangeHigh 计；触发价=上沿+1tick（high>上沿）。
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, detail?: string, size?: number, triggerPrice?: number, entryPrice?: number, result?: object }}
 */
export const placeBreakoutTriggerOrder = async row => {
  const symbol = row?.symbol;
  const exchange = row?.exchange;
  const rangeHigh = Number(row?.rangeHigh);

  if (!symbol || !exchange) {
    return { ok: false, skipped: true, reason: 'invalid_row', detail: '缺少币对' };
  }
  if (isBlacklistedSymbol(symbol)) {
    return {
      ok: false,
      skipped: true,
      reason: 'blacklisted',
      detail: SKIP_REASON_LABEL.blacklisted || '黑名单币对',
    };
  }
  if (!(rangeHigh > 0)) {
    return { ok: false, skipped: true, reason: 'invalid_range', detail: '区间上沿无效' };
  }
  if (!isLiveOrderEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'auto_order_disabled',
      detail: skipLabel('auto_order_disabled'),
    };
  }

  const exposure = await checkBreakoutOrderExposure({ symbol, exchange });
  if (exposure.exposed) {
    return {
      ok: false,
      skipped: true,
      reason: exposure.reason,
      detail: exposure.detail || skipLabel(exposure.reason),
    };
  }

  const entryPrice = rangeHigh;
  let notional = Number(row?.openNotionalUsdt);
  if (!(notional > 0)) {
    const resolved = await resolveOpenNotionalUsdt({
      symbol,
      exchange,
      price: entryPrice,
    });
    notional = Number(resolved.openNotionalUsdt);
  }
  if (!(notional > 0)) {
    return {
      ok: false,
      skipped: true,
      reason: 'notional_unavailable',
      detail: '无法获取币对最小开仓金额，跳过下单',
    };
  }
  const clientOid = `lvb${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32);

  if (exchange === 'bitget') {
    const rules = await getBitgetSymbolRules(symbol);
    const triggerPrice = calcBreakoutTriggerAboveRangeHigh(rangeHigh, {
      pricePlace: rules.pricePlace,
    });
    if (!(triggerPrice > rangeHigh)) {
      return {
        ok: false,
        skipped: true,
        reason: 'invalid_range',
        detail: '无法计算严格上破触发价',
      };
    }
    // 数量按回测入场价（上沿）计，与 simulateBreakoutLongTrade 的 qty0 一致
    let size = notional / entryPrice;
    if (rules.sizeMultiplier > 0) {
      size = Math.floor(size / rules.sizeMultiplier + 1e-10) * rules.sizeMultiplier;
    }
    size = roundNum(size, rules.volumePlace);
    if (!(size > 0) || (rules.minTradeNum > 0 && size < rules.minTradeNum)) {
      return {
        ok: false,
        skipped: true,
        reason: 'size_too_small',
        detail: `数量过小（${size}），无法满足合约最小下单量`,
      };
    }
    if (rules.minTradeUSDT > 0 && size * entryPrice < rules.minTradeUSDT) {
      return {
        ok: false,
        skipped: true,
        reason: 'notional_too_small',
        detail: `名义金额低于最小 ${rules.minTradeUSDT}U`,
      };
    }

    const result = await placeFuturePlanMarketOrder({
      symbol,
      size,
      triggerPrice,
      side: 'buy',
      triggerType: 'fill_price',
      tradeSide: 'open',
      clientOid,
    });
    if (!result?.ok) {
      return {
        ok: false,
        reason: 'submit_failed',
        detail: pickErr(result) || '计划委托提交失败',
        size,
        triggerPrice,
        entryPrice,
        result,
      };
    }
    return { ok: true, size, triggerPrice, entryPrice, notional, result, exchange, symbol };
  }

  if (exchange === 'binance') {
    const [rules, hedgeMode] = await Promise.all([
      getBinanceSymbolRules(symbol),
      isBinanceHedgeMode(),
    ]);
    const triggerPrice = calcBreakoutTriggerAboveRangeHigh(rangeHigh, {
      tickSize: rules.tickSize,
      pricePrecision: rules.pricePrecision,
    });
    if (!(triggerPrice > rangeHigh)) {
      return {
        ok: false,
        skipped: true,
        reason: 'invalid_range',
        detail: '无法计算严格上破触发价',
      };
    }
    let qty = quantizeQuantity(notional / entryPrice, rules.stepSize, rules.quantityPrecision);
    if (!(qty > 0) || (rules.minQty > 0 && qty < rules.minQty)) {
      return {
        ok: false,
        skipped: true,
        reason: 'size_too_small',
        detail: `数量过小（${qty}），无法满足合约最小下单量`,
      };
    }
    if (rules.minNotional > 0 && qty * entryPrice < rules.minNotional) {
      return {
        ok: false,
        skipped: true,
        reason: 'notional_too_small',
        detail: `名义金额低于最小 ${rules.minNotional}U`,
      };
    }

    const result = await placeFutureOpenStopMarketAlgo({
      symbol,
      side: 'BUY',
      quantity: qty,
      triggerPrice,
      positionSide: hedgeMode ? 'LONG' : undefined,
      clientAlgoId: clientOid,
      workingType: 'CONTRACT_PRICE',
    });
    if (!result?.ok) {
      return {
        ok: false,
        reason: 'submit_failed',
        detail: pickErr(result) || '条件委托提交失败',
        size: qty,
        triggerPrice,
        entryPrice,
        result,
      };
    }
    return { ok: true, size: qty, triggerPrice, entryPrice, notional, result, exchange, symbol };
  }

  return {
    ok: false,
    skipped: true,
    reason: 'unsupported_exchange',
    detail: `不支持交易所 ${exchange}`,
  };
};

/**
 * 批量下单；串行以免打爆限频。
 */
export const placeBreakoutTriggerOrdersBatch = async (rows, { onProgress } = {}) => {
  const summary = { total: rows.length, ok: 0, skipped: 0, failed: 0, results: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await placeBreakoutTriggerOrder(row);
    summary.results.push({ row, result });
    if (result.ok) summary.ok += 1;
    else if (result.skipped) summary.skipped += 1;
    else summary.failed += 1;
    onProgress?.({ index: i, row, result, summary: { ...summary } });
  }
  return summary;
};
