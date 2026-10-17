/**
 * 本机「已成功下单」持久化（localStorage）。
 * 用途：同机下次下单前可跳过 REST；另一台电脑看不到，仍会 REST。
 */

/** localStorage 键名 */
const STORAGE_KEY = 'binance-place-success-v1';

// ─── Intent 枚举 ───────────────────────────────────────────

/** 成功缓存的业务类型（开空/开多/止损/止盈/追踪） */
export const PlaceIntent = {
  /** 暴涨阶梯开空 */
  OPEN_SHORT: 'open_short',
  /** 横盘突破开多 */
  OPEN_LONG: 'open_long',
  /** 成本价止损 */
  EXIT_SL: 'exit_sl',
  /** 固定止盈 */
  EXIT_TP: 'exit_tp',
  /** 追踪止盈 */
  EXIT_TRAIL: 'exit_trail',
};

/** 各类 intent 默认过期时间（毫秒） */
const DEFAULT_TTL_MS = {
  [PlaceIntent.OPEN_SHORT]: 48 * 60 * 60 * 1000,
  [PlaceIntent.OPEN_LONG]: 24 * 60 * 60 * 1000,
  [PlaceIntent.EXIT_SL]: 7 * 24 * 60 * 60 * 1000,
  [PlaceIntent.EXIT_TP]: 7 * 24 * 60 * 60 * 1000,
  [PlaceIntent.EXIT_TRAIL]: 7 * 24 * 60 * 60 * 1000,
};

// ─── 存储读写 ──────────────────────────────────────────────

/** 拼缓存主键：交易所:币对:intent[:tag] */
const cacheKeyOf = ({ exchange = 'binance', symbol, intent, tag = '' } = {}) => {
  const ex = String(exchange || 'binance').toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  const intentKey = String(intent || '');
  const tagKey = tag != null && tag !== '' ? String(tag) : '';
  return `${ex}:${sym}:${intentKey}${tagKey ? `:${tagKey}` : ''}`;
};

/** 读出整份缓存表 */
const readAll = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
};

/** 写回整份缓存表 */
const writeAll = map => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (_) {
    /* quota / private mode */
  }
};

/** 删掉已过期条目，有改动返回 true */
const pruneExpired = map => {
  const now = Date.now();
  let changed = false;
  Object.keys(map).forEach(key => {
    const exp = Number(map[key]?.expiresAt);
    if (!(exp > 0) || exp <= now) {
      delete map[key];
      changed = true;
    }
  });
  return changed;
};

// ─── 查询 ──────────────────────────────────────────────────

/** 读一条未过期成功记录；没有或过期返回 null */
export const getPlaceSuccess = opts => {
  if (!String(opts?.symbol || '').trim() || !opts?.intent) return null;
  const key = cacheKeyOf(opts);
  const map = readAll();
  if (pruneExpired(map)) writeAll(map);
  const row = map[key];
  if (!row) return null;
  if (!(Number(row.expiresAt) > Date.now())) {
    delete map[key];
    writeAll(map);
    return null;
  }
  return row;
};

/** 是否已有该 intent(+tag) 的成功缓存 */
export const hasPlaceSuccess = opts => getPlaceSuccess(opts) != null;

/** 某 intent 下任意 tag 是否命中（不区分档位） */
export const hasAnyPlaceSuccess = ({ exchange = 'binance', symbol, intent } = {}) => {
  const ex = String(exchange || 'binance').toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  const intentKey = String(intent || '');
  if (!sym || !intentKey) return false;
  const prefix = `${ex}:${sym}:${intentKey}`;
  const map = readAll();
  if (pruneExpired(map)) writeAll(map);
  const now = Date.now();
  return Object.keys(map).some(key => {
    if (key !== prefix && !key.startsWith(`${prefix}:`)) return false;
    return Number(map[key]?.expiresAt) > now;
  });
};

// ─── 写入 / 清理 ───────────────────────────────────────────

/** 写入一条成功记录（发单成功或 REST 确认有敞口） */
export const markPlaceSuccess = opts => {
  const symbol = String(opts?.symbol || '').toUpperCase();
  const intent = String(opts?.intent || '');
  if (!symbol || !intent) return;
  const key = cacheKeyOf({ ...opts, symbol, intent });
  const ttl =
    Number(opts?.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS[intent] || 24 * 60 * 60 * 1000;
  const map = readAll();
  pruneExpired(map);
  map[key] = {
    at: Date.now(),
    expiresAt: Date.now() + ttl,
    source: opts?.source || 'place',
    ...(opts?.meta && typeof opts.meta === 'object' ? { meta: opts.meta } : {}),
  };
  writeAll(map);
};

/** 删掉精确匹配的一条缓存 */
export const clearPlaceSuccess = opts => {
  const key = cacheKeyOf(opts);
  const map = readAll();
  if (!(key in map)) return;
  delete map[key];
  writeAll(map);
};

/** 清掉某币对下某 intent 的所有 tag */
export const clearPlaceSuccessByIntent = ({ exchange = 'binance', symbol, intent } = {}) => {
  const ex = String(exchange || 'binance').toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  const intentKey = String(intent || '');
  if (!sym || !intentKey) return;
  const prefix = `${ex}:${sym}:${intentKey}`;
  const map = readAll();
  let changed = false;
  Object.keys(map).forEach(key => {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      delete map[key];
      changed = true;
    }
  });
  if (changed) writeAll(map);
};

/** 清掉某币对全部成功缓存（开仓+出场） */
export const clearPlaceSuccessForSymbol = ({ exchange = 'binance', symbol } = {}) => {
  const ex = String(exchange || 'binance').toLowerCase();
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return;
  const prefix = `${ex}:${sym}:`;
  const map = readAll();
  let changed = false;
  Object.keys(map).forEach(key => {
    if (key.startsWith(prefix)) {
      delete map[key];
      changed = true;
    }
  });
  if (changed) writeAll(map);
};
