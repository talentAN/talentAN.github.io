/**
 * 币对级 REST 账本：持仓 + 挂单 + 条件单（不读 WS 镜像）。
 * 仅本机无成功下单缓存时由 placeGate 调用。
 */

import {
  getPositionRisk,
  getOpenOrders,
  getOpenAlgoOrders,
} from './api/query';

/** 从签名响应里抽出可读错误文案 */
const pickErr = result =>
  result?.error ||
  result?.response?.msg ||
  result?.response?.message ||
  (result?.httpStatus != null ? `HTTP ${result.httpStatus}` : null);

/** 把接口 body 规范成数组（兼容 data / orders / algoOrders 包一层） */
const responseList = result => {
  const response = result?.response;
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.orders)) return response.orders;
  if (Array.isArray(response?.algoOrders)) return response.algoOrders;
  return [];
};

/** 组装查询失败时的空账本 */
const emptyBook = (symbol, error, extra = {}) => ({
  ok: false,
  symbol,
  positions: [],
  openOrders: [],
  algoOrders: [],
  error,
  ...extra,
});

/**
 * 并行拉某币对的持仓、挂单、条件单。
 * 返回 { ok, positions, openOrders, algoOrders }；失败 ok=false 且带 error。
 */
export const fetchBinanceSymbolLiveBook = async symbol => {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return emptyBook('', 'missing_symbol');

  try {
    const [posResult, orderResult, algoResult] = await Promise.all([
      getPositionRisk({ symbol: sym }),
      getOpenOrders({ symbol: sym }),
      getOpenAlgoOrders({ symbol: sym }),
    ]);

    if (!posResult?.ok || !orderResult?.ok || !algoResult?.ok) {
      return emptyBook(
        sym,
        [pickErr(posResult), pickErr(orderResult), pickErr(algoResult)]
          .filter(Boolean)
          .join(' / ') || 'symbol live book query failed',
        { posResult, orderResult, algoResult }
      );
    }

    return {
      ok: true,
      symbol: sym,
      positions: responseList(posResult),
      openOrders: responseList(orderResult),
      algoOrders: responseList(algoResult),
      posResult,
      orderResult,
      algoResult,
    };
  } catch (e) {
    return emptyBook(sym, e?.message || String(e));
  }
};
