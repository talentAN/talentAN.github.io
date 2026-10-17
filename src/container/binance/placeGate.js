/**
 * 下单闸门：防双机重复，并在本机已成功落盘时跳过 REST。
 *
 * 出场：本地缓存 → REST 账本 → 已有则跳过 / 放行 place → 成功后 remember
 * 开仓：peekLocalOpenSuccess / rememberOpenSuccess（REST 解析仍在业务侧）
 */

import { fetchBinanceSymbolLiveBook } from './liveExposure';
import {
  hasPlaceSuccess,
  markPlaceSuccess,
  PlaceIntent,
} from './placeSuccessCache';

export { PlaceIntent, fetchBinanceSymbolLiveBook };

/** 把账本里的挂单和条件单合成一张表 */
export const listBookOrders = book => [
  ...(book?.algoOrders || []),
  ...(book?.openOrders || []),
];

/** long/short → 对应的 PlaceIntent */
const openIntentForSide = side =>
  side === 'long' ? PlaceIntent.OPEN_LONG : PlaceIntent.OPEN_SHORT;

/**
 * 查本机是否已有该方向开仓成功缓存。
 * 命中返回 { hit:true, reason, detail }，否则 { hit:false }。
 */
export const peekLocalOpenSuccess = ({ exchange = 'binance', symbol, side } = {}) => {
  if (side !== 'long' && side !== 'short') return { hit: false };
  if (
    !hasPlaceSuccess({
      exchange,
      symbol,
      intent: openIntentForSide(side),
    })
  ) {
    return { hit: false };
  }
  return {
    hit: true,
    reason: 'has_orders',
    detail: side === 'long' ? '本机已成功开多缓存' : '本机已成功开空缓存',
  };
};

/**
 * 开仓成功或 REST 确认有开仓敞口后写入本机缓存。
 * side 必须是 long/short；source 如 place / rest_confirm。
 */
export const rememberOpenSuccess = ({
  exchange = 'binance',
  symbol,
  side,
  source = 'place',
  meta,
} = {}) => {
  if (side !== 'long' && side !== 'short') return;
  markPlaceSuccess({
    exchange,
    symbol,
    intent: openIntentForSide(side),
    source,
    meta,
  });
};

/**
 * 出场发单前闸门：本地有缓存或交易所已有同类单 → 不让 place。
 * alreadyOnBook(book) 由调用方判断「账本上是否已有这笔出场」。
 * 返回 allowPlace / alreadyExists / queryFailed。
 */
export const gateBeforeExitPlace = async ({
  symbol,
  intent,
  tag = '',
  alreadyOnBook,
  localDetail = '本机已挂出场缓存',
  restDetail = '已有出场委托（REST）',
} = {}) => {
  const sym = String(symbol || '').toUpperCase();
  if (!sym || !intent || typeof alreadyOnBook !== 'function') {
    return { allowPlace: false, queryFailed: true, detail: '闸门参数无效' };
  }

  // 本机已成功挂过 → 直接挡
  if (hasPlaceSuccess({ exchange: 'binance', symbol: sym, intent, tag })) {
    return {
      allowPlace: false,
      alreadyExists: true,
      fromLocalCache: true,
      detail: localDetail,
    };
  }

  // 无本地记录才打 REST
  const book = await fetchBinanceSymbolLiveBook(sym);
  if (!book.ok) {
    return {
      allowPlace: false,
      queryFailed: true,
      detail: book.error || '实时委托查询失败',
    };
  }

  // 交易所已有 → 记缓存并挡，避免同机反复 REST
  if (alreadyOnBook(book)) {
    markPlaceSuccess({
      exchange: 'binance',
      symbol: sym,
      intent,
      tag,
      source: 'rest_confirm',
    });
    return {
      allowPlace: false,
      alreadyExists: true,
      fromLocalCache: false,
      detail: restDetail,
      book,
    };
  }

  return { allowPlace: true, book };
};

/** place 成功后写入本机出场缓存，下次同 intent/tag 可跳过 REST */
export const rememberExitSuccess = ({
  symbol,
  intent,
  tag = '',
  source = 'place',
  meta,
} = {}) => {
  markPlaceSuccess({
    exchange: 'binance',
    symbol,
    intent,
    tag,
    source,
    meta,
  });
};
