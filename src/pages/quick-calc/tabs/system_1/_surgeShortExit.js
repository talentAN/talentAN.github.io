/**
 * 暴涨100 · 币安空头止盈/追踪（按 zz 互斥区间武装）。
 *
 * zz = min(a, b)：a=开仓后完整小时低（无则 null），b=最新价。
 * 现价 b>E 不挂；0.8E<zz≤E → shallow TP；更深档见 BANDS；zz≤0.5E 只挂追踪。
 * 追踪回撤策略要 15%，交易所上限常 10 → 夹到 10 并在 tip 注明。
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
  getSharedBinanceAccountMirror,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import {
  fetchBinanceSymbolLiveBook,
  gateBeforeExitPlace,
  listBookOrders,
  rememberExitSuccess,
  PlaceIntent,
} from '@root/src/container/binance/placeGate';
import {
  clearPlaceSuccessByIntent,
  hasAnyPlaceSuccess,
} from '@root/src/container/binance/placeSuccessCache';
import { getSharedKLineMirror } from '@root/src/container/market/klineMirror';
import { waitBinanceBanIfNeeded } from '../_marketFetchGate';
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
/** 空头止盈最多每分钟 REST 对账一次（openOrders weight≈40，禁止每轮 force） */
const SHORT_EXIT_REST_MAX_STALE_MS = 60 * 1000;
/** zz 小时 K：落在统一 KLineMirror.hourZz */
const zzKlineCache = () => getSharedKLineMirror().hourZz;
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

/** 本模块下的空头止盈 clientAlgoId 前缀（placeShortTp 使用 stp…）。 */
const isSurgeShortTpClientId = o =>
  /^stp/i.test(String(o?.clientAlgoId || o?.clientOrderId || ''));

/** 空头固定止盈：BUY + TAKE_PROFIT（非追踪）；类型缺失时用 stp 客户端 ID 兜底。 */
export const isShortTakeProfitOrder = o => {
  const side = String(o?.side || '').toUpperCase();
  if (side !== 'BUY') return false;
  const ps = String(o?.positionSide || '').toUpperCase();
  if (ps === 'LONG') return false;
  const blob = typeBlob(o);
  if (blob.includes('TRAILING')) return false;
  if (blob.includes('TAKE_PROFIT')) return true;
  return isSurgeShortTpClientId(o);
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

/** 本轮/会话内已挂或正在挂的空头止盈：symbol → Set(bandKey)。下单前 claim，防并发三挂。 */
const placedTpCache = new Map();
/** 同币空头止盈串行：账户事件 / 轻判重挂 / 定时扫不得并行 process */
const shortExitTail = new Map();
const tpCacheKey = symbol => String(symbol || '').toUpperCase();
const tpCacheHas = (symbol, bandKey) => {
  const set = placedTpCache.get(tpCacheKey(symbol));
  return Boolean(set && set.has(bandKey));
};
const tpCacheAdd = (symbol, bandKey) => {
  const key = tpCacheKey(symbol);
  const set = placedTpCache.get(key) || new Set();
  set.add(bandKey);
  placedTpCache.set(key, set);
};
/** @returns {boolean} true=抢到名额，可下单 */
const tpCacheClaim = (symbol, bandKey) => {
  if (!bandKey) return true;
  if (tpCacheHas(symbol, bandKey)) return false;
  tpCacheAdd(symbol, bandKey);
  return true;
};
const tpCacheRelease = (symbol, bandKey) => {
  if (!bandKey) return;
  const key = tpCacheKey(symbol);
  const set = placedTpCache.get(key);
  if (!set) return;
  set.delete(bandKey);
  if (!set.size) placedTpCache.delete(key);
};
const pruneTpCache = activeSymbols => {
  const alive = new Set((activeSymbols || []).map(tpCacheKey));
  [...placedTpCache.keys()].forEach(key => {
    if (!alive.has(key)) placedTpCache.delete(key);
  });
};

const withShortExitLock = (symbol, task) => {
  const key = tpCacheKey(symbol);
  const prev = shortExitTail.get(key) || Promise.resolve();
  const run = prev.then(task, task);
  const settled = run.catch(() => undefined);
  shortExitTail.set(key, settled);
  settled.finally(() => {
    if (shortExitTail.get(key) === settled) shortExitTail.delete(key);
  });
  return run;
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
  const cachedKline = zzKlineCache().get(klineKey);
  if (cachedKline && Date.now() - cachedKline.fetchedAt < ZZ_KLINE_CACHE_TTL_MS) {
    const a = cachedKline.low;
    return { zz: Math.min(a, b), a, b, cached: true };
  }
  try {
    await waitBinanceBanIfNeeded(getBinanceBanRemaining);
    const res = await enqueueZzKline(() =>
      getFutureKlineData(
        {
          symbol,
          granularity: '1H',
          startTime: from,
          endTime: prevHourEnd,
          limit: 1000,
        },
        exchange
      )
    );
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
  zzKlineCache().set(klineKey, { fetchedAt: Date.now(), low: a });
  return { zz: Math.min(a, b), a, b };
};

/**
 * @param {number} zz min(a,b)
 * @param {number} entry 开仓价 E
 * @param {number} [last] 最新价 b；传入时 b>E 一律不挂（避免历史 a 把 zz 压进档内）
 */
const pickBand = (zz, entry, last) => {
  const e = Number(entry);
  const b = Number(last);
  // 现价仍高于成本：空头未回到成本以内，不武装（RLC 类误挂的根因）
  if (b > 0 && b > e) return { kind: 'none' };
  const e08 = e * 0.8;
  const e07 = e * 0.7;
  const e05 = e * 0.5;
  // 一档：跌破成本价但尚未到 0.8E（含等于 E）；zz>E 时不挂一档
  if (zz > e08 && zz <= e) return { kind: 'tp', ...BANDS.shallow };
  if (zz > e07 && zz <= e08) return { kind: 'tp', ...BANDS.mid };
  if (zz > e05 && zz <= e07) return { kind: 'tp_trail', ...BANDS.deep };
  if (zz <= e05) return { kind: 'trail_only' };
  return { kind: 'none' };
};

/** 档位稳定 key（轻判越档用） */
export const surgeShortBandKey = band => {
  if (!band || band.kind === 'none') return 'none';
  if (band.kind === 'trail_only') return 'trail_only';
  return band.key || `${band.kind}:${band.mult}`;
};

export const pickSurgeShortBand = (zz, entry, last) => pickBand(zz, entry, last);

/**
 * 轻量 zz：ticker last + 已缓存小时低（不 REST）。
 * 无缓存小时低时 zz=最新价（与尚无完整小时 K 语义一致）。
 */
export const peekZzLight = ({ symbol, openTimeMs }) => {
  const feed = getSharedMiniTickerFeed();
  const b = Number(feed.get(symbol)?.last);
  if (!(b > 0)) {
    return { zz: null, a: null, b: null, error: '无最新价' };
  }
  if (!(openTimeMs > 0)) {
    return { zz: b, a: null, b, note: '无开仓时间，zz=最新价' };
  }
  const from = openTimeMs + HOUR_MS;
  const prevHourEnd = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 1;
  if (from > prevHourEnd) {
    return { zz: b, a: null, b, note: '尚无完整小时 K，zz=最新价' };
  }
  const cachedKline = zzKlineCache().get(`${symbol}:${openTimeMs}`);
  if (cachedKline && Date.now() - cachedKline.fetchedAt < ZZ_KLINE_CACHE_TTL_MS) {
    const a = cachedKline.low;
    return { zz: Math.min(a, b), a, b, cached: true, light: true };
  }
  return { zz: b, a: null, b, note: '小时低未缓存，zz=最新价', light: true };
};

/** 内存镜像里的空头（同步，不 REST） */
export const getShortPositionFromMirror = symbol => {
  const key = String(symbol || '').toUpperCase();
  const snap = getSharedBinanceAccountMirror().snapshot();
  if (!snap?.ok) return null;
  return listShortPositions(snap.positions).find(p => p.symbol === key) || null;
};

/**
 * 持仓轻判：算档 + 看镜像是否缺单。不挂单、不拉 K。
 * @returns {{ hasShort: boolean, bandKey?: string, needHeavy?: boolean, band?: object }}
 */
export const evaluateShortExitLight = symbol => {
  const pos = getShortPositionFromMirror(symbol);
  if (!pos) return { hasShort: false };

  const zzInfo = peekZzLight({
    symbol: pos.symbol,
    openTimeMs: pos.openTimeMs,
  });
  if (!(zzInfo.zz > 0)) {
    return { hasShort: true, bandKey: null, needHeavy: false, zzInfo };
  }

  const band = pickBand(zzInfo.zz, pos.entryPrice, zzInfo.b);
  const bandKey = surgeShortBandKey(band);
  const snap = getSharedBinanceAccountMirror().snapshot();
  const related = [
    ...(Array.isArray(snap.algoOrders) ? snap.algoOrders : []),
    ...(Array.isArray(snap.openOrders) ? snap.openOrders : []),
  ].filter(o => String(o.symbol || '').toUpperCase() === pos.symbol);
  const tpClaimKey = band.key || null;
  const trailClaimKey =
    band.kind === 'trail_only' || band.kind === 'tp_trail'
      ? `${band.key || band.kind}:trail`
      : null;
  const hasTp =
    related.some(isShortTakeProfitOrder) ||
    (tpClaimKey ? tpCacheHas(pos.symbol, tpClaimKey) : false);
  const hasTrail =
    related.some(isShortTrailingOrder) ||
    (trailClaimKey ? tpCacheHas(pos.symbol, trailClaimKey) : false);

  let needHeavy = false;
  if (band.kind === 'none') {
    needHeavy = false;
  } else if (band.kind === 'trail_only') {
    needHeavy = !hasTp && !hasTrail;
  } else if (band.kind === 'tp_trail') {
    needHeavy = !hasTp || !hasTrail;
  } else {
    needHeavy = !hasTp;
  }

  return {
    hasShort: true,
    pos,
    band,
    bandKey,
    zzInfo,
    hasTp,
    hasTrail,
    needHeavy,
  };
};

/**
 * 单币重挂：读镜像（可 60s REST 对账）→ processShortExit。
 */
export const runSurgeShortExitForSymbol = async (
  symbol,
  { onStatus, forceRest = false } = {}
) => {
  if (!isLiveOrderEnabled()) {
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

  const key = String(symbol || '').toUpperCase();
  onStatus?.(`空头止盈：${key}…`);
  await waitBinanceBanIfNeeded(getBinanceBanRemaining);

  let snap;
  try {
    snap = await getBinanceAccountSnapshot({
      maxStaleMs: forceRest ? 0 : SHORT_EXIT_REST_MAX_STALE_MS,
      forceRest,
      ensureStarted: true,
    });
  } catch (e) {
    return {
      ok: false,
      tips: [`${key}：账户镜像失败 ${e?.message || e}`],
      placed: 0,
      failed: 1,
      shortCount: 0,
    };
  }

  if (!snap?.ok) {
    return {
      ok: false,
      tips: [`${key}：查持仓失败 ${snap?.error || 'account mirror'}`],
      placed: 0,
      failed: 1,
      shortCount: 0,
    };
  }

  const pos = listShortPositions(snap.positions).find(p => p.symbol === key);
  if (!pos) {
    placedTpCache.delete(tpCacheKey(key));
    clearPlaceSuccessByIntent({
      exchange: 'binance',
      symbol: key,
      intent: PlaceIntent.EXIT_TP,
    });
    clearPlaceSuccessByIntent({
      exchange: 'binance',
      symbol: key,
      intent: PlaceIntent.EXIT_TRAIL,
    });
    return { ok: true, tips: [], placed: 0, failed: 0, skipped: 1, shortCount: 0 };
  }

  const positionMode = await getCachedPositionMode();
  const hedgeMode = Boolean(positionMode?.response?.dualSidePosition);
  const algos = Array.isArray(snap.algoOrders) ? [...snap.algoOrders] : [];
  const orders = Array.isArray(snap.openOrders) ? snap.openOrders : [];

  try {
    const r = await processShortExit(pos, { hedgeMode, algos, orders });
    if (r.placed > 0) {
      try {
        await refreshBinanceAccountMirror();
      } catch (e) {
        console.warn('[SurgeShortExit] refresh mirror', e);
      }
    }
    return {
      ok: r.failed === 0,
      tips: r.tips,
      placed: r.placed,
      failed: r.failed,
      skipped: r.skipped,
      shortCount: 1,
    };
  } catch (e) {
    console.error('[SurgeShortExit]', key, e);
    return {
      ok: false,
      tips: [`${key}：异常 ${e?.message || e}`],
      placed: 0,
      failed: 1,
      shortCount: 1,
    };
  }
};

/** 生成 clientAlgoId 前缀+时间戳，截到交易所长度上限 */
const oid = prefix => `${prefix}${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 36);

/** 算空头止盈数量与触发价；失败返回 { ok:false, detail } */
const prepareShortTp = ({ qty, entry, ratio, mult, rules }) => {
  const quantity = quantizeQuantity(qty * ratio, rules.stepSize, rules.quantityPrecision);
  if (!(quantity > 0) || (rules.minQty > 0 && quantity < rules.minQty)) {
    return { ok: false, detail: `止盈数量过小 ${quantity}` };
  }
  const triggerPrice = floorToTick(entry * mult, rules);
  if (!(triggerPrice > 0)) {
    return { ok: false, detail: `止盈触发价无效 ${triggerPrice}` };
  }
  return {
    ok: true,
    quantity,
    triggerPrice,
    mult,
    ratio,
    tpTag: `SHORT:${mult}`,
  };
};

/** 挂空头固定止盈：准备 → 闸门防重 → 提交 */
const placeShortTp = async ({ symbol, qty, entry, ratio, mult, hedgeMode, rules }) => {
  const prepared = prepareShortTp({ qty, entry, ratio, mult, rules });
  if (!prepared.ok) return prepared;

  const gate = await gateBeforeExitPlace({
    symbol,
    intent: PlaceIntent.EXIT_TP,
    tag: prepared.tpTag,
    alreadyOnBook: book => listBookOrders(book).some(isShortTakeProfitOrder),
    localDetail: '本机已挂止盈缓存',
    restDetail: '已有止盈委托（REST）',
  });
  if (gate.alreadyExists) {
    return {
      ok: true,
      alreadyExists: true,
      detail: gate.detail,
      triggerPrice: prepared.triggerPrice,
      quantity: prepared.quantity,
      mult,
      ratio,
    };
  }
  if (!gate.allowPlace) {
    return { ok: false, detail: gate.detail };
  }

  const result = await placeFutureQtyTakeProfitAlgo({
    symbol,
    side: 'BUY',
    quantity: prepared.quantity,
    triggerPrice: prepared.triggerPrice,
    ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
    clientAlgoId: oid(`stp${String(mult).replace('.', '')}`),
  });
  if (result?.ok) {
    rememberExitSuccess({
      symbol,
      intent: PlaceIntent.EXIT_TP,
      tag: prepared.tpTag,
    });
  }
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '止盈提交失败',
    triggerPrice: prepared.triggerPrice,
    quantity: prepared.quantity,
    mult,
    ratio,
    result,
  };
};

/**
 * 准备空头追踪数量与回撤率。
 * 故意不设 activatePrice（立刻激活），避免自算价触发 -2021。
 */
const prepareShortTrail = ({ qty, rules }) => {
  const trailQty = quantizeQuantity(qty, rules.stepSize, rules.quantityPrecision);
  if (!(trailQty > 0) || (rules.minQty > 0 && trailQty < rules.minQty)) {
    return { ok: false, detail: `追踪数量过小 ${trailQty}` };
  }
  const cbRate = Math.min(TRAIL_CB_BN_MAX, TRAIL_CB_WANTED);
  return {
    ok: true,
    trailQty,
    cbRate,
    note:
      cbRate < TRAIL_CB_WANTED
        ? `交易所上限，回撤用 ${cbRate}%（策略 ${TRAIL_CB_WANTED}%）`
        : undefined,
  };
};

/** 挂空头追踪止盈：准备 → 闸门防重 → 提交 */
const placeShortTrail = async ({ symbol, qty, hedgeMode, rules }) => {
  const prepared = prepareShortTrail({ qty, rules });
  if (!prepared.ok) return prepared;

  const gate = await gateBeforeExitPlace({
    symbol,
    intent: PlaceIntent.EXIT_TRAIL,
    tag: 'SHORT',
    alreadyOnBook: book => listBookOrders(book).some(isShortTrailingOrder),
    localDetail: '本机已挂追踪缓存',
    restDetail: '已有追踪委托（REST）',
  });
  if (gate.alreadyExists) {
    return {
      ok: true,
      alreadyExists: true,
      detail: gate.detail,
      activatePrice: null,
      callbackRate: prepared.cbRate,
      quantity: prepared.trailQty,
      note: prepared.note,
    };
  }
  if (!gate.allowPlace) {
    return { ok: false, detail: gate.detail };
  }

  const result = await placeFutureTrailingStopAlgo({
    symbol,
    side: 'BUY',
    quantity: prepared.trailQty,
    callbackRate: prepared.cbRate,
    ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
    clientAlgoId: oid('strl'),
  });
  if (result?.ok) {
    rememberExitSuccess({
      symbol,
      intent: PlaceIntent.EXIT_TRAIL,
      tag: 'SHORT',
    });
  }
  return {
    ok: Boolean(result?.ok),
    detail: result?.ok ? null : pickErr(result) || '追踪提交失败',
    activatePrice: null,
    callbackRate: prepared.cbRate,
    quantity: prepared.trailQty,
    note: prepared.note,
    result,
  };
};

/**
 * 处理单个空头：按 zz 区间挂止盈 / 追踪。
 * 同币串行；下单前 claim 档位缓存（查委托 + 防账户事件/轻判/扫轮三路并发）。
 * @returns {{ tips: string[], placed: number, skipped: number, failed: number }}
 */
export const processShortExit = (pos, { hedgeMode, algos = [], orders = [] }) =>
  withShortExitLock(pos.symbol, () => processShortExitUnlocked(pos, { hedgeMode, algos, orders }));

/** 判断现场是否已有止盈/追踪：先本机缓存，缺哪边再 REST 补 */
const resolveShortExitLiveFlags = async (symbol, { algos = [], orders = [] } = {}) => {
  let hasTpLive = hasAnyPlaceSuccess({
    exchange: 'binance',
    symbol,
    intent: PlaceIntent.EXIT_TP,
  });
  let hasTrailLive = hasAnyPlaceSuccess({
    exchange: 'binance',
    symbol,
    intent: PlaceIntent.EXIT_TRAIL,
  });
  if (hasTpLive && hasTrailLive) {
    return { ok: true, hasTpLive, hasTrailLive };
  }

  const book = await fetchBinanceSymbolLiveBook(symbol);
  if (!book.ok) {
    return { ok: false, error: book.error || 'unknown' };
  }
  const related = [
    ...listBookOrders(book),
    ...(Array.isArray(algos) ? algos : []).filter(
      o => String(o.symbol || '').toUpperCase() === symbol
    ),
    ...(Array.isArray(orders) ? orders : []).filter(
      o => String(o.symbol || '').toUpperCase() === symbol
    ),
  ];
  if (!hasTpLive) hasTpLive = related.some(isShortTakeProfitOrder);
  if (!hasTrailLive) hasTrailLive = related.some(isShortTrailingOrder);
  return { ok: true, hasTpLive, hasTrailLive };
};

/** 单币空头出场逻辑体（已在 withShortExitLock 内）：定档 → 按需挂 TP/追踪 */
const processShortExitUnlocked = async (pos, { hedgeMode, algos = [], orders = [] }) => {
  const tips = [];
  const symbol = pos.symbol;
  const liveFlags = await resolveShortExitLiveFlags(symbol, { algos, orders });
  if (!liveFlags.ok) {
    tips.push(`${symbol}：实时查询委托失败（${liveFlags.error}）`);
    return { tips, placed: 0, skipped: 0, failed: 1 };
  }
  /** 现场（缓存或 REST）是否已有止盈 / 追踪 */
  const { hasTpLive, hasTrailLive } = liveFlags;

  const zzInfo = await fetchZzSinceOpen({
    symbol,
    openTimeMs: pos.openTimeMs,
    exchange: 'binance',
  });
  if (!(zzInfo.zz > 0)) {
    tips.push(`${symbol}：算 zz 失败（${zzInfo.error || '未知'}）`);
    return { tips, placed: 0, skipped: 1, failed: 0 };
  }

  const band = pickBand(zzInfo.zz, pos.entryPrice, zzInfo.b);
  const rules = await getRules(symbol);
  const lastLabel =
    zzInfo.b > 0 ? ` last=${Number(zzInfo.b).toPrecision(6)}` : '';
  const zzLabel = `zz=${zzInfo.zz.toPrecision(6)} E=${pos.entryPrice.toPrecision(6)}${lastLabel}`;

  if (band.kind === 'none') {
    const why =
      zzInfo.b > 0 && zzInfo.b > pos.entryPrice
        ? '现价高于开仓价，未回成本以内'
        : '无匹配区间';
    tips.push(`${symbol}：${zzLabel} ${why}`);
    return { tips, placed: 0, skipped: 1, failed: 0 };
  }

  const tpClaimKey = band.key || null;
  const trailClaimKey =
    band.kind === 'trail_only' || band.kind === 'tp_trail' ? `${band.key || band.kind}:trail` : null;

  // 现场有 TP，或本会话已挂/正在挂该档
  const hasTp = hasTpLive || (tpClaimKey ? tpCacheHas(symbol, tpClaimKey) : false);
  const hasTrail = hasTrailLive || (trailClaimKey ? tpCacheHas(symbol, trailClaimKey) : false);

  if (band.kind === 'trail_only') {
    if (hasTp || hasTrail) {
      tips.push(
        `${symbol}：zz≤0.5E 已有止盈/追踪，跳过（${zzLabel}${hasTp ? ' ·有TP' : ''}${
          hasTrail ? ' ·有追踪' : ''
        }）`
      );
      return { tips, placed: 0, skipped: 1, failed: 0 };
    }
    if (!tpCacheClaim(symbol, trailClaimKey)) {
      tips.push(`${symbol}：zz≤0.5E 追踪已在处理，跳过（${zzLabel}）`);
      return { tips, placed: 0, skipped: 1, failed: 0 };
    }
    const trail = await placeShortTrail({
      symbol,
      qty: pos.qty,
      hedgeMode,
      rules,
    });
    if (trail.ok && trail.alreadyExists) {
      tips.push(`${symbol}：zz≤0.5E 已有追踪（REST），跳过（${zzLabel}）`);
      return { tips, placed: 0, skipped: 1, failed: 0 };
    }
    if (trail.ok) {
      tips.push(
        `${symbol}：zz≤0.5E 已挂追踪${trail.callbackRate}%（立刻激活）量${trail.quantity}${
          trail.note ? `（${trail.note}）` : ''
        }`
      );
      return { tips, placed: 1, skipped: 0, failed: 0 };
    }
    tpCacheRelease(symbol, trailClaimKey);
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
  } else if (tpClaimKey && !tpCacheClaim(symbol, tpClaimKey)) {
    tips.push(`${symbol}：${zzLabel} 区间×${band.mult} 止盈已在处理，跳过 TP`);
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
    if (tp.ok && tp.alreadyExists) {
      skipped += 1;
      tips.push(`${symbol}：${zzLabel} 区间×${band.mult} 已有止盈（REST），跳过 TP`);
    } else if (tp.ok) {
      placed += 1;
      tips.push(
        `${symbol}：挂 TP@×${band.mult} 平${(band.ratio * 100).toFixed(0)}% @${tp.triggerPrice}（${zzLabel}）`
      );
    } else {
      failed += 1;
      if (tpClaimKey) tpCacheRelease(symbol, tpClaimKey);
      tips.push(`${symbol}：TP@×${band.mult} 失败：${tp.detail}（${zzLabel}）`);
    }
    await sleep(PLACE_GAP_MS);
  }

  if (band.kind === 'tp_trail') {
    if (hasTrail) {
      tips.push(`${symbol}：深档已有追踪，跳过`);
      skipped += 1;
    } else if (trailClaimKey && !tpCacheClaim(symbol, trailClaimKey)) {
      tips.push(`${symbol}：深档追踪已在处理，跳过`);
      skipped += 1;
    } else {
      const remainQty = pos.qty * (1 - band.ratio);
      const trail = await placeShortTrail({
        symbol,
        qty: remainQty > 0 ? remainQty : pos.qty,
        hedgeMode,
        rules,
      });
      if (trail.ok && trail.alreadyExists) {
        skipped += 1;
        tips.push(`${symbol}：深档已有追踪（REST），跳过`);
      } else if (trail.ok) {
        placed += 1;
        tips.push(
          `${symbol}：挂追踪${trail.callbackRate}%（立刻激活）量${trail.quantity}${
            trail.note ? `（${trail.note}）` : ''
          }`
        );
      } else {
        failed += 1;
        if (trailClaimKey) tpCacheRelease(symbol, trailClaimKey);
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
    // WS 镜像为主；最多 60s REST 对账一次。每轮 forceRest 会打 openOrders(weight≈40)
    // 与日K补H 双飞，正是 Network 里 openOrders+klines 同时 429 的来源。
    // 重复挂单靠 placedTpCache 挡；真正下单后仍 refreshBinanceAccountMirror。
    snap = await getBinanceAccountSnapshot({
      maxStaleMs: SHORT_EXIT_REST_MAX_STALE_MS,
      ensureStarted: true,
    });
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
    placedTpCache.clear();
    onStatus?.('空头止盈：无空头持仓');
    return { ok: true, tips: [], placed: 0, failed: 0, skipped: 0, shortCount: 0 };
  }
  pruneTpCache(shorts.map(p => p.symbol));

  const positionMode = await getCachedPositionMode();
  const hedgeMode = Boolean(positionMode?.response?.dualSidePosition);
  const algos = Array.isArray(snap.algoOrders) ? [...snap.algoOrders] : [];
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
      // 本轮内立刻记入 algos，避免同轮多仓/后续逻辑再读旧列表。
      if (r.placed > 0) {
        algos.push({
          symbol: pos.symbol,
          side: 'BUY',
          positionSide: 'SHORT',
          type: 'TAKE_PROFIT_MARKET',
          orderType: 'TAKE_PROFIT_MARKET',
          algoType: 'CONDITIONAL',
          clientAlgoId: `stp${pos.symbol}`,
        });
      }
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
