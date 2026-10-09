/**
 * 暴涨监控 · 币安空头止盈（按 zz 互斥区间武装）
 *
 * zz = min(a, b)
 *   a：开仓后 +1h → 上一根完整小时 K 的最低价（无完整小时则为 null）
 *   b：最新价
 *
 * 区间（互斥；「无止盈」时才挂固定止盈）：
 *   zz > 0.8E              → TP@0.8E 平 25%
 *   0.7E < zz ≤ 0.8E       → TP@0.7E 平 25%
 *   0.5E < zz ≤ 0.7E       → TP@0.5E 平 30% + 追踪 15%（无追踪才挂）
 *   zz ≤ 0.5E              → 无止盈且无追踪 → 只挂追踪 15% 平仓
 *
 * 追踪 callbackRate：策略要 15%，币安常见上限 10 → 夹到 10 并在 tip 注明。
 */

import { getFutureKlineData } from '@root/src/container/market';
import { getContracts } from '@root/src/container/binance/api';
import { getPositionMode } from '@root/src/container/binance/api/query';
import {
  placeFutureQtyTakeProfitAlgo,
  placeFutureTrailingStopAlgo,
} from '@root/src/container/binance/api/order';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import {
  getBinanceAccountSnapshot,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import { withMarketFetchGate, waitBinanceBanIfNeeded } from '../_marketFetchGate';
import { getSharedMiniTickerFeed } from '../low_vol_range_blast/_rangeMonitorPriceFeed';
import { isLiveOrderEnabled, quantizeQuantity } from './_autoOrderModel';
import {
  SURGE_SHORT_EXIT_HOUR_MS as HOUR_MS,
  SURGE_SHORT_EXIT_TRAIL_CALLBACK_WANTED as TRAIL_CB_WANTED,
  SURGE_SHORT_EXIT_TRAIL_CALLBACK_BINANCE_MAX as TRAIL_CB_BN_MAX,
  SURGE_SHORT_EXIT_BANDS as BANDS,
  SURGE_SHORT_EXIT_PLACE_GAP_MS as PLACE_GAP_MS,
} from './_surgeShortExitParams';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ZZ_KLINE_CACHE_TTL_MS = 60 * 1000;
const zzKlineCache = new Map();
let zzKlineRequestQueue = Promise.resolve();

const enqueueZzKline = task => {
  const run = zzKlineRequestQueue.then(task, task);
  zzKlineRequestQueue = run.catch(() => undefined);
  return run;
};

const roundNum = (n, digits = 8) => Number(Number(n).toFixed(digits));

const floorToTick = (price, rules) => {
  if (!(price > 0)) return 0;
  if (!(rules.tickSize > 0)) return roundNum(price, rules.pricePrecision);
  return roundNum(Math.floor(price / rules.tickSize + 1e-10) * rules.tickSize, rules.pricePrecision);
};

const pickErr = result =>
  result?.response?.msg ||
  result?.response?.message ||
  result?.error ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

let contractsPromise = null;
let rulesCache = new Map();
let positionModePromise = null;
const getCachedPositionMode = () => {
  if (!positionModePromise) positionModePromise = getPositionMode();
  return positionModePromise;
};
const getRules = async symbol => {
  if (rulesCache.has(symbol)) return rulesCache.get(symbol);
  const rulesPromise = (async () => {
    if (!contractsPromise) contractsPromise = getContracts();
    const contracts = await contractsPromise;
  const contract = (contracts || []).find(c => c.symbol === symbol);
  const filters = Array.isArray(contract?.filters) ? contract.filters : [];
  const find = type => filters.find(f => f.filterType === type);
  const price = find('PRICE_FILTER');
  const lot = find('LOT_SIZE');
    return {
      tickSize: Number(price?.tickSize) || null,
      stepSize: Number(lot?.stepSize) || null,
      minQty: Number(lot?.minQty) || null,
      pricePrecision: contract?.pricePrecision ?? 8,
      quantityPrecision: contract?.quantityPrecision ?? 8,
    };
  })();
  rulesCache.set(symbol, rulesPromise);
  return rulesPromise;
};

const typeBlob = o =>
  `${o?.type || ''} ${o?.orderType || ''} ${o?.origType || ''} ${o?.algoType || ''}`.toUpperCase();

/** 空头固定止盈：BUY + TAKE_PROFIT（非追踪） */
export const isShortTakeProfitOrder = o => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== 'BUY') return false;
  const blob = typeBlob(o);
  if (!blob.includes('TAKE_PROFIT')) return false;
  if (blob.includes('TRAILING')) return false;
  const ps = String(o?.positionSide || '').toUpperCase();
  if (ps === 'LONG') return false;
  return true;
};

/** 空头追踪：BUY + TRAILING */
export const isShortTrailingOrder = o => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== 'BUY') return false;
  const blob = typeBlob(o);
  if (!blob.includes('TRAILING')) return false;
  const ps = String(o?.positionSide || '').toUpperCase();
  if (ps === 'LONG') return false;
  return true;
};

const listShortPositions = rows =>
  (Array.isArray(rows) ? rows : [])
    .map(item => {
      const amt = Number(item.positionAmt || 0);
      const isShort =
        String(item.positionSide || '').toUpperCase() === 'SHORT' || amt < 0;
      if (!isShort) return null;
      const qty = Math.abs(amt);
      if (!(qty > 0)) return null;
      const entryPrice = Number(item.entryPrice);
      if (!(entryPrice > 0)) return null;
      return {
        symbol: String(item.symbol || '').toUpperCase(),
        qty,
        entryPrice,
        // openTime 是账户镜像按持仓生命周期固定的首次获取时间；updateTime 仅兼容旧快照。
        openTimeMs: Number(item.openTime ?? item.updateTime) || 0,
        positionSide: String(item.positionSide || '').toUpperCase() || 'SHORT',
        markPrice: Number(item.markPrice) || null,
      };
    })
    .filter(Boolean);

/**
 * 拉取 zz：a=开仓+1h～上完整小时的 1h 低点；b=ticker 最新价
 */
export const fetchZzSinceOpen = async ({ symbol, openTimeMs, exchange = 'binance' }) => {
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);
  const feed = getSharedMiniTickerFeed();
  feed.start();
  const liveQuote = feed.get(symbol);
  const b = Number(liveQuote?.last);
  if (!(b > 0)) {
    return { zz: null, a: null, b: null, error: '行情 Socket 暂无最新价' };
  }

  if (!(openTimeMs > 0)) {
    return { zz: b, a: null, b, note: '无开仓时间，zz=最新价' };
  }

  const from = openTimeMs + HOUR_MS;
  const prevHourEnd = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 1;
  if (from > prevHourEnd) {
    return { zz: b, a: null, b, note: '尚无完整小时 K，zz=最新价' };
  }

  let candles = [];
  const klineKey = `${symbol}:${openTimeMs}`;
  const cachedKline = zzKlineCache.get(klineKey);
  if (cachedKline && Date.now() - cachedKline.fetchedAt < ZZ_KLINE_CACHE_TTL_MS) {
    const a = cachedKline.low;
    return { zz: Math.min(a, b), a, b, cached: true };
  }
  try {
    await waitBinanceBanIfNeeded(getBinanceBanRemaining);
    const res = await enqueueZzKline(() => withMarketFetchGate(() =>
      getFutureKlineData(
        {
          symbol,
          granularity: '1H',
          startTime: from,
          endTime: prevHourEnd,
          limit: 1500,
        },
        exchange
      )
    ));
    candles = Array.isArray(res?.data) ? res.data : [];
  } catch (e) {
    return { zz: b, a: null, b, note: `小时K失败：${e?.message || e}，zz=最新价` };
  }

  let a = null;
  candles.forEach(c => {
    const low = Number(c[3]);
    if (low > 0 && (a == null || low < a)) a = low;
  });

  if (a == null) {
    return { zz: b, a: null, b, note: '小时K无低点，zz=最新价' };
  }
  zzKlineCache.set(klineKey, { fetchedAt: Date.now(), low: a });
  return { zz: Math.min(a, b), a, b };
}; 

const pickBand = (zz, entry) => {
  const e08 = entry * 0.8;
  const e07 = entry * 0.7;
  const e05 = entry * 0.5;
  if (zz > e08) return { kind: 'tp', ...BANDS.shallow };
  if (zz > e07 && zz <= e08) return { kind: 'tp', ...BANDS.mid };
  if (zz > e05 && zz <= e07) return { kind: 'tp_trail', ...BANDS.deep };
  if (zz <= e05) return { kind: 'trail_only' };
  return { kind: 'none' };
};

const oid = prefix => `${prefix}${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 36);

const placeShortTp = async ({ symbol, qty, entry, ratio, mult, hedgeMode, rules }) => {
  const quantity = quantizeQuantity(qty * ratio, rules.stepSize, rules.quantityPrecision);
  if (!(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty)) {
    return { ok: false, detail: `止盈数量过小 ${quantity}` };
  }
  const triggerPrice = floorToTick(entry * mult, rules);
  if (!(triggerPrice > 0)) {
    return { ok: false, detail: `止盈触发价无效 ${triggerPrice}` };
  }
  const result = await placeFutureQtyTakeProfitAlgo({
    symbol,
    side: 'BUY',
    quantity,
    triggerPrice,
    ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
    clientAlgoId: oid(`stp${String(mult).replace('.', '')}`),
  });
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '止盈提交失败',
    triggerPrice,
    quantity,
    mult,
    ratio,
    result,
  };
};

/** 空头追踪：activatePrice 须低于最新价 */
const placeShortTrail = async ({ symbol, qty, lastPrice, hedgeMode, rules }) => {
  const trailQty = quantizeQuantity(qty, rules.stepSize, rules.quantityPrecision);
  if (!(trailQty > 0) || (rules.minQty > 0 && trailQty < rules.minQty)) {
    return { ok: false, detail: `追踪数量过小 ${trailQty}` };
  }
  const last = Number(lastPrice);
  if (!(last > 0)) return { ok: false, detail: '无最新价，无法挂追踪' };

  let activatePrice = floorToTick(last * 0.999, rules);
  if (!(activatePrice > 0) || activatePrice >= last) {
    activatePrice = floorToTick(last - (rules.tickSize || last * 1e-6), rules);
  }
  if (!(activatePrice > 0) || activatePrice >= last) {
    return { ok: false, detail: `追踪激活价无效 activate=${activatePrice} last=${last}` };
  }

  const cbRate = Math.min(TRAIL_CB_BN_MAX, TRAIL_CB_WANTED);
  const note =
    cbRate < TRAIL_CB_WANTED ? `交易所上限，回撤用 ${cbRate}%（策略 ${TRAIL_CB_WANTED}%）` : undefined;

  const result = await placeFutureTrailingStopAlgo({
    symbol,
    side: 'BUY',
    quantity: trailQty,
    activatePrice,
    callbackRate: cbRate,
    ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
    clientAlgoId: oid('strl'),
  });
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '追踪提交失败',
    activatePrice,
    callbackRate: cbRate,
    quantity: trailQty,
    note,
    result,
  };
};

/**
 * 处理单个空头：按 zz 区间挂止盈 / 追踪。
 * @returns {{ tips: string[], placed: number, skipped: number, failed: number }}
 */
export const processShortExit = async (pos, { hedgeMode, algos = [], orders = [] }) => {
  const tips = [];
  const symbol = pos.symbol;
  const related = [
    ...algos.filter(o => String(o.symbol || '').toUpperCase() === symbol),
    ...orders.filter(o => String(o.symbol || '').toUpperCase() === symbol),
  ];
  const hasTp = related.some(isShortTakeProfitOrder);
  const hasTrail = related.some(isShortTrailingOrder);

  const zzInfo = await fetchZzSinceOpen({
    symbol,
    openTimeMs: pos.openTimeMs,
    exchange: 'binance',
  });
  if (!(zzInfo.zz > 0)) {
    tips.push(`${symbol}：算 zz 失败（${zzInfo.error || '未知'}）`);
    return { tips, placed: 0, skipped: 1, failed: 0 };
  }

  const band = pickBand(zzInfo.zz, pos.entryPrice);
  const rules = await getRules(symbol);
  const zzLabel = `zz=${zzInfo.zz.toPrecision(6)} E=${pos.entryPrice.toPrecision(6)}`;

  if (band.kind === 'none') {
    tips.push(`${symbol}：${zzLabel} 无匹配区间`);
    return { tips, placed: 0, skipped: 1, failed: 0 };
  }

  if (band.kind === 'trail_only') {
    if (hasTp || hasTrail) {
      tips.push(
        `${symbol}：zz≤0.5E 已有止盈/追踪，跳过（${zzLabel}${hasTp ? ' ·有TP' : ''}${
          hasTrail ? ' ·有追踪' : ''
        }）`
      );
      return { tips, placed: 0, skipped: 1, failed: 0 };
    }
    const trail = await placeShortTrail({
      symbol,
      qty: pos.qty,
      lastPrice: zzInfo.b || pos.markPrice,
      hedgeMode,
      rules,
    });
    if (trail.ok) {
      tips.push(
        `${symbol}：zz≤0.5E 已挂追踪${trail.callbackRate}% 量${trail.quantity}${
          trail.note ? `（${trail.note}）` : ''
        }`
      );
      return { tips, placed: 1, skipped: 0, failed: 0 };
    }
    tips.push(`${symbol}：zz≤0.5E 追踪失败：${trail.detail}`);
    return { tips, placed: 0, skipped: 0, failed: 1 };
  }

  // 固定止盈档（含 deep 的 TP+追踪）
  let placed = 0;
  let failed = 0;
  let skipped = 0;

  if (hasTp) {
    tips.push(`${symbol}：${zzLabel} 区间×${band.mult} 已有止盈，跳过 TP`);
    skipped += 1;
  } else {
    const tp = await placeShortTp({
      symbol,
      qty: pos.qty,
      entry: pos.entryPrice,
      ratio: band.ratio,
      mult: band.mult,
      hedgeMode,
      rules,
    });
    if (tp.ok) {
      placed += 1;
      tips.push(
        `${symbol}：挂 TP@×${band.mult} 平${(band.ratio * 100).toFixed(0)}% @${tp.triggerPrice}（${zzLabel}）`
      );
    } else {
      failed += 1;
      tips.push(`${symbol}：TP@×${band.mult} 失败：${tp.detail}（${zzLabel}）`);
    }
    await sleep(PLACE_GAP_MS);
  }

  if (band.kind === 'tp_trail') {
    if (hasTrail) {
      tips.push(`${symbol}：深档已有追踪，跳过`);
      skipped += 1;
    } else {
      const remainQty = pos.qty * (1 - band.ratio);
      const trail = await placeShortTrail({
        symbol,
        qty: remainQty > 0 ? remainQty : pos.qty,
        lastPrice: zzInfo.b || pos.markPrice,
        hedgeMode,
        rules,
      });
      if (trail.ok) {
        placed += 1;
        tips.push(
          `${symbol}：挂追踪${trail.callbackRate}% 量${trail.quantity}${
            trail.note ? `（${trail.note}）` : ''
          }`
        );
      } else {
        failed += 1;
        tips.push(`${symbol}：追踪失败：${trail.detail}`);
      }
    }
  }

  return { tips, placed, skipped, failed };
};

/**
 * 一轮：拉全部空头 → 逐个处理止盈。
 * @param {{ aborted?: () => boolean, onStatus?: (s: string) => void }} opts
 */
export const runSurgeShortExitRound = async ({ aborted: isAborted, onStatus } = {}) => {
  if (!isLiveOrderEnabled()) {
    onStatus?.('空头止盈：未解锁交易，跳过');
    return {
      ok: true,
      skipped: true,
      reason: 'live_disabled',
      tips: [],
      placed: 0,
      failed: 0,
      shortCount: 0,
    };
  }

  onStatus?.('空头止盈：读账户镜像…');
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);

  let snap;
  try {
    snap = await getBinanceAccountSnapshot();
  } catch (e) {
    return {
      ok: false,
      tips: [`空头止盈：账户镜像失败 ${e?.message || e}`],
      placed: 0,
      failed: 1,
      shortCount: 0,
    };
  }

  if (!snap?.ok) {
    return {
      ok: false,
      tips: [`空头止盈：查持仓失败 ${snap?.error || 'account mirror'}`],
      placed: 0,
      failed: 1,
      shortCount: 0,
    };
  }

  const shorts = listShortPositions(snap.positions);
  if (!shorts.length) {
    onStatus?.('空头止盈：无空头持仓');
    return { ok: true, tips: [], placed: 0, failed: 0, skipped: 0, shortCount: 0 };
  }

  const positionMode = await getCachedPositionMode();
  const hedgeMode = Boolean(positionMode?.response?.dualSidePosition);
  const algos = Array.isArray(snap.algoOrders) ? snap.algoOrders : [];
  const orders = Array.isArray(snap.openOrders) ? snap.openOrders : [];

  const allTips = [];
  let placed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < shorts.length; i += 1) {
    if (isAborted?.()) break;
    const pos = shorts[i];
    onStatus?.(`空头止盈：${pos.symbol}（${i + 1}/${shorts.length}）…`);
    try {
      const r = await processShortExit(pos, { hedgeMode, algos, orders });
      allTips.push(...r.tips);
      placed += r.placed;
      failed += r.failed;
      skipped += r.skipped;
    } catch (e) {
      failed += 1;
      allTips.push(`${pos.symbol}：异常 ${e?.message || e}`);
      console.error('[SurgeShortExit]', pos.symbol, e);
    }
    await sleep(100);
  }

  if (placed > 0) {
    try {
      await refreshBinanceAccountMirror();
    } catch (e) {
      console.warn('[SurgeShortExit] refresh mirror', e);
    }
  }

  return {
    ok: failed === 0,
    tips: allTips,
    placed,
    failed,
    skipped,
    shortCount: shorts.length,
  };
}; 