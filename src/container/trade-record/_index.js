import localRecords from '@root/contract-record/all.json';
import { fillMissingBestPrices } from './_enrich';
import { fillMaxDrawdowns } from './_maxDrawdown';
import { EXCHANGE, EXCHANGE_LABEL, ensureNotionals } from './_schema';

/**
 * 历史仓位：只读本地 `contract-record/all.json`，人工维护，不走交易所接口。
 *
 * 原因：Binance 无 Bitget 式 history-position，用成交重建不可靠且易与手写 id 重复；
 * 下单/持仓查询仍用 Binance 签名 API，与本模块无关。
 *
 * 维护约定：
 * - 新平仓后往 all.json 追加标准字段（见 _schema.createStandardRecord）
 * - `exchange`: `binance` | `bitget`（缺省按 bitget）
 * - `ignore: true` 的行不进入列表
 * - 最优价差 / 最大回撤缺省时仍按 exchange 拉公开 K 线补齐（非仓位接口）
 */
const EXCHANGE_FETCHERS = [];

/**
 * 缺开仓最优差 / 最大回撤时，按记录来源交易所拉公开 K 线补齐
 */
async function fillMissingMetrics(records) {
  const withBest = await fillMissingBestPrices(records);
  return fillMaxDrawdowns(withBest);
}

/**
 * 加载本地交易记录 → 补齐缺省指标
 * @param {{ startTime?: string, endTime?: string }} [_params] 保留参数位；历史仓位不再按接口日期拉取
 * @returns {Promise<{ records: object[], stats: object, errors: object[], fallback: boolean }>}
 */
export async function fetchAllTradeRecords(_params = {}) {
  const localData = (localRecords || []).filter(r => !r.ignore).map(ensureNotionals);
  const byExchange = localData.reduce((acc, row) => {
    if (row.type === 'summery') return acc;
    const ex = row.exchange || EXCHANGE.BITGET;
    acc[ex] = (acc[ex] || 0) + 1;
    return acc;
  }, {});

  const filled = await fillMissingMetrics(localData);

  return {
    records: filled.map(ensureNotionals),
    stats: byExchange,
    errors: [],
    fallback: false,
  };
}

export { EXCHANGE, EXCHANGE_LABEL, EXCHANGE_FETCHERS };
export { getTradeLink, ensureNotionals, resolveExchange } from './_schema';
export { fillMaxDrawdowns } from './_maxDrawdown';
export { fillMissingBestPrices } from './_enrich';
