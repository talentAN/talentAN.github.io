import { getContracts } from '@root/src/container/market';
import { placeFuturePlanMarketOrder } from '@root/src/container/bitget/api/order';
import { getPendingPlanOrders } from '@root/src/container/bitget/api/query';
import { placeFutureOpenStopMarketAlgo } from '@root/src/container/binance/api/order';
import {
  getOpenAlgoOrders,
  getPositionMode as getBinancePositionMode,
} from '@root/src/container/binance/api/query';
import { getContracts as getBinanceContracts } from '@root/src/container/binance/api';
import {
  checkExistingExposure,
  isLiveOrderEnabled,
  quantizePrice,
  quantizeQuantity,
  SKIP_REASON_LABEL,
} from '../system_1/_autoOrderModel';

/** 触及区间上沿后市价开多名义金额（USDT） */
export const BREAKOUT_NOTIONAL_USDT = 10;

const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));

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
    minNotional: Number(notionalFilter?.minNotional) || null,
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
  const reduceOnly = order?.reduceOnly === true || order?.reduceOnly === 'true' || order?.reduceOnly === 'YES';
  return !reduceOnly;
};

const isLongOpenAlgo = order => {
  const side = String(order?.side || '').toUpperCase();
  if (side !== 'BUY') return false;
  if (order?.reduceOnly === true || order?.reduceOnly === 'true') return false;
  const ps = String(order?.positionSide || '').toUpperCase();
  if (ps === 'SHORT') return false;
  return true;
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
      const list =
        planResult.response?.data?.entrustedList ||
        planResult.response?.data ||
        [];
      const hasPlan = Array.isArray(list) && list.some(isLongOpenPlan);
      if (hasPlan) return { exposed: true, reason: 'has_orders', side: 'long' };
      return { exposed: false, reason: null, side: 'long' };
    }

    if (exchange === 'binance') {
      const algoResult = await getOpenAlgoOrders({ symbol });
      if (!algoResult?.ok) {
        return {
          exposed: true,
          reason: 'query_failed',
          detail: pickErr(algoResult) || '条件单查询失败',
        };
      }
      const list = Array.isArray(algoResult.response) ? algoResult.response : [];
      if (list.some(isLongOpenAlgo)) return { exposed: true, reason: 'has_orders', side: 'long' };
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
 * 对单条横盘结果下「触及上沿 → 市价开多 10U」计划/条件单。
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, detail?: string, size?: number, triggerPrice?: number, result?: object }}
 */
export const placeBreakoutTriggerOrder = async row => {
  const symbol = row?.symbol;
  const exchange = row?.exchange;
  const rangeHigh = Number(row?.rangeHigh);

  if (!symbol || !exchange) {
    return { ok: false, skipped: true, reason: 'invalid_row', detail: '缺少币对' };
  }
  if (!(rangeHigh > 0)) {
    return { ok: false, skipped: true, reason: 'invalid_range', detail: '区间上沿无效' };
  }
  if (!isLiveOrderEnabled()) {
    return { ok: false, skipped: true, reason: 'auto_order_disabled', detail: skipLabel('auto_order_disabled') };
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

  const notional = BREAKOUT_NOTIONAL_USDT;
  const clientOid = `lvb${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32);

  if (exchange === 'bitget') {
    const rules = await getBitgetSymbolRules(symbol);
    const triggerPrice = roundNum(rangeHigh, rules.pricePlace);
    let size = notional / triggerPrice;
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
    if (rules.minTradeUSDT > 0 && size * triggerPrice < rules.minTradeUSDT) {
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
        result,
      };
    }
    return { ok: true, size, triggerPrice, result, exchange, symbol };
  }

  if (exchange === 'binance') {
    const [rules, hedgeMode] = await Promise.all([
      getBinanceSymbolRules(symbol),
      isBinanceHedgeMode(),
    ]);
    const triggerPrice = quantizePrice(rangeHigh, rules.tickSize, rules.pricePrecision);
    let qty = quantizeQuantity(notional / triggerPrice, rules.stepSize, rules.quantityPrecision);
    if (!(qty > 0) || (rules.minQty > 0 && qty < rules.minQty)) {
      return {
        ok: false,
        skipped: true,
        reason: 'size_too_small',
        detail: `数量过小（${qty}），无法满足合约最小下单量`,
      };
    }
    if (rules.minNotional > 0 && qty * triggerPrice < rules.minNotional) {
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
        detail: pickErr(result) || '条件单提交失败',
        size: qty,
        triggerPrice,
        result,
      };
    }
    return { ok: true, size: qty, triggerPrice, result, exchange, symbol };
  }

  return { ok: false, skipped: true, reason: 'unsupported_exchange', detail: skipLabel('unsupported_exchange') };
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
