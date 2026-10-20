/**
 * 统一 K 线仓储（进程内单例，对标 BinanceAccountMirror 的「一份内存真相」形态）。
 *
 * - todayDay：当日 OHLC 唯一真相（open 锁死；REST 上修 restHigh）
 * - surgeDay：暴涨冷建完成态 / 兼容镜像（写穿自 today）
 * - rangeLookback：横盘 lookback 已收盘日 K（今日行投影自 today）
 * - hourZz / hourXx：暴涨 zz / 横盘 xx 小时 K 短缓存
 */

/** @typedef {'todayDay'|'surgeDay'|'rangeLookback'|'hourZz'|'hourXx'} KLineNamespace */

export const KLINE_NS = Object.freeze({
  TODAY_DAY: 'todayDay',
  SURGE_DAY: 'surgeDay',
  RANGE_LOOKBACK: 'rangeLookback',
  HOUR_ZZ: 'hourZz',
  HOUR_XX: 'hourXx',
});

const emptyTodayDay = () => ({
  dayKey: '',
  bySymbol: new Map(),
});

const emptySurgeDay = () => ({
  dayKey: '',
  bySymbol: new Map(),
  complete: false,
  builtAt: 0,
});

const emptyRangeLookback = () => ({
  dayKey: '',
  bySymbol: new Map(),
  builtAt: 0,
  pairCount: 0,
  complete: false,
});

class KLineMirror {
  constructor() {
    /** 当日真相桶 */
    this.todayDay = emptyTodayDay();
    /** 暴涨日 K 桶（结构与原 _surgeDayCache.cacheState 一致） */
    this.surgeDay = emptySurgeDay();
    /** 横盘日 K 桶（结构与原 _rangeMonitorCandleCache.cacheState 一致） */
    this.rangeLookback = emptyRangeLookback();
    /** @type {Map<string, object>} 暴涨空头 zz 小时 K */
    this.hourZz = new Map();
    /** @type {Map<string, object>} 横盘持仓 xx 小时 K */
    this.hourXx = new Map();
  }

  /** @param {KLineNamespace} ns */
  getBucket(ns) {
    if (ns === KLINE_NS.TODAY_DAY) return this.todayDay;
    if (ns === KLINE_NS.SURGE_DAY) return this.surgeDay;
    if (ns === KLINE_NS.RANGE_LOOKBACK) return this.rangeLookback;
    if (ns === KLINE_NS.HOUR_ZZ) return this.hourZz;
    if (ns === KLINE_NS.HOUR_XX) return this.hourXx;
    throw new Error(`KLineMirror: unknown namespace ${ns}`);
  }

  replaceTodayDay(next) {
    this.todayDay = next && typeof next === 'object' ? next : emptyTodayDay();
    return this.todayDay;
  }

  /** 整桶替换（冷建 / 回滚），仅 day 类桶 */
  replaceSurgeDay(next) {
    this.surgeDay = next && typeof next === 'object' ? next : emptySurgeDay();
    return this.surgeDay;
  }

  replaceRangeLookback(next) {
    this.rangeLookback = next && typeof next === 'object' ? next : emptyRangeLookback();
    return this.rangeLookback;
  }

  clearTodayDay() {
    return this.replaceTodayDay(emptyTodayDay());
  }

  clearSurgeDay() {
    return this.replaceSurgeDay(emptySurgeDay());
  }

  clearRangeLookback() {
    return this.replaceRangeLookback(emptyRangeLookback());
  }

  clearHourZz() {
    this.hourZz.clear();
  }

  clearHourXx() {
    this.hourXx.clear();
  }

  /** 调试 / 自检 */
  getStatus() {
    return {
      todayDay: {
        dayKey: this.todayDay.dayKey,
        size: this.todayDay.bySymbol?.size || 0,
      },
      surgeDay: {
        dayKey: this.surgeDay.dayKey,
        size: this.surgeDay.bySymbol?.size || 0,
        complete: this.surgeDay.complete,
        builtAt: this.surgeDay.builtAt,
      },
      rangeLookback: {
        dayKey: this.rangeLookback.dayKey,
        size: this.rangeLookback.bySymbol?.size || 0,
        pairCount: this.rangeLookback.pairCount,
        complete: this.rangeLookback.complete,
        builtAt: this.rangeLookback.builtAt,
      },
      hourZzSize: this.hourZz.size,
      hourXxSize: this.hourXx.size,
    };
  }
}

/** @type {KLineMirror|null} */
let shared = null;

export const getSharedKLineMirror = () => {
  if (!shared) shared = new KLineMirror();
  return shared;
};

/** 测试或热重载排障用；业务路径勿调用 */
export const resetSharedKLineMirror = () => {
  shared = new KLineMirror();
  return shared;
};

export const createEmptyTodayDayBucket = emptyTodayDay;
export const createEmptySurgeDayBucket = emptySurgeDay;
export const createEmptyRangeLookbackBucket = emptyRangeLookback;
