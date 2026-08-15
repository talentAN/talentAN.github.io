/**
 * 合约交易记录标准格式（跨交易所统一）
 *
 * 以「开/平仓价值」表达仓位规模，不以数量/杠杆做主字段。
 * 字段形态对齐本地 all.json，便于合并与列表展示。
 *
 * exchange 可含 binance：仅用于手动导入记录的链接/ enrich，
 * 不表示会远程拉取 Binance（见 _index.js EXCHANGE_FETCHERS 注释）。
 */

export const EXCHANGE = {
  BITGET: 'bitget',
  /** 手动导入用；不在远程自动拉取列表中 */
  BINANCE: 'binance',
};

export const EXCHANGE_LABEL = {
  [EXCHANGE.BITGET]: 'Bitget',
  [EXCHANGE.BINANCE]: 'Binance',
};

/** 无 exchange 字段（或空）一律按 Bitget */
export function resolveExchange(recordOrExchange) {
  if (recordOrExchange && typeof recordOrExchange === 'object') {
    return recordOrExchange.exchange || EXCHANGE.BITGET;
  }
  return recordOrExchange || EXCHANGE.BITGET;
}

/** 价值 = 均价 × 数量；显式 notional 优先 */
export function resolveNotional(explicit, price, qty) {
  if (explicit != null && explicit !== '') {
    const n = parseFloat(explicit);
    if (!Number.isNaN(n)) return String(n);
  }
  const p = parseFloat(price);
  const q = parseFloat(qty);
  if (!Number.isNaN(p) && !Number.isNaN(q) && q !== 0) {
    return String(p * q);
  }
  return '';
}

/**
 * 为缺 openNotional/closeNotional 的旧本地记录补价值（兼容 openTotalPos）
 */
export function ensureNotionals(record) {
  if (!record || record.type === 'summery') return record;
  return {
    ...record,
    exchange: resolveExchange(record),
    openNotional: resolveNotional(record.openNotional, record.openAvgPrice, record.openTotalPos),
    closeNotional: resolveNotional(
      record.closeNotional,
      record.closeAvgPrice,
      record.closeTotalPos
    ),
  };
}

/**
 * @param {object} partial
 * @returns {object} 标准交易记录
 */
export function createStandardRecord(partial = {}) {
  const exchange = resolveExchange(partial);
  const openNotional = resolveNotional(
    partial.openNotional,
    partial.openAvgPrice,
    partial.openTotalPos
  );
  const closeNotional = resolveNotional(
    partial.closeNotional,
    partial.closeAvgPrice,
    partial.closeTotalPos
  );

  return {
    exchange,
    positionId: partial.positionId,
    symbol: partial.symbol,
    marginCoin: partial.marginCoin || 'USDT',
    holdSide: partial.holdSide, // 'long' | 'short'
    openAvgPrice: String(partial.openAvgPrice ?? ''),
    closeAvgPrice: String(partial.closeAvgPrice ?? ''),
    marginMode: partial.marginMode || 'crossed',
    openNotional,
    closeNotional,
    pnl: String(partial.pnl ?? '0'),
    netProfit: String(partial.netProfit ?? '0'),
    totalFunding: String(partial.totalFunding ?? '0'),
    openFee: String(partial.openFee ?? '0'),
    closeFee: String(partial.closeFee ?? '0'),
    posMode: partial.posMode || '',
    cashDividend: String(partial.cashDividend ?? '0'),
    ctime: String(partial.ctime ?? ''),
    utime: String(partial.utime ?? ''),
    entryReason: partial.entryReason || '',
    remark: partial.remark || '',
    ...(partial.maxDrawdown != null && partial.maxDrawdown !== ''
      ? { maxDrawdown: partial.maxDrawdown }
      : {}),
    ...(partial.openBestPrice3d != null ? { openBestPrice3d: partial.openBestPrice3d } : {}),
    ...(partial.openPriceDiff != null ? { openPriceDiff: partial.openPriceDiff } : {}),
    ...(partial.closeBestPrice3d != null ? { closeBestPrice3d: partial.closeBestPrice3d } : {}),
    ...(partial.closePriceDiff != null ? { closePriceDiff: partial.closePriceDiff } : {}),
    ...(partial.tags ? { tags: partial.tags } : {}),
    ...(partial.type ? { type: partial.type } : {}),
    ...(partial.content ? { content: partial.content } : {}),
  };
}

export function getTradeLink(record) {
  const symbol = record?.symbol;
  if (!symbol) return '#';
  if (resolveExchange(record) === EXCHANGE.BINANCE) {
    return `https://www.binance.com/zh-CN/futures/${symbol}`;
  }
  return `https://www.bitget.com/zh-CN/futures/usdt/${symbol}`;
}
