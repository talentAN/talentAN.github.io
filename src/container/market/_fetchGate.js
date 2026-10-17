/**
 * Binance fapi IP 统一调度（公共行情 + 签名 REST 共用）。
 *
 * 报错按「2400 requests / minute」计次；本地硬封顶远低于此。
 * 单通道放行：避免 openOrders 与 klines 双飞时第一条 429、第二条仍在途。
 * 418/429/-1003 全局限流，公私通道一起停。
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 始终单通道：429 后不会再有「已放行的同伴请求」踩雷 */
const MAX_CONCURRENT = 1;
const BASE_GAP_MS = 150;
/** 硬封顶（req/min），远低于交易所 2400 */
const HARD_REQ_PER_MIN = 480;
/** 软阈值：拉长间隔，背景任务让路 */
const SOFT_REQ_PER_MIN = 360;
const WINDOW_MS = 60 * 1000;
const WEIGHT_SLOW_1 = 500;
const WEIGHT_SLOW_2 = 900;
const WEIGHT_SLOW_3 = 1400;
const WEIGHT_PAUSE_BG = 800;
/** 被限流后最少冷却 */
const MIN_BAN_MS = 60 * 1000;

let active = 0;
let lastStart = 0;
let gapMs = BASE_GAP_MS;
let bannedUntil = 0;
let usedWeight1m = 0;
/**
 * 高优先级业务占用计数（如下单资格校验队列有未完成任务）。
 * >0 时背景补 K / 慢扫应让路。
 */
let highPriorityDepth = 0;
/** @type {number[]} 近 1 分钟内已放行的请求时间戳 */
const recentStarts = [];
const waiters = [];

const pruneWindow = (now = Date.now()) => {
  while (recentStarts.length && now - recentStarts[0] >= WINDOW_MS) {
    recentStarts.shift();
  }
};

const requestsInWindow = (now = Date.now()) => {
  pruneWindow(now);
  return recentStarts.length;
};

const weightGap = () => {
  if (usedWeight1m >= WEIGHT_SLOW_3) return Math.max(gapMs, 400);
  if (usedWeight1m >= WEIGHT_SLOW_2) return Math.max(gapMs, 280);
  if (usedWeight1m >= WEIGHT_SLOW_1) return Math.max(gapMs, 200);
  return gapMs;
};

/** 结合权重档位 + 本地 req/min 预算，计算下一次放行至少再等多久 */
const admitDelayMs = (now = Date.now()) => {
  pruneWindow(now);
  const n = recentStarts.length;
  let delay = weightGap();

  if (n >= HARD_REQ_PER_MIN) {
    const waitForSlot = WINDOW_MS - (now - recentStarts[0]) + 20;
    delay = Math.max(delay, waitForSlot);
  } else if (n >= SOFT_REQ_PER_MIN) {
    const remaining = Math.max(1, HARD_REQ_PER_MIN - n);
    const windowLeft = Math.max(1, WINDOW_MS - (now - (recentStarts[0] || now)));
    delay = Math.max(delay, Math.ceil(windowLeft / remaining));
  }

  const sinceLast = now - lastStart;
  return Math.max(0, delay - sinceLast);
};

const tryAdmit = resolve => {
  const now = Date.now();
  const banLeft = bannedUntil - now;
  if (banLeft > 0) {
    setTimeout(() => tryAdmit(resolve), Math.min(banLeft + 50, 5000));
    return;
  }
  if (active >= MAX_CONCURRENT) {
    waiters.push(() => tryAdmit(resolve));
    return;
  }
  const delay = admitDelayMs(now);
  if (delay > 0) {
    setTimeout(() => tryAdmit(resolve), Math.min(delay, 5000));
    return;
  }
  active += 1;
  lastStart = Date.now();
  recentStarts.push(lastStart);
  pruneWindow(lastStart);
  resolve();
};

/** 所有打往 fapi.binance.com 的 HTTP 应走此门闩 */
export const withMarketFetchGate = async fn => {
  await new Promise(resolve => tryAdmit(resolve));
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
};

export const withBinanceIpGate = withMarketFetchGate;

export const reportBinanceRateLimit = (waitMs = MIN_BAN_MS) => {
  const ms = Math.max(MIN_BAN_MS, Number(waitMs) || MIN_BAN_MS);
  bannedUntil = Math.max(bannedUntil, Date.now() + ms);
  // 解禁后先慢速单通道恢复
  gapMs = Math.max(gapMs, 400);
};

export const reportBinanceUsedWeight = w => {
  const n = Number(w);
  if (!Number.isFinite(n) || n < 0) return;
  usedWeight1m = n;
  if (n >= WEIGHT_SLOW_3) gapMs = 400;
  else if (n >= WEIGHT_SLOW_2) gapMs = 280;
  else if (n >= WEIGHT_SLOW_1) gapMs = 200;
  else gapMs = BASE_GAP_MS;
};

export const getBinanceBanRemaining = () => Math.max(0, bannedUntil - Date.now());

export const getBinanceUsedWeight1m = () => usedWeight1m;

export const getBinanceRequestCount1m = () => requestsInWindow();

/** 高优任务开始（可嵌套）；与 release 成对 */
export const acquireBinanceHighPriority = () => {
  highPriorityDepth += 1;
};

/** 高优任务结束 */
export const releaseBinanceHighPriority = () => {
  highPriorityDepth = Math.max(0, highPriorityDepth - 1);
};

export const getBinanceHighPriorityDepth = () => highPriorityDepth;

/** 是否有未完成的高优业务（下单校验队列等） */
export const hasBinanceHighPriorityWork = () => highPriorityDepth > 0;

/**
 * 背景补 H / 过期补 K / 非关键轮询：
 * 高优队列非空、限流、权重偏高或 req/min 近顶时主动停。
 */
export const shouldThrottleBinanceBackground = () =>
  highPriorityDepth > 0 ||
  getBinanceBanRemaining() > 0 ||
  usedWeight1m >= WEIGHT_PAUSE_BG ||
  requestsInWindow() >= SOFT_REQ_PER_MIN;

export const waitBinanceBanIfNeeded = async getBanRemaining => {
  const getter =
    typeof getBanRemaining === 'function' ? getBanRemaining : getBinanceBanRemaining;
  const remaining = getter();
  if (remaining > 0) await sleep(remaining + 400);
};

export const getMarketFetchGateConfig = () => ({
  maxConcurrent: MAX_CONCURRENT,
  minGapMs: weightGap(),
  baseGapMs: BASE_GAP_MS,
  hardReqPerMin: HARD_REQ_PER_MIN,
  softReqPerMin: SOFT_REQ_PER_MIN,
  requestCount1m: requestsInWindow(),
  active,
  bannedUntil,
  usedWeight1m,
});
