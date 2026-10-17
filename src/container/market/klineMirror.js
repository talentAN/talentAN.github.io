/**
 * 统一 K 线仓储（进程内单例，对标 BinanceAccountMirror 的「一份内存真相」形态）。
 *
 * 现阶段只做收口：各业务命名空间彼此独立，允许数据重复，不合并写策略。
 * - surgeDay：暴涨当日 open/high/last
 * - rangeLookback：横盘 lookback 已收盘日 K + 当日 REST 种子
 * - hourZz / hourXx：暴涨 zz / 横盘 xx 小时 K 短缓存
 *
 * 业务模块（_surgeDayCache / _rangeMonitorCandleCache / …）继续持有原有 API，
 * 内部改读本 Mirror，功能逻辑不变。
 */

/** @typedef {'surgeDay'|'rangeLookback'|'hourZz'|'hourXx'} KLineNamespace */

export const KLINE_NS = Object.freeze({
  SURGE_DAY: 'surgeDay',
  RANGE_LOOKBACK: 'rangeLookback',
  HOUR_ZZ: 'hourZz',
  HOUR_XX: 'hourXx',
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
    if (ns === KLINE_NS.SURGE_DAY) return this.surgeDay;
    if (ns === KLINE_NS.RANGE_LOOKBACK) return this.rangeLookback;
    if (ns === KLINE_NS.HOUR_ZZ) return this.hourZz;
    if (ns === KLINE_NS.HOUR_XX) return this.hourXx;
    throw new Error(`KLineMirror: unknown namespace ${ns}`);
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

export const createEmptySurgeDayBucket = emptySurgeDay;
export const createEmptyRangeLookbackBucket = emptyRangeLookback;
