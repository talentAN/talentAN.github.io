/**
 * Binance U 本位全市场实时买一卖一流（复用长连接）。
 *
 * 不用 !miniTicker@arr：那是约 1s 一批、且「仅含有变动币」的 24h 统计快照，
 * 不满足「价格一变就推送」。
 *
 * 改用 !bookTicker（All Book Tickers）：任意币对买一/卖一价格或数量变化即实时推送。
 * 2026-03 起高频公流走 /public（非 /market）。
 *
 * 最新价 last = (bid+ask)/2；今日最高/最低在本地按 UTC 日从推送价滚动扩张
 *（bookTicker 本身不含日 H/L）。日 K 缓存 REST 首轮会 seedDayOhlc 打底。
 */

import { getFutureTicker } from '@root/src/container/binance/api';

/** 按优先级尝试；连上并收到可解析行情即固定使用 */
const WS_URL_CANDIDATES = [
  'wss://fstream.binance.com/public/ws/!bookTicker',
  'wss://fstream.binance.com/public/stream?streams=!bookTicker',
  'wss://fstream.binance.com/ws/!bookTicker',
  'wss://fstream.binance.com/stream?streams=!bookTicker',
];

const RECONNECT_MS = 2000;
const CANDIDATE_WAIT_MS = 8000;

/** @type {BinanceBookTickerFeed|null} */
let singleton = null;

export class RangeMonitorFatal extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'RangeMonitorFatal';
    this.detail = detail;
  }
}

const utcDayKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

/** 从原始 WS 帧解析出 bookTicker 对象列表（通常每帧 1 条） */
const parseBookTickerMessages = raw => {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;

  const one = obj => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.s && (obj.b != null || obj.a != null)) return obj;
    return null;
  };

  if (Array.isArray(data)) {
    const list = data.map(one).filter(Boolean);
    return list.length ? list : null;
  }
  // combined: { stream, data: { s,b,a,... } }
  if (data.data) {
    if (Array.isArray(data.data)) {
      const list = data.data.map(one).filter(Boolean);
      return list.length ? list : null;
    }
    const item = one(data.data);
    return item ? [item] : null;
  }
  const item = one(data);
  return item ? [item] : null;
};

const midPrice = item => {
  const bid = Number(item.b);
  const ask = Number(item.a);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (ask > 0) return ask;
  if (bid > 0) return bid;
  return null;
};

/**
 * 全市场 bookTicker 行情缓存。
 * 导出名保留 MiniTicker 别名，避免大面积改 import。
 */
export class BinanceBookTickerFeed {
  constructor() {
    /** @type {Map<string, { last: number, high: number, low: number, dayKey: string, bid: number, ask: number, ts: number, via?: string }>} */
    this.bySymbol = new Map();
    this.ws = null;
    this.wanted = false;
    this.ready = false;
    /** @type {{ resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>|null }[]} */
    this.readyWaiters = [];
    this.reconnectTimer = null;
    this.lastMsgAt = 0;
    this.connectGen = 0;
    this.activeUrl = null;
    this.lastClose = null;
  }

  start() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  stop() {
    this.wanted = false;
    this.connectGen += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachAndCloseWs();
    this.ready = false;
    this.bySymbol.clear();
    this.rejectAllWaiters(new RangeMonitorFatal('行情 Socket 已停止', 'feed.stop()'));
  }

  detachAndCloseWs() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch (_) {
      /* ignore */
    }
  }

  rejectAllWaiters(err) {
    const waiters = this.readyWaiters.splice(0);
    waiters.forEach(w => {
      if (w.timer) clearTimeout(w.timer);
      try {
        w.reject(err);
      } catch (_) {
        /* ignore */
      }
    });
  }

  resolveAllWaiters() {
    const waiters = this.readyWaiters.splice(0);
    waiters.forEach(w => {
      if (w.timer) clearTimeout(w.timer);
      try {
        w.resolve();
      } catch (_) {
        /* ignore */
      }
    });
  }

  ingestBookTickers(items) {
    if (!items || !items.length) return false;
    const now = Date.now();
    const day = utcDayKey(now);
    let n = 0;
    items.forEach(item => {
      const symbol = String(item?.s || '').toUpperCase();
      if (!symbol) return;
      const last = midPrice(item);
      if (!(last > 0)) return;
      const bid = Number(item.b) || 0;
      const ask = Number(item.a) || 0;
      const prev = this.bySymbol.get(symbol);
      let high = last;
      let low = last;
      if (prev && prev.dayKey === day) {
        if (prev.high > 0) high = Math.max(prev.high, last);
        if (prev.low > 0) low = Math.min(prev.low, last);
      }
      this.bySymbol.set(symbol, {
        last,
        high,
        low,
        dayKey: day,
        bid,
        ask,
        ts: now,
        via: 'bookTicker',
      });
      n += 1;
    });
    if (!n) return false;
    this.lastMsgAt = now;
    if (!this.ready) {
      this.ready = true;
      this.resolveAllWaiters();
    }
    return true;
  }

  connect() {
    if (typeof WebSocket === 'undefined') {
      throw new RangeMonitorFatal('当前环境不支持 WebSocket', '无法建立币安行情流');
    }

    this.connectGen += 1;
    const gen = this.connectGen;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachAndCloseWs();
    this.ready = false;

    const urls = this.activeUrl
      ? [this.activeUrl, ...WS_URL_CANDIDATES.filter(u => u !== this.activeUrl)]
      : [...WS_URL_CANDIDATES];

    this.tryUrls(urls, 0, gen);
  }

  tryUrls(urls, index, gen) {
    if (!this.wanted || gen !== this.connectGen) return;
    if (index >= urls.length) {
      this.lastClose = { reason: 'all_urls_failed', urls };
      this.rejectAllWaiters(
        new RangeMonitorFatal(
          '行情 Socket 全部候选地址失败',
          `已尝试：\n${urls.join('\n')}\n最后关闭：${JSON.stringify(this.lastClose)}`
        )
      );
      if (this.wanted && gen === this.connectGen) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.wanted && gen === this.connectGen) this.connect();
        }, RECONNECT_MS);
      }
      return;
    }

    const url = urls[index];
    this.detachAndCloseWs();

    let settled = false;
    let candidateTimer = null;
    const ws = new WebSocket(url);
    this.ws = ws;

    const failCandidate = reason => {
      if (settled || gen !== this.connectGen) return;
      settled = true;
      if (candidateTimer) {
        clearTimeout(candidateTimer);
        candidateTimer = null;
      }
      this.lastClose = { url, reason };
      try {
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch (_) {
        /* ignore */
      }
      if (this.ws === ws) this.ws = null;
      this.tryUrls(urls, index + 1, gen);
    };

    candidateTimer = setTimeout(() => {
      failCandidate('candidate_timeout');
    }, CANDIDATE_WAIT_MS);

    ws.onmessage = ev => {
      if (this.ws !== ws || gen !== this.connectGen) return;
      const items = parseBookTickerMessages(ev.data);
      if (!items) return;
      if (!this.ingestBookTickers(items)) return;
      if (!settled) {
        settled = true;
        if (candidateTimer) {
          clearTimeout(candidateTimer);
          candidateTimer = null;
        }
        this.activeUrl = url;
      }
    };

    ws.onerror = () => {
      /* onclose / timeout */
    };

    ws.onclose = ev => {
      if (gen !== this.connectGen) return;
      if (!settled && !this.ready) {
        failCandidate(`close code=${ev?.code} reason=${ev?.reason || ''}`);
        return;
      }
      if (this.ws === ws) this.ws = null;
      this.ready = false;
      this.lastClose = { url, code: ev?.code, reason: ev?.reason || '' };
      if (!this.wanted) return;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.wanted || gen !== this.connectGen) return;
        this.connect();
      }, RECONNECT_MS);
    };
  }

  async waitReady(timeoutMs = 25000) {
    if (this.ready && this.bySymbol.size > 0) return;
    this.start();
    await new Promise((resolve, reject) => {
      const waiter = { resolve: null, reject: null, timer: null };
      waiter.timer = setTimeout(() => {
        const idx = this.readyWaiters.indexOf(waiter);
        if (idx >= 0) this.readyWaiters.splice(idx, 1);
        reject(
          new RangeMonitorFatal(
            '行情 Socket 就绪超时',
            `超过 ${timeoutMs}ms 未收到可解析的 bookTicker。\n` +
              `activeUrl=${this.activeUrl || '无'}\n` +
              `lastClose=${JSON.stringify(this.lastClose)}\n` +
              `候选：${WS_URL_CANDIDATES.join(' | ')}`
          )
        );
      }, timeoutMs);
      waiter.resolve = () => {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.timer = null;
        resolve();
      };
      waiter.reject = err => {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.timer = null;
        reject(err);
      };
      this.readyWaiters.push(waiter);
      if (this.ready && this.bySymbol.size > 0) {
        this.resolveAllWaiters();
      }
    });
  }

  get(symbol) {
    const key = String(symbol || '').toUpperCase();
    return this.bySymbol.get(key) || null;
  }

  /**
   * 用日 K（或其它来源）为当日 H/L 打底；之后 bookTicker 只向外扩张。
   */
  seedDayOhlc(symbol, { open, high, low, close } = {}) {
    const key = String(symbol || '').toUpperCase();
    if (!key) return null;
    const day = utcDayKey();
    const last = Number(close) > 0 ? Number(close) : Number(open);
    const hIn = Number(high);
    const lIn = Number(low);
    if (!(last > 0) && !(hIn > 0)) return null;
    const baseLast = last > 0 ? last : hIn;
    const prev = this.bySymbol.get(key);
    let highOut = hIn > 0 ? hIn : baseLast;
    let lowOut = lIn > 0 ? lIn : baseLast;
    if (prev && prev.dayKey === day) {
      if (prev.high > 0) highOut = Math.max(prev.high, highOut, baseLast);
      if (prev.low > 0) lowOut = Math.min(prev.low, lowOut, baseLast);
      if (prev.last > 0 && !(last > 0)) {
        /* keep prev last if seed close missing */
      }
    } else {
      highOut = Math.max(highOut, baseLast);
      lowOut = Math.min(lowOut, baseLast);
    }
    // Socket 已有更新价时保留 last，只把日 K 的 H/L 并入极值
    const keepLast = prev && prev.dayKey === day && prev.last > 0 ? prev.last : baseLast;
    const quote = {
      last: keepLast,
      high: Math.max(highOut, keepLast),
      low: Math.min(lowOut, keepLast),
      dayKey: day,
      bid: prev?.bid || 0,
      ask: prev?.ask || 0,
      ts: Date.now(),
      via: prev?.via === 'bookTicker' ? 'bookTicker' : 'kline_seed',
    };
    this.bySymbol.set(key, quote);
    return quote;
  }

  /**
   * 短等 Socket；仍无则 REST 补种（写入缓存后继续由 bookTicker 刷新）。
   */
  async ensureQuote(symbol, label = '', waitMs = 2500) {
    const key = String(symbol || '').toUpperCase();
    const tag = label ? `${label} ` : '';
    if (!key) {
      throw new RangeMonitorFatal(`${tag}币对为空`, 'ensureQuote');
    }

    const valid = q => q && q.last > 0 && q.high > 0 && q.low > 0;
    let q = this.get(key);
    if (valid(q)) return q;

    if (this.wanted && waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        if (!this.wanted) {
          throw new RangeMonitorFatal('行情 Socket 已停止', 'ensureQuote');
        }
        await new Promise(r => setTimeout(r, 150));
        q = this.get(key);
        if (valid(q)) return q;
      }
    }

    // 已有 last+high（旧缓存）但缺 low：用 last 补 low，避免无谓 REST
    q = this.get(key);
    if (q && q.last > 0 && q.high > 0 && !(q.low > 0)) {
      const fixed = { ...q, low: Math.min(q.last, q.high > 0 ? q.high : q.last) };
      this.bySymbol.set(key, fixed);
      return fixed;
    }

    let ticker;
    try {
      ticker = await getFutureTicker(key);
    } catch (e) {
      throw new RangeMonitorFatal(`${tag}${key} REST 行情失败`, e?.message || String(e));
    }
    const last = Number(ticker?.lastPrice ?? ticker?.c);
    if (!(last > 0)) {
      throw new RangeMonitorFatal(
        `${tag}无 ${key} 行情（bookTicker 未到且 REST 无效）`,
        `activeUrl=${this.activeUrl || '无'} lastPrice=${ticker?.lastPrice} code=${ticker?.code} msg=${ticker?.msg || ''}`
      );
    }
    const day = utcDayKey();
    const prev = this.bySymbol.get(key);
    // 不用 24h high/low：那是滚动 24h，会污染 UTC 日高并误杀横盘盒子
    const high =
      prev && prev.dayKey === day && prev.high > 0 ? Math.max(prev.high, last) : last;
    const low =
      prev && prev.dayKey === day && prev.low > 0 ? Math.min(prev.low, last) : last;
    const quote = {
      last,
      high,
      low,
      dayKey: day,
      bid: Number(ticker?.bidPrice) || 0,
      ask: Number(ticker?.askPrice) || 0,
      ts: Date.now(),
      via: 'rest',
    };
    this.bySymbol.set(key, quote);
    return quote;
  }

  requireQuote(symbol, label = '') {
    const q = this.get(symbol);
    const tag = label ? `${label} ` : '';
    if (!q || !(q.last > 0) || !(q.high > 0)) {
      throw new RangeMonitorFatal(
        `${tag}Socket 无 ${symbol} 行情`,
        `请用 ensureQuote；activeUrl=${this.activeUrl || '无'}（流为 !bookTicker）`
      );
    }
    return q;
  }
}

/** @deprecated 类名历史别名，实现已是 bookTicker */
export const BinanceMiniTickerFeed = BinanceBookTickerFeed;

export const getSharedMiniTickerFeed = () => {
  if (!singleton) singleton = new BinanceBookTickerFeed();
  return singleton;
};

export const getSharedBookTickerFeed = getSharedMiniTickerFeed;
