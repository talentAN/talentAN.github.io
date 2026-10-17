/**
 * 横盘监控：仓位 / 委托相关的纯判断工具。
 *
 * 约定：
 * - 本文件只做「读状态 → 布尔 / 列表 / 档位」判断，不发起下单、撤单、写缓存副作用。
 * - 多仓 / 空仓止盈档位独立：多仓仍为 1.2 / 1.5 / 2.0；空仓为 0.8E / 0.7E + 0.75E 追踪。
 */

import {
  RANGE_MONITOR_LONG_TP_MULTS,
  RANGE_MONITOR_LONG_TRAIL_ARM_MULT,
  RANGE_MONITOR_SHORT_TP_MULTS,
  RANGE_MONITOR_SHORT_TRAIL_ARM_PRICE_MULT,
  RANGE_MONITOR_SL_ARM_MULT,
} from './_rangeMonitorParams';

/** 按持仓方向取固定止盈档位表。 */
export const tpTiersForDirection = direction =>
  direction === 'SHORT' ? RANGE_MONITOR_SHORT_TP_MULTS : RANGE_MONITOR_LONG_TP_MULTS;

/** 一档武装滞后：多仓 last ≥ entry×该值才允许挂一档（相对开仓价 +2%）。 */
const FIRST_TIER_ARM_MULT = 1.02;
/** 一档撤单滞后：多仓 last ≤ entry×该值应撤一档（相对开仓价 −2%）。 */
const FIRST_TIER_CANCEL_MULT = 0.98;

const finite = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─────────────────────────────────────────────
// 仓位方向
// ─────────────────────────────────────────────

/** 持仓方向：仅当 positionSide=SHORT 视为空，其余一律按多处理（含 BOTH）。 */
export const positionDirection = pos =>
  String(pos?.positionSide || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';

/**
 * UI「多/空」或 LONG/SHORT → 引擎方向。
 * 单向持仓 positionSide=BOTH 时，应用持仓符号方向（多/空），勿直接喂 BOTH 给 positionDirection。
 */
export const directionFromUiSide = side => {
  const s = String(side || '').toUpperCase();
  return s === '空' || s === 'SHORT' ? 'SHORT' : 'LONG';
};

/** 是否为空仓。 */
export const isShortPosition = pos => positionDirection(pos) === 'SHORT';

/** 平仓侧：多仓平仓卖、空仓平仓买。 */
export const exitOrderSide = pos => (positionDirection(pos) === 'SHORT' ? 'BUY' : 'SELL');

/**
 * 按持仓方向选价格：多仓用 longPrice，空仓用 shortPrice。
 */
export const directionalPrice = (pos, longPrice, shortPrice) =>
  isShortPosition(pos) ? shortPrice : longPrice;

/**
 * 档位 → 触发价：
 * - 多仓：entry × tier.mult（1.2 / 1.5 / 2.0）
 * - 空仓：entry × tier.priceMult（0.8 / 0.7）
 */
export const tierTriggerPrice = (entry, tier, direction = 'LONG') => {
  const e = Number(entry);
  if (!(e > 0) || !tier) return null;
  if (direction === 'SHORT') {
    const pm = Number(tier.priceMult);
    return pm > 0 ? e * pm : null;
  }
  const m = Number(tier.mult);
  return m > 0 ? e * m : null;
};

/**
 * @deprecated 多仓可用 entry×mult；空仓请用 tierTriggerPrice（空仓不再走 2−mult）。
 */
export const gainTargetPrice = (entry, mult, direction = 'LONG') => {
  const e = Number(entry);
  const m = Number(mult);
  if (!(e > 0) || !(m > 0)) return null;
  return direction === 'SHORT' ? e * (2 - m) : e * m;
};

/**
 * 开仓后有利极值已实现的等价倍数（与档位 tier.mult 对齐）：
 * - 多仓：xx / entry
 * - 空仓：2 − xx / entry（xx=0.8E → 1.2；xx=0.7E → 1.3）
 */
export const calcMoveRatio = (entry, xx, direction) => {
  const e = Number(entry);
  const x = Number(xx);
  if (!(e > 0) || !(x > 0)) return null;
  return direction === 'SHORT' ? 2 - x / e : x / e;
};

/** 有利极值是否已达到指定收益倍数（如 1.2 = 盈利 20%）。 */
export const hasReachedGainMult = (entry, xx, direction, mult) => {
  const ratio = calcMoveRatio(entry, xx, direction);
  return ratio != null && ratio >= mult;
};

/** 是否已达到该方向的追踪止盈武装点（多 1.4E / 空 0.75E）。 */
export const hasReachedTrailArm = (entry, xx, direction) => {
  const e = Number(entry);
  const x = Number(xx);
  if (!(e > 0) || !(x > 0)) return false;
  if (direction === 'SHORT') return x <= e * RANGE_MONITOR_SHORT_TRAIL_ARM_PRICE_MULT;
  return x >= e * RANGE_MONITOR_LONG_TRAIL_ARM_MULT;
};

/** 追踪激活价原始值（未按 tick 取整）：多 entry×1.4，空 entry×0.75。 */
export const trailActivateRawPrice = (entry, direction) => {
  const e = Number(entry);
  if (!(e > 0)) return null;
  return direction === 'SHORT'
    ? e * RANGE_MONITOR_SHORT_TRAIL_ARM_PRICE_MULT
    : e * RANGE_MONITOR_LONG_TRAIL_ARM_MULT;
};

// ─────────────────────────────────────────────
// 条件单字段 / 类型识别
// ─────────────────────────────────────────────

/** 从条件单记录中提取触发价、止损价、追踪激活价；旧接口可能只剩 price。 */
export const algoTriggerPrice = o =>
  finite(o?.triggerPrice) ??
  finite(o?.stopPrice) ??
  finite(o?.activatePrice) ??
  finite(o?.price) ??
  null;

/**
 * 两价是否视为同一档触发价。
 * 相对误差 ≤ 1%（相对两者较大值）即算同一档。
 * `tickSize` 保留入参以兼容调用方，不再参与判定。
 */
export const pricesMatchTier = (trigger, target, tickSize) => {
  const a = Number(trigger);
  const b = Number(target);
  if (!(a > 0) || !(b > 0)) return false;
  void tickSize;
  return Math.abs(a - b) <= Math.max(a, b) * 0.01;
};

/**
 * 判断 Binance 条件单是否为指定方向的止损单。
 * 排除止盈、追踪，以及反向 positionSide。
 */
export const isBinanceStopAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const type = String(o?.type || o?.orderType || '').toUpperCase();
  if (!type.includes('STOP') || type.includes('TAKE_PROFIT') || type.includes('TRAILING'))
    return false;
  return (
    String(o?.positionSide || '').toUpperCase() !== (positionSide === 'SHORT' ? 'LONG' : 'SHORT')
  );
};

/** 条件单是否明确声明 closePosition（币安 UI 数量列「全部平仓」）。 */
export const isClosePositionAlgo = o => {
  const raw = o?.closePosition ?? o?.cp;
  return raw === true || String(raw).toLowerCase() === 'true';
};

/**
 * 明确的按数量止损（旧回退形态）。closePosition 缺失但带正数量的全平回包不算，
 * 避免误撤交易所已挂的全部平仓单。
 */
export const isQtyBasedStopAlgo = o => {
  if (isClosePositionAlgo(o)) return false;
  if (o?._rememberedAt) return false; // 本地影子单，不可当交易所数量单去撤
  const raw = o?.closePosition ?? o?.cp;
  if (raw === false || String(raw).toLowerCase() === 'false') {
    const q = Number(o?.quantity ?? o?.origQty);
    return Number.isFinite(q) && q > 0;
  }
  const reduceOnly =
    o?.reduceOnly === true || String(o?.reduceOnly).toLowerCase() === 'true';
  const q = Number(o?.quantity ?? o?.origQty);
  return reduceOnly && Number.isFinite(q) && q > 0;
};

/** 止损触发价是否等于开仓价（成本价止损；含误挂的按数量单，引擎会改挂全平）。 */
export const isBreakevenStopAlgo = (o, entry, tickSize, positionSide = 'LONG') =>
  isBinanceStopAlgo(o, positionSide) && pricesMatchTier(algoTriggerPrice(o), entry, tickSize);

/** 成本价 + closePosition 全仓止损（目标形态）。 */
export const isBreakevenClosePositionStopAlgo = (o, entry, tickSize, positionSide = 'LONG') =>
  isBreakevenStopAlgo(o, entry, tickSize, positionSide) && isClosePositionAlgo(o);

/** 是否为指定方向的止盈条件单（非追踪）。 */
export const isBinanceTakeProfitAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const blob =
    `${o?.type || ''} ${o?.orderType || ''} ${o?.origType || ''} ${o?.algoType || ''}`.toUpperCase();
  return blob.includes('TAKE_PROFIT') && !blob.includes('TRAILING');
};

/**
 * 旧版/代理返回可能缺少类型字段时，按客户端 ID 识别本系统止盈单
 *（策略3 s3tp / 横盘监控 rmtp / 持仓监控 pmtp）。
 */
export const isRangeMonitorTpClientId = order =>
  /(?:^|_)s3tp|(?:^|_)rmtp|(?:^|_)pmtp/i.test(
    String(order?.clientAlgoId || order?.clientOrderId || '')
  );

/**
 * 止盈单识别：类型字段命中，或（方向正确且）客户端 ID 兜底。
 * 持仓监控页与引擎筛 TP 时共用。
 */
export const isBinanceTakeProfitOrder = (o, positionSide = 'LONG') => {
  if (isBinanceTakeProfitAlgo(o, positionSide)) return true;
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  return isRangeMonitorTpClientId(o);
};

/** 是否为指定方向的追踪止盈条件单。 */
export const isBinanceTrailingAlgo = (o, positionSide = 'LONG') => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== (positionSide === 'SHORT' ? 'BUY' : 'SELL')) return false;
  const blob =
    `${o?.type || ''} ${o?.orderType || ''} ${o?.origType || ''} ${o?.algoType || ''}`.toUpperCase();
  return blob.includes('TRAILING');
};

/**
 * 是否为「出场类」委托（孤儿清理用）。
 * 注意：开多突破也是 STOP_MARKET + BUY，绝不能只凭 type 含 STOP 就当作出场。
 */
export const isExitOrderForPosition = order => {
  const clientId = String(order?.clientAlgoId || order?.clientOrderId || order?.clientOid || '');
  // 横盘开多突破单
  if (/^lvb/i.test(clientId)) return false;

  const type =
    `${order?.type || ''} ${order?.orderType || ''} ${order?.origType || ''} ${order?.algoType || ''}`.toUpperCase();
  const reduceOnly =
    order?.reduceOnly === true || String(order?.reduceOnly).toLowerCase() === 'true';
  const closePosition =
    order?.closePosition === true || String(order?.closePosition).toLowerCase() === 'true';

  if (reduceOnly || closePosition) return true;
  if (type.includes('TAKE_PROFIT') || type.includes('TRAILING')) return true;

  // 止损：STOP 且方向为平仓向（多=SELL / 空=BUY）；开多 STOP_MARKET+BUY 排除
  if (type.includes('STOP') && !type.includes('TAKE_PROFIT')) {
    if (isBinanceStopAlgo(order, 'LONG') || isBinanceStopAlgo(order, 'SHORT')) return true;
    return false;
  }
  return false;
};

/** 下单数量是否过小（≤0，或低于合约 minQty）。 */
export const isQtyTooSmall = (quantity, rules) =>
  !(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty);

// ─────────────────────────────────────────────
// 止盈档位：本地缓存（只读判断）
// ─────────────────────────────────────────────

/** 本地止盈档位缓存的 key：exchange:SYMBOL:POSITION_SIDE */
export const tpCacheKey = pos =>
  `${pos.exchange}:${String(pos.symbol).toUpperCase()}:${String(pos.positionSide || 'BOTH').toUpperCase()}`;

/** 本地缓存是否记录过该持仓已下过指定档止盈（key 如 tp120）。 */
export const tpCacheHas = (cache, pos, tierKey) =>
  Array.isArray(cache[tpCacheKey(pos)]) && cache[tpCacheKey(pos)].includes(tierKey);

// ─────────────────────────────────────────────
// 止盈档位：现场委托匹配
// ─────────────────────────────────────────────

/**
 * 从止盈单列表中筛出触发价匹配目标价的委托。
 * @param {object[]} tpOrders 已按方向筛过的止盈单
 * @param {number} targetTrigger 目标触发价
 * @param {number} tickSize
 */
export const filterTpOrdersAtTrigger = (tpOrders, targetTrigger, tickSize) =>
  (tpOrders || []).filter(o => pricesMatchTier(algoTriggerPrice(o), targetTrigger, tickSize));

/** 当前是否已有触发价匹配目标档的止盈委托（现场挂着）。 */
export const hasTpOrderAtTrigger = (tpOrders, targetTrigger, tickSize) =>
  (tpOrders || []).some(o => pricesMatchTier(algoTriggerPrice(o), targetTrigger, tickSize));

/**
 * 按档位对象计算目标触发价（多走 mult，空走 priceMult）。
 * @param {object} pos
 * @param {number} entry
 * @param {object} tier
 */
export const tierTargetTrigger = (pos, entry, tier) =>
  tierTriggerPrice(entry, tier, positionDirection(pos));

/**
 * 判断指定档止盈是否「已下过 / 仍挂着」——引擎跳过重挂的口径：
 * 本地缓存有该档记录，或现场有匹配触发价的止盈单。
 */
export const hasTierTakeProfitPlaced = ({
  tpOrders,
  targetTrigger,
  tickSize,
  tpOrderCache,
  pos,
  tierKey,
}) =>
  tpCacheHas(tpOrderCache, pos, tierKey) || hasTpOrderAtTrigger(tpOrders, targetTrigger, tickSize);

/**
 * 推断指定档止盈是否已经成交（或至少已不在挂单簿上）。
 *
 * 口径：本地缓存记录过该档曾挂出，但当前止盈列表里已无匹配触发价的单。
 * 注意：撤单、成交、交易所侧消失在此无法区分；引擎用「已处理勿重挂」时
 * 走 `hasTierTakeProfitPlaced`，本函数仅表达「曾挂过且现场已无单」。
 */
export const isTierTakeProfitLikelyFilled = ({
  tpOrders,
  targetTrigger,
  tickSize,
  tpOrderCache,
  pos,
  tierKey,
}) =>
  tpCacheHas(tpOrderCache, pos, tierKey) && !hasTpOrderAtTrigger(tpOrders, targetTrigger, tickSize);

// ─────────────────────────────────────────────
// 一档专用判断（多 tp120 / 空 stp80）
// ─────────────────────────────────────────────

/** 一档目标触发价：多 entry×1.2，空 entry×0.8。 */
export const firstTierTargetTrigger = (pos, entry) => {
  const direction = positionDirection(pos);
  const firstTier = tpTiersForDirection(direction)[0];
  return tierTriggerPrice(entry, firstTier, direction);
};

/**
 * 是否已经挂着一档止盈委托（触发价对齐一档目标）。
 * 对应引擎里的 `exactFirst.length > 0`。
 */
export const hasFirstTierTakeProfitOrder = (tpOrders, pos, entry, tickSize) =>
  hasTpOrderAtTrigger(tpOrders, firstTierTargetTrigger(pos, entry), tickSize);

/** 列出所有匹配一档触发价的止盈委托（用于去重：只留第一笔）。 */
export const listFirstTierTakeProfitOrders = (tpOrders, pos, entry, tickSize) =>
  filterTpOrdersAtTrigger(tpOrders, firstTierTargetTrigger(pos, entry), tickSize);

/**
 * 现价是否允许挂一档（±2% 滞后）：
 * - 多：last ≥ entry×1.02
 * - 空：last ≤ entry×0.98
 */
export const shouldArmFirstTier = (direction, entry, last) =>
  direction === 'SHORT'
    ? last <= entry * FIRST_TIER_CANCEL_MULT
    : last >= entry * FIRST_TIER_ARM_MULT;

/**
 * 现价是否应撤掉一档（±2% 滞后）：
 * - 多：last ≤ entry×0.98
 * - 空：last ≥ entry×1.02
 */
export const shouldCancelFirstTier = (direction, entry, last) =>
  direction === 'SHORT'
    ? last >= entry * FIRST_TIER_ARM_MULT
    : last <= entry * FIRST_TIER_CANCEL_MULT;

/**
 * 推断一档止盈是否已成交（缓存有 tp120，现场已无一档匹配单）。
 * @see isTierTakeProfitLikelyFilled
 */
export const isFirstTierTakeProfitLikelyFilled = ({
  tpOrders,
  pos,
  entry,
  tickSize,
  tpOrderCache,
}) => {
  const direction = positionDirection(pos);
  const firstTier = tpTiersForDirection(direction)[0];
  return isTierTakeProfitLikelyFilled({
    tpOrders,
    targetTrigger: firstTierTargetTrigger(pos, entry),
    tickSize,
    tpOrderCache,
    pos,
    tierKey: firstTier.key,
  });
};

// ─────────────────────────────────────────────
// 档位选择 / 阶段门槛
// ─────────────────────────────────────────────

/**
 * 按开仓后极值已实现收益倍数选择当前应维护的固定止盈档。
 * 规则：moveRatio < 该档 mult 时维护该档；超过最后一档则不再挂固定止盈。
 * - 多：<1.2 → 1.2E；<1.5 → 1.5E；<2.0 → 2.0E
 * - 空：<1.2 → 0.8E；<1.3 → 0.7E
 */
export const selectWantedTpTier = (entry, xx, direction = 'LONG') => {
  const tiers = tpTiersForDirection(direction);
  const moveRatio = calcMoveRatio(entry, xx, direction);
  if (moveRatio == null) return tiers[0] || null;
  for (const tier of tiers) {
    if (moveRatio < tier.mult) return tier;
  }
  return null;
};

/** 是否仍处在「一档动态维护」阶段（moveRatio < SL_ARM，且尚无追踪单）。 */
export const isInFirstTierDynamicPhase = (moveRatio, trailOrders) =>
  moveRatio != null && moveRatio < RANGE_MONITOR_SL_ARM_MULT && !(trailOrders || []).length;

/** 是否已达到可挂二档固定止盈的阶段（moveRatio ≥ SL_ARM）。 */
export const isInFixedTpPhase = moveRatio =>
  moveRatio != null && moveRatio >= RANGE_MONITOR_SL_ARM_MULT;

/** 当前是否已有任意止盈委托。 */
export const hasAnyTakeProfitOrder = tpOrders => (tpOrders || []).length > 0;

/** 当前是否已有止损委托。 */
export const hasAnyStopOrder = stopOrders => (stopOrders || []).length > 0;

/** 当前是否已有追踪止盈委托。 */
export const hasAnyTrailingOrder = trailOrders => (trailOrders || []).length > 0;

/** 当前是否已有成本价全仓止损。 */
export const hasAnyBreakevenStop = breakevenStops => (breakevenStops || []).length > 0;

/** 开仓后有利方向极值是否已达到指定收益倍数（moveRatio ≥ mult）。 */
export const hasCrossedGainMult = (moveRatio, mult) =>
  moveRatio != null && Number.isFinite(moveRatio) && moveRatio >= mult;

/**
 * 持仓监控：单档止盈状态。
 * @returns {'placed'|'filled'|'pending'}
 */
export const classifyTpTierStatus = ({ tpOrders, pos, entry, tier, moveRatio, tickSize }) => {
  if (!tier) return 'pending';
  const direction = positionDirection(pos);
  const target = tierTriggerPrice(entry, tier, direction);
  if (hasTpOrderAtTrigger(tpOrders, target, tickSize)) return 'placed';
  if (hasCrossedGainMult(moveRatio, tier.mult)) return 'filled';
  return 'pending';
};

/**
 * 持仓监控：追踪委托状态。
 * @returns {'placed'|'filled'|'pending'}
 */
export const classifyTrailStatus = ({ trailOrders, entry, xx, direction }) => {
  if (hasAnyTrailingOrder(trailOrders)) return 'placed';
  if (hasReachedTrailArm(entry, xx, direction)) return 'filled';
  return 'pending';
};

/**
 * 持仓监控：成本止损状态（有追踪则视为已由追踪接管）。
 * @returns {'tracked'|'placed'|'missing'|'pending'}
 */
export const classifyBreakevenStopStatus = ({
  trailOrders,
  breakevenStops,
  moveRatio,
  armMult = RANGE_MONITOR_SL_ARM_MULT,
}) => {
  if (hasAnyTrailingOrder(trailOrders)) return 'tracked';
  if (hasAnyBreakevenStop(breakevenStops)) return 'placed';
  if (hasCrossedGainMult(moveRatio, armMult)) return 'missing';
  return 'pending';
};
