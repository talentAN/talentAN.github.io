/**
 * 行情/K 线请求全局门闩：暴涨监控与横盘监控共用，压并发，降低 429。
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 120;

let active = 0;
let lastStart = 0;
const waiters = [];

const tryAdmit = resolve => {
  if (active >= MAX_CONCURRENT) {
    waiters.push(() => tryAdmit(resolve));
    return;
  }
  const gap = MIN_GAP_MS - (Date.now() - lastStart);
  if (gap > 0) {
    setTimeout(() => tryAdmit(resolve), gap);
    return;
  }
  active += 1;
  lastStart = Date.now();
  resolve();
};

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

/** 若 Binance 仍在封禁窗口，先等到解禁再继续 */
export const waitBinanceBanIfNeeded = async getBanRemaining => {
  const remaining = typeof getBanRemaining === 'function' ? getBanRemaining() : 0;
  if (remaining > 0) await sleep(remaining + 400);
};
