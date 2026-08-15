import localRecords from '@root/contract-record/all.json';
import { enrichRecordsWithBestPrices, fillMissingBestPrices } from './_enrich';
import { fillMaxDrawdowns } from './_maxDrawdown';
import { mergeRemoteWithLocal } from './_merge';
import { EXCHANGE, EXCHANGE_LABEL, ensureNotionals } from './_schema';
import { fetchBitgetTradeRecords } from './exchanges/_bitget';

/**
 * 远程自动拉取的交易所列表。
 *
 * 为何不自动拉 Binance：
 * - 币安 U 本位没有与 Bitget `history-position` 对等的「历史仓位」接口，
 *   只能用 income + userTrades 自行重建，准确度/覆盖窗口都不如官方仓位单。
 * - 浏览器直连私有接口还有 CORS 问题，本地代理也仅 develop 可用。
 * - 因此 Binance 仓位改为人工导出后写入本地 all.json（标准格式），再走合并展示；
 *   schema 仍保留 exchange=binance，便于链接与 K 线 enrich。
 */
const EXCHANGE_FETCHERS = [
  { id: EXCHANGE.BITGET, label: EXCHANGE_LABEL[EXCHANGE.BITGET], fetch: fetchBitgetTradeRecords },
];

/**
 * 缺开仓最优差 / 最大回撤时，按记录来源交易所拉 K 线补齐
 */
async function fillMissingMetrics(records) {
  const withBest = await fillMissingBestPrices(records);
  return fillMaxDrawdowns(withBest);
}

/**
 * 依次获取各所交易数据 → 标准格式 → 最优价 enrich → 与本地合并排序 → 缺值补齐
 * @param {{ startTime?: string, endTime?: string }} params
 * @returns {Promise<{ records: object[], stats: object, errors: object[] }>}
 */
export async function fetchAllTradeRecords(params = {}) {
  const localData = (localRecords || []).filter(r => !r.ignore).map(ensureNotionals);
  const remoteAll = [];
  const stats = {};
  const errors = [];

  for (const ex of EXCHANGE_FETCHERS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const list = await ex.fetch(params);
      stats[ex.id] = list.length;
      remoteAll.push(...list);
      console.log(`[trade-record] ${ex.label}: ${list.length} 条`);
    } catch (error) {
      console.warn(`[trade-record] ${ex.label} 拉取失败`, error);
      stats[ex.id] = 0;
      errors.push({ exchange: ex.id, message: error?.message || String(error) });
    }
  }

  if (remoteAll.length === 0) {
    const filled = await fillMissingMetrics(localData);
    return {
      records: filled.map(ensureNotionals),
      stats,
      errors,
      fallback: true,
    };
  }

  const enriched = await enrichRecordsWithBestPrices(remoteAll);
  const merged = mergeRemoteWithLocal(enriched, localData).map(ensureNotionals);
  const filled = await fillMissingMetrics(merged);

  return {
    records: filled.map(ensureNotionals),
    stats,
    errors,
    fallback: false,
  };
}

export { EXCHANGE, EXCHANGE_LABEL, EXCHANGE_FETCHERS };
export { getTradeLink, ensureNotionals, resolveExchange } from './_schema';
export { fillMaxDrawdowns } from './_maxDrawdown';
export { fillMissingBestPrices } from './_enrich';
