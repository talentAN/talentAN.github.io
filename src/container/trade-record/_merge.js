/**
 * 远程记录与本地 all.json 合并，保持现有排序：
 * 1) 远程有、本地无 → 置顶（按各所拉取顺序）
 * 2) 按本地原始顺序：有远程则叠加最优价字段，否则保留本地
 */

import { resolveExchange } from './_schema';

export function mergeRemoteWithLocal(remoteList = [], localList = []) {
  const localMap = new Map(localList.map(r => [r.positionId, r]));
  const remoteMap = new Map(remoteList.map(r => [r.positionId, r]));
  const merged = [];

  remoteList.forEach(remote => {
    if (!localMap.has(remote.positionId)) {
      merged.push({
        ...remote,
        exchange: resolveExchange(remote),
        entryReason: remote.entryReason || '',
        remark: remote.remark || '',
      });
    }
  });

  localList.forEach(local => {
    if (remoteMap.has(local.positionId)) {
      const remote = remoteMap.get(local.positionId);
      merged.push({
        ...local,
        exchange: resolveExchange(local.exchange || remote.exchange),
        openBestPrice3d: remote.openBestPrice3d,
        openPriceDiff: remote.openPriceDiff,
        closeBestPrice3d: remote.closeBestPrice3d,
        closePriceDiff: remote.closePriceDiff,
      });
    } else {
      merged.push({
        ...local,
        exchange: resolveExchange(local),
      });
    }
  });

  return merged;
}
