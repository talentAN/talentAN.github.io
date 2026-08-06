import { authenticatedRequest } from '../../bitget/utils/auth';
import { createStandardRecord, EXCHANGE } from '../_schema';

/**
 * 拉取 Bitget 历史仓位并转为标准格式
 * @param {{ startTime?: string, endTime?: string }} params
 */
export async function fetchBitgetTradeRecords(params = {}) {
  const requestParams = {
    productType: 'USDT-FUTURES',
    ...params,
  };

  const response = await authenticatedRequest(
    'GET',
    '/api/v2/mix/position/history-position',
    requestParams
  );

  if (response?.code !== '00000') {
    const msg = response?.msg || response?.message || JSON.stringify(response);
    throw new Error(`Bitget history-position 失败: ${msg}`);
  }

  const list = response.data?.list || [];
  return list.map(raw =>
    createStandardRecord({
      exchange: EXCHANGE.BITGET,
      positionId: String(raw.positionId),
      symbol: raw.symbol,
      marginCoin: raw.marginCoin,
      holdSide: raw.holdSide,
      openAvgPrice: raw.openAvgPrice,
      closeAvgPrice: raw.closeAvgPrice,
      marginMode: raw.marginMode,
      // 价值优先；数量仅作推算输入，不进入标准主字段
      openTotalPos: raw.openTotalPos,
      closeTotalPos: raw.closeTotalPos,
      pnl: raw.pnl,
      netProfit: raw.netProfit,
      totalFunding: raw.totalFunding,
      openFee: raw.openFee,
      closeFee: raw.closeFee,
      posMode: raw.posMode,
      cashDividend: raw.cashDividend,
      ctime: raw.ctime,
      utime: raw.utime,
    })
  );
}
