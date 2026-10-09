/**
 * 币安 U 本位账户镜像（单例复用）：
 * - 启动：REST 打底（positionRisk / openOrders / openAlgoOrders / positionMode）+ User Data Stream
 * - 运行中：WS 增量维护；横盘 / 暴涨 / LiveScanner 共用，避免每轮打全量 openOrders
 * - 下单后可 forceRest 对账；另有低频对账兜底
 */

import {
  getPositionRisk,
  getOpenOrders,
  getOpenAlgoOrders,
  getPositionMode,
} from './api/query';
import {
  createFuturesListenKey,
  keepaliveFuturesListenKey,
  closeFuturesListenKey,
  buildFuturesUserDataWsUrls,
} from './api/userStream';

const KEEP_ALIVE_MS = 30 * 60 * 1000;
const RECONCILE_MS = 10 * 60 * 1000;
const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 30 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 调试：控制台打印持仓/委托快照（用户核对 Socket/REST 是否生效） */
const DEBUG_ACCOUNT_MIRROR = false;
/** 每个 WS 事件类型各打印前几条原文，避免刷屏 */
const WS_EVENT_LOG_LIMIT = 3;

const pickErr = result =>
  result?.error ||
  result?.response?.msg ||
  result?.response?.message ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

const responseList = result => {
  const response = result?.response;
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.orders)) return response.orders;
  if (Array.isArray(response?.algoOrders)) return response.algoOrders;
  return [];
};

const summarizePosition = p => ({
  symbol: p.symbol,
  positionSide: p.positionSide,
  positionAmt: p.positionAmt,
  entryPrice: p.entryPrice,
  markPrice: p.markPrice,
  openTime: p.openTime ?? p.updateTime,
  updateTime: p.updateTime,
});

const summarizeOrder = o => ({
  symbol: o.symbol,
  orderId: o.orderId,
  clientOrderId: o.clientOrderId,
  side: o.side,
  positionSide: o.positionSide,
  type: o.type || o.origType,
  orderType: o.orderType || o.type,
  origType: o.origType,
  status: o.status,
  price: o.price,
  origQty: o.origQty,
  stopPrice: o.stopPrice,
  triggerPrice: o.triggerPrice,
  reduceOnly: o.reduceOnly,
});

const summarizeAlgo = o => ({
  symbol: o.symbol,
  algoId: o.algoId,
  clientAlgoId: o.clientAlgoId,
  side: o.side,
  positionSide: o.positionSide,
  // 条件单接口不同版本可能把类型放在 type/orderType/origType/algoType 任一字段，全部保留供状态表识别。
  type: o.type || o.orderType || o.origType || o.algoType,
  orderType: o.orderType || o.type || o.origType || o.algoType,
  origType: o.origType,
  algoType: o.algoType,
  status: o.status,
  triggerPrice: o.triggerPrice ?? o.stopPrice ?? o.price,
  stopPrice: o.stopPrice,
  price: o.price,
  activatePrice: o.activatePrice,
  callbackRate: o.callbackRate,
  quantity: o.quantity,
  reduceOnly: o.reduceOnly,
});

const posKey = (symbol, positionSide) => {
  const sym = String(symbol || '').toUpperCase();
  const ps = String(positionSide || 'BOTH').toUpperCase() || 'BOTH';
  return `${sym}:${ps}`;
};

const orderKey = o => {
  if (o?.orderId != null) return `o:${o.orderId}`;
  if (o?.clientOrderId) return `c:${o.clientOrderId}`;
  return null;
};

const algoKey = o => {
  if (o?.algoId != null) return `a:${o.algoId}`;
  if (o?.clientAlgoId) return `ac:${o.clientAlgoId}`;
  return null;
};

const AUDIT_SYMBOLS = new Set(['SOLUSDT', 'WALUSDT', 'OPENAIUSDT']);
const auditOrderEvent = (event, order, detail = {}) => {
  const symbol = String(order?.symbol || '').toUpperCase();
  if (!AUDIT_SYMBOLS.has(symbol)) return;
  console.warn('[BinanceAccountMirror order audit]', {
    event,
    symbol,
    orderId: order?.orderId ?? order?.algoId,
    clientOrderId: order?.clientOrderId ?? order?.clientAlgoId,
    status: order?.status,
    type: order?.type || order?.orderType,
    side: order?.side,
    positionSide: order?.positionSide,
    ...detail,
  });
};

const isTerminalOrderStatus = status => {
  const s = String(status || '').toUpperCase();
  return (
    s === 'FILLED' ||
    s === 'CANCELED' ||
    s === 'CANCELLED' ||
    s === 'EXPIRED' ||
    s === 'REJECTED'
  );
};

const isTerminalAlgoStatus = status => {
  const s = String(status || '').toUpperCase();
  return (
    s === 'FILLED' ||
    s === 'CANCELED' ||
    s === 'CANCELLED' ||
    s === 'EXPIRED' ||
    s === 'REJECTED' ||
    s === 'FINISHED' ||
    s === 'TRIGGERED'
  );
};

class BinanceAccountMirror {
  constructor() {
    /** @type {Map<string, object>} */
    this.positions = new Map();
    /** @type {Map<string, object>} */
    this.openOrders = new Map();
    /** @type {Map<string, object>} */
    this.algoOrders = new Map();
    this.hedgeMode = null;
    this.bootstrapped = false;
    this.wanted = false;
    this.ws = null;
    this.listenKey = null;
    this.activeUrl = null;
    this.urlIndex = 0;
    this.connectGen = 0;
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.lastRestAt = 0;
    this.lastWsMsgAt = 0;
    this.lastError = null;
    this.restInflight = null;
    this.startPromise = null;
    this.wsReady = false;
    /** @type {Map<string, number>} */
    this.wsEventLogCount = new Map();
  }

  /** 控制台打印当前镜像：持仓 + 普通挂单 + 条件单 */
  logDump(tag = 'dump') {
    if (!DEBUG_ACCOUNT_MIRROR) return;
    const positions = Array.from(this.positions.values()).map(summarizePosition);
    const openOrders = Array.from(this.openOrders.values()).map(summarizeOrder);
    const algoOrders = Array.from(this.algoOrders.values()).map(summarizeAlgo);
    console.log(
      `%c[BinanceAccountMirror] ${tag}`,
      'color:#1677ff;font-weight:bold',
      {
        status: this.getStatus(),
        hedgeMode: this.hedgeMode,
        positions,
        openOrders,
        algoOrders,
      }
    );
    // 再各打一张表，方便在 Console 里扫
    if (positions.length) {
      console.table(positions);
    } else {
      console.log('[BinanceAccountMirror] 持仓：空');
    }
    if (openOrders.length) {
      console.log('[BinanceAccountMirror] 普通挂单 openOrders:');
      console.table(openOrders);
    } else {
      console.log('[BinanceAccountMirror] 普通挂单：空');
    }
    if (algoOrders.length) {
      console.log('[BinanceAccountMirror] 条件单 algoOrders:');
      console.table(algoOrders);
    } else {
      console.log('[BinanceAccountMirror] 条件单：空');
    }
  }

  getStatus() {
    return {
      wanted: this.wanted,
      bootstrapped: this.bootstrapped,
      wsReady: this.wsReady,
      listenKey: this.listenKey ? `${String(this.listenKey).slice(0, 6)}…` : null,
      activeUrl: this.activeUrl,
      lastRestAt: this.lastRestAt,
      lastWsMsgAt: this.lastWsMsgAt,
      positionCount: this.positions.size,
      openOrderCount: this.openOrders.size,
      algoOrderCount: this.algoOrders.size,
      hedgeMode: this.hedgeMode,
      lastError: this.lastError,
    };
  }

  snapshot() {
    return {
      ok: this.bootstrapped,
      positions: Array.from(this.positions.values()),
      openOrders: Array.from(this.openOrders.values()),
      algoOrders: Array.from(this.algoOrders.values()),
      hedgeMode: this.hedgeMode,
      via: this.wsReady ? 'ws' : 'rest',
      updatedAt: Math.max(this.lastRestAt, this.lastWsMsgAt) || 0,
      lastRestAt: this.lastRestAt,
      lastWsMsgAt: this.lastWsMsgAt,
      error: this.bootstrapped ? null : this.lastError,
    };
  }

  async start() {
    this.wanted = true;
    if (this.bootstrapped && (this.wsReady || this.ws || this.reconnectTimer)) {
      if (!this.keepAliveTimer) this.scheduleKeepAlive();
      return this.snapshot();
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      await this.bootstrapRest('start');
      if (!this.wanted) return this.snapshot();
      this.connectWs();
      this.scheduleKeepAlive();
      return this.snapshot();
    })().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  stop() {
    this.wanted = false;
    this.connectGen += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.detachWs();
    this.wsReady = false;
    const key = this.listenKey;
    this.listenKey = null;
    if (key) {
      closeFuturesListenKey().catch(() => {});
    }
  }

  scheduleKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = setInterval(() => {
      if (!this.wanted) return;
      keepaliveFuturesListenKey()
        .then(r => {
          if (!r?.ok) {
            console.warn('[BinanceAccountMirror] keepalive', r?.error);
            this.reconnectWs('keepalive_fail');
          }
        })
        .catch(e => console.warn('[BinanceAccountMirror] keepalive', e));
    }, KEEP_ALIVE_MS);
  }

  async ensureListenKey() {
    if (this.listenKey) return this.listenKey;
    const created = await createFuturesListenKey();
    if (!created?.ok || !created.listenKey) {
      throw new Error(created?.error || '创建 listenKey 失败');
    }
    this.listenKey = created.listenKey;
    this.urlIndex = 0;
    if (DEBUG_ACCOUNT_MIRROR) {
      console.log(
        '%c[BinanceAccountMirror] listenKey 已创建',
        'color:#1677ff;font-weight:bold',
        `${String(this.listenKey).slice(0, 8)}…（长度 ${String(this.listenKey).length}）`
      );
    }
    return this.listenKey;
  }

  detachWs() {
    const ws = this.ws;
    this.ws = null;
    this.activeUrl = null;
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

  connectWs() {
    if (!this.wanted) return;
    if (typeof WebSocket === 'undefined') {
      this.lastError = '环境不支持 WebSocket';
      return;
    }
    this.connectGen += 1;
    const gen = this.connectGen;
    this.detachWs(); 

    (async () => {
      try {
        const key = await this.ensureListenKey();
        if (!this.wanted || gen !== this.connectGen) return;
        const urls = buildFuturesUserDataWsUrls(key);
        const url = urls[this.urlIndex % urls.length];
        this.activeUrl = url;
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          if (gen !== this.connectGen) return;
          this.wsReady = true;
          this.lastError = null;
          this.wsEventLogCount.clear();
          console.log(
            '%c[BinanceAccountMirror] User Data Stream 已连接',
            'color:#52c41a;font-weight:bold',
            url.replace(key, '***')
          );
          // 连接成功时先打印 REST 打底的仓位/委托，便于对照
          this.logDump('WS已连接 · 当前镜像（来自 REST 打底，等待推送）');
        };

        ws.onmessage = ev => {
          if (gen !== this.connectGen) return;
          this.lastWsMsgAt = Date.now();
          try {
            const raw = JSON.parse(ev.data);
            const msg = raw?.data && raw?.stream ? raw.data : raw;
            this.handleStreamMessage(msg);
          } catch (e) {
            console.warn('[BinanceAccountMirror] parse', e, ev?.data);
          }
        };

        ws.onerror = () => {
          if (gen !== this.connectGen) return;
          this.lastError = 'user stream error';
          console.warn('[BinanceAccountMirror] User Data Stream error', this.activeUrl);
        };

        ws.onclose = ev => {
          if (gen !== this.connectGen) return;
          this.wsReady = false;
          this.ws = null;
          console.warn(
            '[BinanceAccountMirror] User Data Stream 关闭',
            { code: ev?.code, reason: ev?.reason, wasClean: ev?.wasClean, url: this.activeUrl }
          );
          if (!this.wanted) return;
          // 换下一个 URL 候选
          this.urlIndex += 1;
          this.scheduleReconnect('close');
        };
      } catch (e) {
        this.lastError = e?.message || String(e);
        console.error('[BinanceAccountMirror] 建立 WS 失败', e);
        if (this.wanted) this.scheduleReconnect('connect_fail');
      }
    })();
  }

  scheduleReconnect(reason) {
    if (!this.wanted) return;
    if (this.reconnectTimer) return;
    const attempt = this.urlIndex;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.min(8, 1 + (attempt % 8)));
    console.warn('[BinanceAccountMirror] reconnect', reason, `in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wanted) return;
      // listenKey 可能失效：清掉再拿
      if (reason === 'listenKeyExpired' || reason === 'keepalive_fail') {
        this.listenKey = null;
      }
      this.connectWs();
      // 重连后 REST 对账，避免漏事件
      this.bootstrapRest(`reconnect:${reason}`).catch(e => {
        console.warn('[BinanceAccountMirror] reconcile after reconnect', e);
      });
    }, delay);
  }

  reconnectWs(reason) {
    this.listenKey = null;
    this.scheduleReconnect(reason);
  }

  handleStreamMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const event = String(msg.e || msg.eventType || '').toUpperCase() || 'UNKNOWN';
    if (DEBUG_ACCOUNT_MIRROR) {
      const n = this.wsEventLogCount.get(event) || 0;
      if (n < WS_EVENT_LOG_LIMIT) {
        this.wsEventLogCount.set(event, n + 1);
        console.log(
          `%c[BinanceAccountMirror] WS 事件 #${n + 1} ${event}`,
          'color:#722ed1;font-weight:bold',
          msg
        );
      }
    }
    if (event === 'LISTENKEYEXPIRED' || msg.listenKeyExpired) {
      console.warn('[BinanceAccountMirror] listenKeyExpired，将重连');
      this.reconnectWs('listenKeyExpired');
      return;
    }
    const shouldDumpAfter = () => {
      if (!DEBUG_ACCOUNT_MIRROR) return false;
      // 与原文事件共用计数：每种事件前 N 次才 dump，避免刷屏
      return (this.wsEventLogCount.get(event) || 0) <= WS_EVENT_LOG_LIMIT;
    };
    if (event === 'ACCOUNT_UPDATE') {
      this.applyAccountUpdate(msg);
      if (shouldDumpAfter()) this.logDump(`WS ${event} 后`);
      return;
    }
    if (event === 'ORDER_TRADE_UPDATE') {
      this.applyOrderUpdate(msg.o || msg.order || msg);
      if (shouldDumpAfter()) this.logDump(`WS ${event} 后`);
      return;
    }
    if (event === 'ALGO_UPDATE' || event === 'ALGO_ORDER_UPDATE') {
      this.applyAlgoUpdate(msg.o || msg.ao || msg.algoOrder || msg);
      if (shouldDumpAfter()) this.logDump(`WS ${event} 后`);
    }
  }

  applyAccountUpdate(msg) {
    const positions = msg?.a?.P || msg?.a?.positions || [];
    if (!Array.isArray(positions)) return;
    positions.forEach(p => {
      const symbol = String(p.s || p.symbol || '').toUpperCase();
      if (!symbol) return;
      const positionSide = String(p.ps || p.positionSide || 'BOTH').toUpperCase();
      const amt = Number(p.pa ?? p.positionAmt);
      const key = posKey(symbol, positionSide);
      if (!Number.isFinite(amt) || amt === 0) {
        this.positions.delete(key);
        return;
      }
      const prev = this.positions.get(key) || {};
      const firstUpdateTime = Number(prev.openTime || prev.updateTime) || Number(p.T || p.updateTime) || Date.now();
      this.positions.set(key, {
        ...prev,
        symbol,
        positionSide,
        positionAmt: String(amt),
        entryPrice: p.ep != null ? String(p.ep) : prev.entryPrice,
        markPrice: p.mp != null ? String(p.mp) : prev.markPrice,
        openTime: firstUpdateTime,
        updateTime: firstUpdateTime,
        unrealizedProfit: p.up != null ? String(p.up) : prev.unrealizedProfit,
      });
    });
  }

  applyOrderUpdate(o) {
    if (!o || typeof o !== 'object') return;
    const symbol = String(o.s || o.symbol || '').toUpperCase();
    const orderId = o.i ?? o.orderId;
    const clientOrderId = o.c || o.clientOrderId;
    const status = o.X || o.status;
    const normalized = {
      symbol,
      orderId,
      clientOrderId,
      side: o.S || o.side,
      positionSide: o.ps || o.positionSide,
      type: o.o || o.type,
      origType: o.ot || o.origType,
      status,
      price: o.p || o.price,
      origQty: o.q || o.origQty,
      stopPrice: o.sp || o.stopPrice,
      reduceOnly: o.R ?? o.reduceOnly,
      time: o.T || o.time,
      updateTime: o.T || o.updateTime || Date.now(),
    };
    const key = orderKey(normalized);
    if (!key) return;
    if (isTerminalOrderStatus(status)) {
      auditOrderEvent('order_terminal', normalized, { source: 'ORDER_TRADE_UPDATE' });
      this.openOrders.delete(key);
      return;
    }
    this.openOrders.set(key, { ...this.openOrders.get(key), ...normalized });
  }

  applyAlgoUpdate(o) {
    if (!o || typeof o !== 'object') return;
    const symbol = String(o.s || o.symbol || '').toUpperCase();
    const algoId = o.aid ?? o.algoId ?? o.algoOrderId;
    const clientAlgoId = o.clientAlgoId || o.caid || o.c;
    const status = o.X || o.x || o.status || o.algoStatus;
    const normalized = {
      symbol,
      algoId,
      clientAlgoId,
      side: o.S || o.side,
      positionSide: o.ps || o.positionSide,
      type: o.o || o.orderType || o.type,
      orderType: o.o || o.orderType || o.type,
      algoType: o.algoType || o.at,
      status,
      triggerPrice: o.triggerPrice ?? o.sp ?? o.stopPrice,
      activatePrice: o.activatePrice ?? o.ap,
      callbackRate: o.callbackRate ?? o.cr,
      quantity: o.q ?? o.quantity,
      reduceOnly: o.R ?? o.reduceOnly,
      closePosition: o.closePosition,
      updateTime: o.T || o.updateTime || Date.now(),
    };
    const key = algoKey(normalized);
    if (!key) return;
    if (isTerminalAlgoStatus(status)) {
      auditOrderEvent('algo_terminal', normalized, { source: 'ALGO_UPDATE' });
      this.algoOrders.delete(key);
      return;
    }
    // 部分推送不带终态字段，但数量已空
    if (normalized.quantity != null && !(Number(normalized.quantity) > 0) && !normalized.closePosition) {
      this.algoOrders.delete(key);
      return;
    }
    this.algoOrders.set(key, { ...this.algoOrders.get(key), ...normalized });
  }

  applyRestBootstrap({ positions, orders, algos, hedgeMode }) {
    this.positions.clear();
    (positions || []).forEach(p => {
      const symbol = String(p?.symbol || '').toUpperCase();
      if (!symbol) return;
      const amt = Number(p.positionAmt || 0);
      if (!(amt !== 0 && Number.isFinite(amt))) return;
      const positionSide = String(p.positionSide || 'BOTH').toUpperCase();
      this.positions.set(posKey(symbol, positionSide), { ...p, symbol, positionSide });
    });

    this.openOrders.clear();
    (orders || []).forEach(o => {
      const key = orderKey(o);
      if (!key) return;
      this.openOrders.set(key, o);
    });

    this.algoOrders.clear();
    (algos || []).forEach(o => {
      const key = algoKey(o);
      if (!key) return;
      this.algoOrders.set(key, o);
    });

    if (typeof hedgeMode === 'boolean') this.hedgeMode = hedgeMode;
    this.bootstrapped = true;
    this.lastRestAt = Date.now();
  }

  async bootstrapRest(reason = 'manual') {
    if (this.restInflight) return this.restInflight;
    this.restInflight = (async () => {
      const [posRes, orderRes, algoRes, modeRes] = await Promise.all([
        getPositionRisk({}),
        getOpenOrders({}),
        getOpenAlgoOrders({}),
        getPositionMode(),
      ]);
      if (!posRes?.ok) {
        this.lastError = pickErr(posRes) || 'positionRisk';
        throw new Error(`账户镜像 REST 失败：${this.lastError}（${reason}）`);
      }
      // openOrders / algo 失败时仍用持仓打底，但标记错误
      if (!orderRes?.ok) {
        console.warn('[BinanceAccountMirror] openOrders', pickErr(orderRes));
      }
      if (!algoRes?.ok) {
        console.warn('[BinanceAccountMirror] openAlgoOrders', pickErr(algoRes));
      }
      this.applyRestBootstrap({
        positions: responseList(posRes),
        orders: orderRes?.ok ? responseList(orderRes) : [],
        algos: algoRes?.ok ? responseList(algoRes) : [],
        hedgeMode: Boolean(modeRes?.response?.dualSidePosition),
      });
      if (!orderRes?.ok || !algoRes?.ok) {
        this.lastError = [pickErr(orderRes), pickErr(algoRes)].filter(Boolean).join(' / ');
      } else {
        this.lastError = null;
      }
      this.logDump(`REST 打底完成（${reason}）`);
      return this.snapshot();
    })().finally(() => {
      this.restInflight = null;
    });
    return this.restInflight;
  }

  /**
   * @param {{ forceRest?: boolean, ensureStarted?: boolean }} [opts]
   */
  async getSnapshot(opts = {}) {
    const { forceRest = false, ensureStarted = true } = opts;
    if (ensureStarted) {
      await this.start();
    }

    const needReconcile =
      forceRest ||
      !this.bootstrapped ||
      (this.lastRestAt > 0 && Date.now() - this.lastRestAt > RECONCILE_MS);

    if (needReconcile) {
      try {
        await this.bootstrapRest(forceRest ? 'force' : 'reconcile');
      } catch (e) {
        if (!this.bootstrapped) throw e;
        console.warn('[BinanceAccountMirror] reconcile failed, use memory', e);
      }
    }

    return this.snapshot();
  }
}

/** @type {BinanceAccountMirror|null} */
let shared = null;
/** 横盘 / 暴涨等监控引用计数；归零才关 WS */
let acquireCount = 0;

export const getSharedBinanceAccountMirror = () => {
  if (!shared) shared = new BinanceAccountMirror();
  return shared;
};

/** 启动镜像（幂等）；也可直接 getSnapshot 自动 start */
export const startBinanceAccountMirror = () => getSharedBinanceAccountMirror().start();

/** 监控组件挂载时 acquire，卸载/停止时 release（共享复用） */
export const acquireBinanceAccountMirror = async () => {
  acquireCount += 1;
  return getSharedBinanceAccountMirror().start();
};

export const releaseBinanceAccountMirror = () => {
  acquireCount = Math.max(0, acquireCount - 1);
  if (acquireCount === 0 && shared) {
    shared.stop();
  }
};

export const stopBinanceAccountMirror = () => {
  acquireCount = 0;
  if (!shared) return;
  shared.stop();
};

/**
 * 读取账户快照。默认走内存（WS 维护）；forceRest 才打全量 REST。
 * 未启动时会自动 start。
 */
export const getBinanceAccountSnapshot = async (opts = {}) =>
  getSharedBinanceAccountMirror().getSnapshot(opts);

/** 下单/撤单后调用：强制 REST 对账一次 */
export const refreshBinanceAccountMirror = async () =>
  getSharedBinanceAccountMirror().getSnapshot({ forceRest: true, ensureStarted: true });

export const getBinanceAccountMirrorStatus = () => ({
  ...getSharedBinanceAccountMirror().getStatus(),
  acquireCount,
});
