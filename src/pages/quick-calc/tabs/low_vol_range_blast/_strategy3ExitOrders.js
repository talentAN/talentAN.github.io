import { getSinglePosition } from '@root/src/container/bitget/api/query';
import {
  placeFuturePosStopLoss,
  placeFutureTpslOrder,
} from '@root/src/container/bitget/api/order';
import { getContracts as getBitgetContracts } from '@root/src/container/market';
import {
  getPositionRisk,
  getPositionMode as getBinancePositionMode,
} from '@root/src/container/binance/api/query';
import { getContracts as getBinanceContracts } from '@root/src/container/binance/api';
import {
  placeFutureQtyTakeProfitAlgo,
  placeFutureQtyStopAlgo,
  placeFutureTrailingStopAlgo,
  placeFutureClosePositionAlgo,
} from '@root/src/container/binance/api/order';
import {
  isLiveOrderEnabled,
  quantizeQuantity,
  SKIP_REASON_LABEL,
} from '../system_1/_autoOrderModel';

/**
 * 回测默认组 #3（奔跑派）出场结构，实盘止盈委托对齐此口径。
 * 止盈%占开仓总量；止损：涨幅达 slArm% 后全仓止损价=入场×(1+slPrice%)；
 * 追踪：涨幅达 trailArm% 后回撤 trailCb% 平剩余。
 */
export const STRATEGY3_EXIT = {
  id: 3,
  label: '策略3·奔跑派',
  tpLegs: [
    { gainPct: 20, closePct: 10 },
    { gainPct: 50, closePct: 10 },
    { gainPct: 100, closePct: 10 },
  ],
  slArmPct: 20,
  slPricePct: 0,
  /** 横盘监控定稿：xx>开仓×1.2 即挂追踪（原回测为 40） */
  trailArmPct: 40,
  trailCbPct: 12,
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));
const finite = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pickErr = result =>
  result?.error ||
  result?.response?.msg ||
  result?.response?.message ||
  result?.response?.data?.[0]?.msg ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

let bitgetContractsPromise = null;
const getBitgetRules = async symbol => {
  if (!bitgetContractsPromise) bitgetContractsPromise = getBitgetContracts({}, 'bitget');
  const contracts = await bitgetContractsPromise;
  const contract = (contracts || []).find(c => c.symbol === symbol) || {};
  const volumePlace = Number(contract.volumePlace);
  const pricePlace = Number(contract.pricePlace);
  return {
    sizeMultiplier: Number(contract.sizeMultiplier) || null,
    minTradeNum: Number(contract.minTradeNum) || null,
    volumePlace: Number.isFinite(volumePlace) ? volumePlace : 8,
    pricePlace: Number.isFinite(pricePlace) ? pricePlace : 8,
  };
};

let binanceContractsPromise = null;
const getBinanceRules = async symbol => {
  if (!binanceContractsPromise) binanceContractsPromise = getBinanceContracts();
  const contracts = await binanceContractsPromise;
  const contract = (contracts || []).find(c => c.symbol === symbol);
  const filters = Array.isArray(contract?.filters) ? contract.filters : [];
  const findFilter = (...types) => filters.find(f => types.includes(f.filterType));
  const priceFilter = findFilter('PRICE_FILTER');
  const lotFilter = findFilter('LOT_SIZE');
  return {
    pricePrecision: contract?.pricePrecision ?? 8,
    quantityPrecision: contract?.quantityPrecision ?? 8,
    tickSize: Number(priceFilter?.tickSize) || null,
    stepSize: Number(lotFilter?.stepSize) || null,
    minQty: Number(lotFilter?.minQty) || null,
  };
};

const quantizeBitgetSize = (size, rules) => {
  let qty = Number(size);
  if (!(qty > 0)) return 0;
  if (rules.sizeMultiplier > 0) {
    qty = Math.floor(qty / rules.sizeMultiplier + 1e-10) * rules.sizeMultiplier;
  }
  return roundNum(qty, rules.volumePlace);
};

const quantizeBitgetPrice = (price, rules) => roundNum(price, rules.pricePlace);

/**
 * 读取多头持仓数量与均价。
 * @returns {{ ok: boolean, qty?: number, entryPrice?: number, markPrice?: number, holdSide?: string, reason?: string, detail?: string }}
 */
export const fetchLongPosition = async ({ symbol, exchange }) => {
  if (!symbol || !exchange) {
    return { ok: false, reason: 'invalid_row', detail: '缺少币对' };
  }
  if (!isLiveOrderEnabled()) {
    return { ok: false, reason: 'auto_order_disabled', detail: SKIP_REASON_LABEL.auto_order_disabled };
  }

  if (exchange === 'bitget') {
    const result = await getSinglePosition({ symbol });
    if (!result?.ok) {
      return { ok: false, reason: 'query_failed', detail: pickErr(result) || '持仓查询失败' };
    }
    const list = Array.isArray(result.response?.data) ? result.response.data : [];
    const long = list.find(p => {
      const side = String(p.holdSide || '').toLowerCase();
      const size = Math.abs(Number(p.total ?? p.available ?? p.posSize ?? 0));
      return size > 0 && (side === 'long' || side === 'buy');
    });
    if (!long) {
      return { ok: false, reason: 'no_long_position', detail: '无多头持仓' };
    }
    const qty = Math.abs(Number(long.total ?? long.available ?? long.posSize ?? 0));
    const entryPrice = finite(long.openPriceAvg ?? long.averageOpenPrice ?? long.openPriceAvg);
    const markPrice = finite(long.markPrice ?? long.marketPrice);
    return {
      ok: true,
      qty,
      entryPrice,
      markPrice,
      holdSide: String(long.holdSide || 'long').toLowerCase() === 'buy' ? 'buy' : 'long',
    };
  }

  if (exchange === 'binance') {
    const result = await getPositionRisk({ symbol });
    if (!result?.ok) {
      return { ok: false, reason: 'query_failed', detail: pickErr(result) || '持仓查询失败' };
    }
    const list = Array.isArray(result.response) ? result.response : [];
    const long = list.find(p => {
      if (p.symbol !== symbol) return false;
      const amt = Number(p.positionAmt || 0);
      const ps = String(p.positionSide || '').toUpperCase();
      if (ps === 'LONG') return amt > 0;
      if (ps === 'SHORT') return false;
      return amt > 0;
    });
    if (!long) {
      return { ok: false, reason: 'no_long_position', detail: '无多头持仓' };
    }
    return {
      ok: true,
      qty: Math.abs(Number(long.positionAmt || 0)),
      entryPrice: finite(long.entryPrice),
      markPrice: finite(long.markPrice),
      positionSide: String(long.positionSide || '').toUpperCase() === 'LONG' ? 'LONG' : undefined,
    };
  }

  return { ok: false, reason: 'unsupported_exchange', detail: `不支持 ${exchange}` };
};

const buildPlanLevels = (entry, qty0, plan = STRATEGY3_EXIT) => {
  const tps = (plan.tpLegs || []).map((leg, index) => ({
    key: `tp${index + 1}`,
    trigger: entry * (1 + leg.gainPct / 100),
    size: qty0 * (leg.closePct / 100),
    gainPct: leg.gainPct,
    closePct: leg.closePct,
  }));
  const closedFrac = (plan.tpLegs || []).reduce((s, leg) => s + leg.closePct / 100, 0);
  const trailSize = qty0 * Math.max(0, 1 - closedFrac);
  return {
    tps,
    slArmPrice: entry * (1 + plan.slArmPct / 100),
    slStopPrice: entry * (1 + plan.slPricePct / 100),
    trailActivate: entry * (1 + plan.trailArmPct / 100),
    trailCbPct: plan.trailCbPct,
    trailSize,
  };
};

/**
 * 仅挂策略3三档止盈（不做止损 / 追踪）。
 * 入场参考价优先用 row.rangeHigh，否则用持仓均价。
 */
export const placeStrategy3TakeProfitOrders = async row => {
  const symbol = row?.symbol;
  const exchange = row?.exchange;
  if (!symbol || !exchange) {
    return { ok: false, skipped: true, reason: 'invalid_row', detail: '缺少币对' };
  }
  if (!isLiveOrderEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'auto_order_disabled',
      detail: SKIP_REASON_LABEL.auto_order_disabled,
    };
  }

  const pos = await fetchLongPosition({ symbol, exchange });
  if (!pos.ok) {
    return { ok: false, skipped: true, reason: pos.reason, detail: pos.detail };
  }

  const entry =
    finite(row.rangeHigh) > 0 ? Number(row.rangeHigh) : finite(pos.entryPrice);
  if (!(entry > 0) || !(pos.qty > 0)) {
    return { ok: false, skipped: true, reason: 'invalid_range', detail: '入场价或仓位无效' };
  }

  const levels = buildPlanLevels(entry, pos.qty, STRATEGY3_EXIT);
  const submitted = [];
  const failed = [];
  const skipped = [];
  const oid = () => `s3tp${Date.now()}${Math.floor(Math.random() * 1e5)}`.slice(0, 32);

  if (exchange === 'bitget') {
    const rules = await getBitgetRules(symbol);
    const holdSide = pos.holdSide === 'buy' ? 'buy' : 'long';
    for (const leg of levels.tps) {
      const size = quantizeBitgetSize(leg.size, rules);
      const triggerPrice = quantizeBitgetPrice(leg.trigger, rules);
      if (!(size > 0) || (rules.minTradeNum > 0 && size < rules.minTradeNum)) {
        skipped.push({ key: leg.key, detail: `数量过小 ${size}` });
        continue;
      }
      const result = await placeFutureTpslOrder({
        symbol,
        planType: 'profit_plan',
        triggerPrice,
        size,
        holdSide,
        clientOid: oid(),
      });
      if (result?.ok) submitted.push({ key: leg.key, triggerPrice, size, gainPct: leg.gainPct });
      else failed.push({ key: leg.key, detail: pickErr(result) || '止盈提交失败' });
      await sleep(80);
    }
  } else if (exchange === 'binance') {
    const [rules, mode] = await Promise.all([getBinanceRules(symbol), getBinancePositionMode()]);
    const hedgeMode = Boolean(mode?.response?.dualSidePosition);
    const positionSide = hedgeMode ? pos.positionSide || 'LONG' : undefined;

    for (const leg of levels.tps) {
      const quantity = quantizeQuantity(leg.size, rules.stepSize, rules.quantityPrecision);
      const tpPrice =
        rules.tickSize > 0
          ? roundNum(Math.floor(leg.trigger / rules.tickSize + 1e-10) * rules.tickSize, rules.pricePrecision)
          : roundNum(leg.trigger, rules.pricePrecision);
      if (!(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty)) {
        skipped.push({ key: leg.key, detail: `数量过小 ${quantity}` });
        continue;
      }
      const result = await placeFutureQtyTakeProfitAlgo({
        symbol,
        side: 'SELL',
        quantity,
        triggerPrice: tpPrice,
        positionSide,
        clientAlgoId: oid(),
      });
      if (result?.ok) {
        submitted.push({ key: leg.key, triggerPrice: tpPrice, quantity, gainPct: leg.gainPct });
      } else {
        failed.push({ key: leg.key, detail: pickErr(result) || '止盈提交失败' });
      }
      await sleep(80);
    }
  } else {
    return { ok: false, skipped: true, reason: 'unsupported_exchange', detail: `不支持 ${exchange}` };
  }
  const ok = submitted.length > 0 && failed.length === 0;
  const partial = submitted.length > 0 && failed.length > 0;
  // 三档全被数量等规则跳过、无真实失败 → 视为 skipped（调用方勿当失败弹窗）
  if (!submitted.length && !failed.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'all_legs_skipped',
      detail: skipped.length
        ? `止盈跳过 ${skipped.length} 档（${skipped.map(s => s.detail).join('；') || '数量过小等'}）`
        : '无可挂止盈档',
      entry,
      qty: pos.qty,
      submitted,
      failed,
      skipped,
      plan: STRATEGY3_EXIT,
      exchange,
      symbol,
    };
  }
  return {
    ok: ok || partial,
    partial,
    reason: ok ? null : failed[0]?.key || 'submit_failed',
    detail: ok
      ? `${STRATEGY3_EXIT.label} 止盈已挂 ${submitted.length} 笔`
      : `止盈成功 ${submitted.length} · 失败 ${failed.length} · 跳过 ${skipped.length}`,
    entry,
    qty: pos.qty,
    submitted,
    failed,
    skipped,
    plan: STRATEGY3_EXIT,
    exchange,
    symbol,
  };
};

/**
 * 对已有多仓按策略3挂出场委托：三档止盈 +（达武装点则）保本全仓止损 + 追踪止盈。
 * 入场参考价优先用 row.rangeHigh（与回测上沿对齐），否则用持仓均价。
 */
export const placeStrategy3ExitOrders = async row => {
  const symbol = row?.symbol;
  const exchange = row?.exchange;
  if (!symbol || !exchange) {
    return { ok: false, skipped: true, reason: 'invalid_row', detail: '缺少币对' };
  }
  if (!isLiveOrderEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'auto_order_disabled',
      detail: SKIP_REASON_LABEL.auto_order_disabled,
    };
  }

  const pos = await fetchLongPosition({ symbol, exchange });
  if (!pos.ok) {
    return { ok: false, skipped: true, reason: pos.reason, detail: pos.detail };
  }

  const entry =
    finite(row.rangeHigh) > 0 ? Number(row.rangeHigh) : finite(pos.entryPrice);
  if (!(entry > 0) || !(pos.qty > 0)) {
    return { ok: false, skipped: true, reason: 'invalid_range', detail: '入场价或仓位无效' };
  }

  const levels = buildPlanLevels(entry, pos.qty, STRATEGY3_EXIT);
  const mark = finite(pos.markPrice);
  const submitted = [];
  const failed = [];
  const skipped = [];
  const oid = () => `s3${Date.now()}${Math.floor(Math.random() * 1e5)}`.slice(0, 32);

  if (exchange === 'bitget') {
    const rules = await getBitgetRules(symbol);
    const holdSide = pos.holdSide === 'buy' ? 'buy' : 'long';

    for (const leg of levels.tps) {
      const size = quantizeBitgetSize(leg.size, rules);
      const triggerPrice = quantizeBitgetPrice(leg.trigger, rules);
      if (!(size > 0) || (rules.minTradeNum > 0 && size < rules.minTradeNum)) {
        skipped.push({ key: leg.key, detail: `数量过小 ${size}` });
        continue;
      }
      const result = await placeFutureTpslOrder({
        symbol,
        planType: 'profit_plan',
        triggerPrice,
        size,
        holdSide,
        clientOid: oid(),
      });
      if (result?.ok) submitted.push({ key: leg.key, triggerPrice, size });
      else failed.push({ key: leg.key, detail: pickErr(result) || '止盈提交失败' });
      await sleep(80);
    }

    // 止损：已达武装点才挂保本全仓止损
    if (mark != null && mark >= levels.slArmPrice) {
      const triggerPrice = quantizeBitgetPrice(levels.slStopPrice, rules);
      const result = await placeFuturePosStopLoss({
        symbol,
        triggerPrice,
        holdSide,
        clientOid: oid(),
      });
      if (result?.ok) submitted.push({ key: 'sl', triggerPrice });
      else failed.push({ key: 'sl', detail: pickErr(result) || '止损提交失败' });
      await sleep(80);
    } else {
      skipped.push({
        key: 'sl',
        detail: `未达止损武装点(+${STRATEGY3_EXIT.slArmPct}%)，暂不挂保本止损`,
      });
    }

    const trailSize = quantizeBitgetSize(levels.trailSize, rules);
    const activate = quantizeBitgetPrice(levels.trailActivate, rules);
    if (!(trailSize > 0) || (rules.minTradeNum > 0 && trailSize < rules.minTradeNum)) {
      skipped.push({ key: 'trail', detail: `追踪数量过小 ${trailSize}` });
    } else {
      const result = await placeFutureTpslOrder({
        symbol,
        planType: 'moving_plan',
        triggerPrice: activate,
        size: trailSize,
        callbackRatio: String(STRATEGY3_EXIT.trailCbPct),
        holdSide,
        clientOid: oid(),
      });
      if (result?.ok) {
        submitted.push({
          key: 'trail',
          activate,
          size: trailSize,
          callbackRatio: STRATEGY3_EXIT.trailCbPct,
        });
      } else {
        failed.push({ key: 'trail', detail: pickErr(result) || '追踪止盈提交失败' });
      }
    }
  } else if (exchange === 'binance') {
    const [rules, mode] = await Promise.all([getBinanceRules(symbol), getBinancePositionMode()]);
    const hedgeMode = Boolean(mode?.response?.dualSidePosition);
    const positionSide = hedgeMode ? pos.positionSide || 'LONG' : undefined;

    for (const leg of levels.tps) {
      const quantity = quantizeQuantity(leg.size, rules.stepSize, rules.quantityPrecision);
      // 止盈卖出触发价向下取整，避免抬高
      const tpPrice =
        rules.tickSize > 0
          ? roundNum(Math.floor(leg.trigger / rules.tickSize + 1e-10) * rules.tickSize, rules.pricePrecision)
          : roundNum(leg.trigger, rules.pricePrecision);
      if (!(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty)) {
        skipped.push({ key: leg.key, detail: `数量过小 ${quantity}` });
        continue;
      }
      const result = await placeFutureQtyTakeProfitAlgo({
        symbol,
        side: 'SELL',
        quantity,
        triggerPrice: tpPrice,
        positionSide,
        clientAlgoId: oid(),
      });
      if (result?.ok) submitted.push({ key: leg.key, triggerPrice: tpPrice, quantity });
      else failed.push({ key: leg.key, detail: pickErr(result) || '止盈提交失败' });
      await sleep(80);
    }

    if (mark != null && mark >= levels.slArmPrice) {
      const stopPrice =
        rules.tickSize > 0
          ? roundNum(Math.floor(levels.slStopPrice / rules.tickSize + 1e-10) * rules.tickSize, rules.pricePrecision)
          : roundNum(levels.slStopPrice, rules.pricePrecision);
      const result = await placeFutureClosePositionAlgo({
        symbol,
        side: 'SELL',
        triggerPrice: stopPrice,
        orderType: 'STOP_MARKET',
        positionSide,
        clientAlgoId: oid(),
      });
      if (result?.ok) submitted.push({ key: 'sl', triggerPrice: stopPrice });
      else {
        // 回退：按数量止损
        const quantity = quantizeQuantity(pos.qty, rules.stepSize, rules.quantityPrecision);
        const fallback = await placeFutureQtyStopAlgo({
          symbol,
          side: 'SELL',
          quantity,
          triggerPrice: stopPrice,
          positionSide,
          clientAlgoId: oid(),
        });
        if (fallback?.ok) submitted.push({ key: 'sl', triggerPrice: stopPrice, quantity });
        else failed.push({ key: 'sl', detail: pickErr(result) || pickErr(fallback) || '止损提交失败' });
      }
      await sleep(80);
    } else {
      skipped.push({
        key: 'sl',
        detail: `未达止损武装点(+${STRATEGY3_EXIT.slArmPct}%)，暂不挂保本止损`,
      });
    }

    // Binance callbackRate 上限 10；策略 12% → 夹到 10 并注明
    const cbRate = Math.min(10, Math.max(0.1, Number(STRATEGY3_EXIT.trailCbPct)));
    let activatePrice =
      rules.tickSize > 0
        ? roundNum(Math.ceil(levels.trailActivate / rules.tickSize - 1e-10) * rules.tickSize, rules.pricePrecision)
        : roundNum(levels.trailActivate, rules.pricePrecision);
    if (mark != null && activatePrice <= mark) {
      // 已越过武装点：激活价须高于最新价，否则 -2021
      const bumped = mark * 1.001;
      activatePrice =
        rules.tickSize > 0
          ? roundNum(Math.ceil(bumped / rules.tickSize - 1e-10) * rules.tickSize, rules.pricePrecision)
          : roundNum(bumped, rules.pricePrecision);
    }
    const trailQty = quantizeQuantity(levels.trailSize, rules.stepSize, rules.quantityPrecision);
    if (!(trailQty > 0) || (rules.minQty > 0 && trailQty < rules.minQty)) {
      skipped.push({ key: 'trail', detail: `追踪数量过小 ${trailQty}` });
    } else {
      const result = await placeFutureTrailingStopAlgo({
        symbol,
        side: 'SELL',
        quantity: trailQty,
        activatePrice,
        callbackRate: cbRate,
        positionSide,
        clientAlgoId: oid(),
      });
      if (result?.ok) {
        submitted.push({
          key: 'trail',
          activatePrice,
          quantity: trailQty,
          callbackRate: cbRate,
          note: cbRate < STRATEGY3_EXIT.trailCbPct ? `交易所上限，回撤用 ${cbRate}%` : undefined,
        });
      } else {
        failed.push({ key: 'trail', detail: pickErr(result) || '追踪止盈提交失败' });
      }
    }
  } else {
    return { ok: false, skipped: true, reason: 'unsupported_exchange', detail: `不支持 ${exchange}` };
  }

  const ok = submitted.length > 0 && failed.length === 0;
  const partial = submitted.length > 0 && failed.length > 0;
  return {
    ok: ok || partial,
    partial,
    reason: ok ? null : failed[0]?.key || 'submit_failed',
    detail: ok
      ? `${STRATEGY3_EXIT.label} 已挂 ${submitted.length} 笔`
      : `成功 ${submitted.length} · 失败 ${failed.length} · 跳过 ${skipped.length}`,
    entry,
    qty: pos.qty,
    submitted,
    failed,
    skipped,
    plan: STRATEGY3_EXIT,
    exchange,
    symbol,
  };
};

export const placeStrategy3ExitOrdersBatch = async (rows, { onProgress } = {}) => {
  const summary = { total: rows.length, ok: 0, skipped: 0, failed: 0, partial: 0, results: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await placeStrategy3ExitOrders(row);
    summary.results.push({ row, result });
    if (result.ok && !result.partial) summary.ok += 1;
    else if (result.partial) summary.partial += 1;
    else if (result.skipped) summary.skipped += 1;
    else summary.failed += 1;
    onProgress?.({ index: i, row, result, summary: { ...summary } });
    await sleep(120);
  }
  return summary;
};
