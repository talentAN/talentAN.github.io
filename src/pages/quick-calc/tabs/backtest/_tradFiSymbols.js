import { getContracts } from '@root/src/container/market';
import { classifyRwaSymbol } from '@root/src/consts/usStockSelectorConfig';

/** Binance 股本类（美/港/韩/A），不含商品、外汇、盘前、加密指数 */
const BINANCE_EQUITY_TYPES = new Set([
  'EQUITY',
  'HK_EQUITY',
  'KR_EQUITY',
  'CN_EQUITY',
]);

/**
 * Bitget RWA 股票侧：
 * - stock / nonUs：个股与非美上市
 * - leveraged：个股杠杆/反向 ETF
 * - indexEtf：指数与板块 ETF（如 SPY/QQQ）
 * 不含 commodity / preIpo
 */
const BITGET_STOCK_CATEGORIES = new Set(['stock', 'nonUs', 'leveraged', 'indexEtf']);

/**
 * 股票 + ETF 合约 symbol 集合（大写）。
 * 用于回测 / 实盘「过滤股票 / ETF」。
 */
export const loadStockSymbolSet = async () => {
  const [binanceContracts, bitgetContracts] = await Promise.all([
    getContracts({}, 'binance'),
    getContracts({}, 'bitget'),
  ]);
  const symbols = new Set();
  (binanceContracts || []).forEach(c => {
    if (
      BINANCE_EQUITY_TYPES.has(c.underlyingType)
      && c.quoteAsset === 'USDT'
      && c.symbol
    ) {
      symbols.add(String(c.symbol).toUpperCase());
    }
  });
  (bitgetContracts || []).forEach(c => {
    if (c.isRwa !== 'YES' || !c.symbol) return;
    const category = classifyRwaSymbol(c.baseCoin);
    if (BITGET_STOCK_CATEGORIES.has(category)) {
      symbols.add(String(c.symbol).toUpperCase());
    }
  });
  return symbols;
};

/** @deprecated 用 loadStockSymbolSet */
export const loadTradFiSymbolSet = loadStockSymbolSet;
