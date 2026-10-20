/**
 * 当日日 K 真相（进程内单份）：
 * - open 全日锁死；restHigh/restLow/restClose 只被 REST 上修/刷新
 * - Socket 只滚 feed 极值，不改本桶 open
 * - 暴涨 ratio / 横盘今日 bar 都读这里；lookback 已收盘棒仍在 rangeLookback
 */

import {
  getSharedKLineMirror,
  createEmptyTodayDayBucket,
} from './klineMirror';

export const todayUtcDayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

const todayBucket = () => getSharedKLineMirror().todayDay;

/** UTC 切日或排障：整桶清空 */
export const clearTodayTruth = () => {
  getSharedKLineMirror().replaceTodayDay(createEmptyTodayDayBucket());
};

/** 若桶日键与当前 UTC 日不一致则清空并切日 */
export const rotateTodayTruthIfNeeded = (ts = Date.now()) => {
  const day = todayUtcDayKey(ts);
  const bucket = todayBucket();
  if (bucket.dayKey === day) return bucket;
  const next = createEmptyTodayDayBucket();
  next.dayKey = day;
  return getSharedKLineMirror().replaceTodayDay(next);
};

/**
 * @returns {{
 *   symbol: string,
 *   exchange: string,
 *   dayKey: string,
 *   open: number,
 *   restHigh: number,
 *   restLow: number,
 *   restClose: number,
 *   candleTs: number,
 * }|null}
 */
export const getTodayTruth = symbol => {
  const key = String(symbol || '').toUpperCase();
  if (!key) return null;
  const day = todayUtcDayKey();
  const bucket = todayBucket();
  if (bucket.dayKey !== day) return null;
  const entry = bucket.bySymbol.get(key);
  if (!entry || entry.dayKey !== day || !(entry.open > 0)) return null;
  return entry;
};

/** 真相 → 日 K 数组形态（供横盘 closed+today 拼接） */
export const todayTruthToBar = entry => {
  if (!entry || !(entry.open > 0)) return null;
  const high = entry.restHigh > 0 ? entry.restHigh : entry.open;
  const low = entry.restLow > 0 ? entry.restLow : entry.open;
  const close =
    entry.restClose > 0 ? entry.restClose : high > 0 ? high : entry.open;
  const ts = entry.candleTs > 0 ? entry.candleTs : Date.now();
  return [
    ts,
    String(entry.open),
    String(high),
    String(low),
    String(close),
    '0',
    '0',
  ];
};

const syncSurgeDayMirror = entry => {
  const mirror = getSharedKLineMirror();
  const surge = mirror.surgeDay;
  if (!surge || entry.dayKey !== todayUtcDayKey()) return;
  if (surge.dayKey && surge.dayKey !== entry.dayKey) return;
  if (!surge.dayKey) surge.dayKey = entry.dayKey;
  const prev = surge.bySymbol.get(entry.symbol);
  surge.bySymbol.set(entry.symbol, {
    exchange: entry.exchange || 'binance',
    symbol: entry.symbol,
    open: entry.open,
    high: Math.max(entry.restHigh || 0, prev?.high || 0, entry.restClose || 0),
    last: entry.restClose > 0 ? entry.restClose : prev?.last || entry.restHigh || entry.open,
    candleTs: entry.candleTs || prev?.candleTs || Date.now(),
    dayKey: entry.dayKey,
  });
};

const syncRangeTodaySeed = entry => {
  const range = getSharedKLineMirror().rangeLookback;
  if (!range || range.dayKey !== entry.dayKey) return;
  const row = range.bySymbol.get(entry.symbol);
  if (!row) return;
  const bar = todayTruthToBar(entry);
  if (!bar) return;
  row.todaySeed = bar;
  row.today = bar;
};

/**
 * 任一路径拿到今日 bar（limit=1 或 lookback 末根）→ upsert 唯一真相，并写穿镜像。
 * open 同日不覆盖；restHigh 只上修。
 *
 * @param {string} symbol
 * @param {any[]} candle [ts, open, high, low, close, ...]
 * @param {{ feed?: object, exchange?: string }} [opts]
 */
export const upsertTodayFromCandle = (symbol, candle, opts = {}) => {
  if (!Array.isArray(candle) || candle.length < 5) return null;
  const key = String(symbol || '').toUpperCase();
  if (!key) return null;

  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const low = parseFloat(candle[3]);
  const close = parseFloat(candle[4]);
  if (!(open > 0) || !(high > 0)) return null;

  const day = todayUtcDayKey();
  const bucket = rotateTodayTruthIfNeeded();
  const prev = bucket.bySymbol.get(key);

  const restClose = close > 0 ? close : prev?.restClose || high;
  const entry = {
    symbol: key,
    exchange: opts.exchange || prev?.exchange || 'binance',
    dayKey: day,
    open: prev?.dayKey === day && prev.open > 0 ? prev.open : open,
    restHigh: Math.max(high, prev?.restHigh || 0, restClose || 0),
    restLow:
      low > 0
        ? prev?.restLow > 0
          ? Math.min(prev.restLow, low)
          : low
        : prev?.restLow || open,
    restClose,
    candleTs: Number(candle[0]) || prev?.candleTs || Date.now(),
  };
  bucket.bySymbol.set(key, entry);

  const feed = opts.feed;
  if (feed && typeof feed.seedDayOhlc === 'function') {
    feed.seedDayOhlc(key, {
      open: entry.open,
      high: entry.restHigh,
      low: entry.restLow > 0 ? entry.restLow : entry.open,
      close: entry.restClose,
    });
  }

  syncSurgeDayMirror(entry);
  syncRangeTodaySeed(entry);
  return entry;
};

/** 调试 / 状态条 */
export const getTodayTruthMeta = () => {
  const bucket = todayBucket();
  return {
    dayKey: bucket.dayKey,
    size: bucket.bySymbol?.size || 0,
  };
};
