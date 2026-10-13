import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Popconfirm, Space, Table, Tag, message } from 'antd';
import {
  acquireBinanceAccountMirror,
  getBinanceAccountSnapshot,
  releaseBinanceAccountMirror,
  refreshBinanceAccountMirror,
} from '@root/src/container/binance/accountMirror';
import { getPositionMode } from '@root/src/container/binance/api/query';
import {
  placeFutureMarketOrder,
  placeFutureQtyTakeProfitAlgo,
  placeFutureTrailingStopAlgo,
} from '@root/src/container/binance/api/order';
import { getContracts } from '@root/src/container/binance/api';
import { isLiveOrderEnabled, quantizeQuantity } from './system_1/_autoOrderModel';
import { RANGE_MONITOR_TRAIL_CALLBACK_PCT as TRAIL_CALLBACK_RATE } from './low_vol_range_blast/_rangeMonitorParams';
import {
  calcMoveRatio,
  classifyBreakevenStopStatus,
  classifyTpTierStatus,
  classifyTrailStatus,
  directionFromUiSide,
  exitOrderSide,
  isBinanceTakeProfitOrder,
  isBinanceTrailingAlgo,
  isBreakevenStopAlgo,
  shouldArmFirstTier,
  tierTriggerPrice,
  tpTiersForDirection,
  trailActivateRawPrice,
} from './low_vol_range_blast/_rangeMonitorJudges';
import { getPositionOpenTime } from '@root/src/container/binance/positionOpenTime';
import { getPositionExtreme } from '@root/src/container/binance/positionExtremes';
let contractsPromise = null;
let positionModePromise = null;
const getCachedContracts = () => {
  if (!contractsPromise) contractsPromise = getContracts();
  return contractsPromise;
};
const getCachedPositionMode = async () => {
  if (!positionModePromise) positionModePromise = getPositionMode();
  return positionModePromise;
};
const formatFixed8 = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(8) : '—';
};

const fetchPostOpenExtreme = async ({ symbol, openTime, side, livePrice }) =>
  getPositionExtreme({ symbol, openTime, side, livePrice });

const baseRowsFromSnapshot = (snapshot, contracts = []) => {
  const contractMap = new Map((contracts || []).map(item => [item.symbol, item]));
  return (snapshot?.positions || [])
    .filter(p => Number(p.positionAmt || 0))
    .map(p => {
      const amount = Number(p.positionAmt || 0);
      const contract = contractMap.get(p.symbol) || {};
      const priceFilter = (contract.filters || []).find(item => item.filterType === 'PRICE_FILTER');
      const side = amount > 0 ? '多' : '空';
      return {
        key: `${p.symbol}:${p.positionSide || 'BOTH'}`,
        symbol: p.symbol,
        positionSide: String(p.positionSide || 'BOTH').toUpperCase(),
        side,
        quantity: Math.abs(amount),
        entryPrice: Number(p.entryPrice || 0),
        markPrice: Number(p.markPrice || 0),
        postOpenExtreme: null,
        tickSize: Number(priceFilter?.tickSize) || null,
        unrealizedProfit: Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0),
        openTime: 0,
        tp1Status: 'pending',
        tp2Status: 'pending',
        tp3Status: 'pending',
        trailStatus: 'pending',
        stopStatus: 'pending',
      };
    });
};

const enrichPositionRow = async (row, snapshot) => {
  const openTime = await getPositionOpenTime({ symbol: row.symbol, positionSide: row.positionSide });
  const effectiveOpenTime = openTime || Number(snapshot?.positions?.find(p => p.symbol === row.symbol && String(p.positionSide || 'BOTH').toUpperCase() === row.positionSide)?.updateTime) || 0;
  const postOpenExtreme = await fetchPostOpenExtreme({ symbol: row.symbol, openTime: effectiveOpenTime, side: row.side, livePrice: row.markPrice });
  // 止盈可能来自条件单接口，也可能是旧接口回退/手工下的普通挂单；两类都必须纳入查询。
  const symbolOrders = [
    ...(snapshot?.algoOrders || []),
    ...(snapshot?.openOrders || []),
  ].filter(order => String(order.symbol || '').toUpperCase() === row.symbol);
  // 单向仓 positionSide=BOTH，用 UI 多/空 映射方向，与引擎 LONG/SHORT 口径一致。
  const direction = directionFromUiSide(row.side);
  const pos = { positionSide: direction };
  const tpOrders = symbolOrders.filter(order => isBinanceTakeProfitOrder(order, direction));
  const trailOrders = symbolOrders.filter(order => isBinanceTrailingAlgo(order, direction));
  const breakevenStops = symbolOrders.filter(order =>
    isBreakevenStopAlgo(order, row.entryPrice, row.tickSize, direction)
  );
  const moveRatio =
    postOpenExtreme > 0 && row.entryPrice > 0
      ? calcMoveRatio(row.entryPrice, postOpenExtreme, direction)
      : null;
  const tiers = tpTiersForDirection(direction);
  const tpStatus = tier =>
    classifyTpTierStatus({
      tpOrders,
      pos,
      entry: row.entryPrice,
      tier,
      moveRatio,
      tickSize: row.tickSize,
    });
  return {
    ...row,
    openTime: Number(effectiveOpenTime) || 0,
    postOpenExtreme,
    tp1Status: tpStatus(tiers[0]),
    tp2Status: tpStatus(tiers[1]),
    tp3Status: tiers[2] ? tpStatus(tiers[2]) : 'pending',
    trailStatus: classifyTrailStatus({
      trailOrders,
      entry: row.entryPrice,
      xx: postOpenExtreme,
      direction,
    }),
    stopStatus: classifyBreakevenStopStatus({ trailOrders, breakevenStops, moveRatio }),
  };
};

const statusCell = status => {
  if (status === 'loading') return '…';
  if (status === 'placed') return <span style={{ color: '#52c41a' }}>✅ 已挂单</span>;
  if (status === 'filled') return <span style={{ color: '#52c41a' }}>✅ 已成交</span>;
  if (status === 'tracked') return <span style={{ color: '#52c41a' }}>✅ 已追踪</span>;
  if (status === 'cancelled') return <span style={{ color: '#52c41a' }}>✅ 已撤销</span>;
  if (status === 'pending') return <span style={{ color: '#8c8c8c' }}>暂未触发</span>;
  return <span style={{ color: '#f5222d' }}>❌</span>;
};

const PositionMonitor = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 持仓表用于核对交易所当前委托，不能只读 WS 内存快照：外部下单后 WS 可能尚未同步，先强制 REST 对账。
      const snapshot = await getBinanceAccountSnapshot({ forceRest: true, ensureStarted: true });
      if (!snapshot?.ok) throw new Error(snapshot?.error || '账户快照不可用');
      const contracts = await getCachedContracts();
      const nextRows = baseRowsFromSnapshot(snapshot, contracts);
      setRows(nextRows);
      nextRows.forEach(row => {
        enrichPositionRow(row, snapshot)
          .then(enriched => setRows(current => current.map(item => item.key === enriched.key ? enriched : item)))
          .catch(() => setRows(current => current.map(item => item.key === row.key ? { ...item, tp1Status: 'missing', tp2Status: 'missing', tp3Status: 'missing', trailStatus: 'missing', stopStatus: 'missing' } : item)));
      });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 只刷新单行：REST 对账后更新该持仓；已平仓则从表格移除。不触发整表 loading。 */
  const refreshRow = useCallback(async row => {
    const snapshot = await getBinanceAccountSnapshot({ forceRest: true, ensureStarted: true });
    if (!snapshot?.ok) throw new Error(snapshot?.error || '账户快照不可用');
    const contracts = await getCachedContracts();
    const nextRows = baseRowsFromSnapshot(snapshot, contracts);
    const next = nextRows.find(item => item.key === row.key);
    if (!next) {
      setRows(current => current.filter(item => item.key !== row.key));
      return { removed: true };
    }
    // 先写入数量/标记价等基础字段，再异步补全委托状态，避免整表闪烁。
    setRows(current => current.map(item => (item.key === next.key ? { ...item, ...next } : item)));
    try {
      const enriched = await enrichPositionRow(next, snapshot);
      setRows(current => current.map(item => (item.key === enriched.key ? enriched : item)));
    } catch (_) {
      setRows(current =>
        current.map(item =>
          item.key === row.key
            ? {
                ...item,
                ...next,
                tp1Status: 'missing',
                tp2Status: 'missing',
                tp3Status: 'missing',
                trailStatus: 'missing',
                stopStatus: 'missing',
              }
            : item
        )
      );
    }
    return { removed: false };
  }, []);

  useEffect(() => {
    let alive = true;
    acquireBinanceAccountMirror()
      .then(() => alive && load())
      .catch(e => alive && setError(e?.message || String(e)));
    return () => {
      alive = false;
      releaseBinanceAccountMirror();
    };
  }, [load]);

  const withRules = async symbol => {
    const [contracts, mode] = await Promise.all([getCachedContracts(), getCachedPositionMode()]);
    const contract = (contracts || []).find(item => item.symbol === symbol);
    const filters = contract?.filters || [];
    const priceFilter = filters.find(item => item.filterType === 'PRICE_FILTER');
    const lotFilter = filters.find(item => item.filterType === 'LOT_SIZE');
    return {
      tickSize: Number(priceFilter?.tickSize) || null,
      stepSize: Number(lotFilter?.stepSize) || null,
      quantityPrecision: contract?.quantityPrecision ?? 8,
      dualSidePosition: Boolean(mode?.response?.dualSidePosition),
    };
  };

  const placeTrail = async row => {
    if (!isLiveOrderEnabled()) throw new Error('交易未解锁');
    const rules = await withRules(row.symbol);
    const quantity = quantizeQuantity(row.quantity, rules.stepSize, rules.quantityPrecision);
    if (!(quantity > 0)) throw new Error('追踪数量无效');
    const entry = row.entryPrice;
    const mark = row.markPrice;
    const direction = directionFromUiSide(row.side);
    const pos = { positionSide: direction };
    const armRaw = trailActivateRawPrice(entry, direction);
    const extreme = Number(row.postOpenExtreme);
    // 极值已超武装点 → 不设激活价（立刻激活）；否则挂 1.4E / 0.75E
    let activatePrice = null;
    if (direction === 'LONG') {
      const alreadyPast = (extreme > 0 && extreme >= armRaw) || (mark > 0 && mark >= armRaw);
      if (!alreadyPast) {
        activatePrice = armRaw;
        if (mark > 0 && activatePrice <= mark) activatePrice = mark * 1.001;
        if (rules.tickSize > 0) {
          activatePrice = Math.ceil(activatePrice / rules.tickSize - 1e-10) * rules.tickSize;
        }
      }
    } else {
      const alreadyPast = (extreme > 0 && extreme <= armRaw) || (mark > 0 && mark <= armRaw);
      if (!alreadyPast) {
        activatePrice = armRaw;
        if (mark > 0 && activatePrice >= mark) activatePrice = mark * 0.999;
        if (rules.tickSize > 0) {
          activatePrice = Math.floor(activatePrice / rules.tickSize + 1e-10) * rules.tickSize;
        }
      }
    }
    const positionSide = rules.dualSidePosition ? row.positionSide : undefined;
    const result = await placeFutureTrailingStopAlgo({
      symbol: row.symbol,
      side: exitOrderSide(pos),
      quantity,
      ...(activatePrice != null && activatePrice > 0 ? { activatePrice } : {}),
      callbackRate: TRAIL_CALLBACK_RATE,
      positionSide,
      clientAlgoId: `pmtr${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
    });
    if (!result?.ok) throw new Error(result?.error || result?.response?.msg || '追踪委托失败');
  };

  const closeMarket = async row => {
    if (!isLiveOrderEnabled()) throw new Error('交易未解锁');
    const rules = await withRules(row.symbol);
    const quantity = quantizeQuantity(row.quantity, rules.stepSize, rules.quantityPrecision);
    if (!(quantity > 0)) throw new Error('平仓数量无效');
    const pos = { positionSide: directionFromUiSide(row.side) };
    const positionSide = rules.dualSidePosition ? row.positionSide : undefined;
    const result = await placeFutureMarketOrder({
      symbol: row.symbol,
      side: exitOrderSide(pos),
      quantity,
      reduceOnly: !positionSide,
      positionSide,
      newClientOrderId: `pmcl${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
    });
    if (!result?.ok) throw new Error(result?.error || result?.response?.msg || '市价平仓失败');
  };

  const placeTakeProfit = async (row, tier) => {
    if (!tier) throw new Error('该方向无此止盈档');
    if (!isLiveOrderEnabled()) throw new Error('交易未解锁');
    const direction = directionFromUiSide(row.side);
    const tiers = tpTiersForDirection(direction);
    // 一档武装条件：多 ≥ entry×1.02；空 ≤ entry×0.98。
    if (tier === tiers[0] && !shouldArmFirstTier(direction, row.entryPrice, row.markPrice)) {
      throw new Error(
        direction === 'SHORT'
          ? '空头一档：最新价未跌破开仓价×0.98，不下止盈单'
          : '多头一档：最新价未达开仓价×1.02，不下止盈单'
      );
    }
    const rules = await withRules(row.symbol);
    const closePct = Number(tier?.closePct) > 0 ? Number(tier.closePct) : 0.1;
    const quantity = quantizeQuantity(row.quantity * closePct, rules.stepSize, rules.quantityPrecision);
    if (!(quantity > 0)) throw new Error('止盈数量无效');
    const pos = { positionSide: direction };
    const triggerPrice = tierTriggerPrice(row.entryPrice, tier, direction);
    const result = await placeFutureQtyTakeProfitAlgo({
      symbol: row.symbol,
      side: exitOrderSide(pos),
      quantity,
      triggerPrice,
      positionSide: rules.dualSidePosition ? row.positionSide : undefined,
      clientAlgoId: `pmtp${tier.key || tier.mult}${Date.now()}`.slice(0, 32),
    });
    if (!result?.ok) throw new Error(result?.error || result?.response?.msg || '止盈委托失败');
  };

  const runAction = async (row, type) => {
    const key = `${type}:${row.key}`;
    setBusyKey(key);
    try {
      const tiers = tpTiersForDirection(directionFromUiSide(row.side));
      if (type === 'trail') await placeTrail(row);
      else if (type === 'close') await closeMarket(row);
      else if (type === 'tp1') await placeTakeProfit(row, tiers[0]);
      else if (type === 'tp2') await placeTakeProfit(row, tiers[1]);
      else if (type === 'tp3') await placeTakeProfit(row, tiers[2]);
      await refreshBinanceAccountMirror();
      const result = await refreshRow(row);
      message.success(
        type === 'trail'
          ? `${row.symbol} 追踪委托已提交`
          : type === 'close'
            ? result?.removed
              ? `${row.symbol} 已市价平仓`
              : `${row.symbol} 已提交市价平仓`
            : `${row.symbol} 止盈委托已提交`
      );
    } catch (e) {
      message.error(e?.message || String(e));
    } finally {
      setBusyKey('');
    }
  };

  const columns = useMemo(
    () => [
      { title: '合约', dataIndex: 'symbol', key: 'symbol', align: 'right', sorter: (a, b) => a.symbol.localeCompare(b.symbol), render: value => <a href={`https://www.binance.com/zh-CN/futures/${value}`} target="_blank" rel="noopener noreferrer">{value}</a> },
      { title: '方向', dataIndex: 'side', key: 'side', align: 'right', sorter: (a, b) => a.side.localeCompare(b.side), render: value => <Tag color={value === '多' ? 'green' : 'red'}>{value}</Tag> },
      { title: '数量', dataIndex: 'quantity', key: 'quantity', align: 'right', sorter: (a, b) => a.quantity - b.quantity, render: value => formatFixed8(value) },
      { title: '开仓均价', dataIndex: 'entryPrice', key: 'entryPrice', align: 'right', sorter: (a, b) => a.entryPrice - b.entryPrice, render: value => formatFixed8(value) },
      { title: '标记价', dataIndex: 'markPrice', key: 'markPrice', align: 'right', sorter: (a, b) => a.markPrice - b.markPrice, render: value => formatFixed8(value) },
      { title: '未实现盈亏', dataIndex: 'unrealizedProfit', key: 'unrealizedProfit', align: 'right', sorter: (a, b) => a.unrealizedProfit - b.unrealizedProfit, render: value => <span style={{ color: value > 0 ? '#52c41a' : value < 0 ? '#f5222d' : undefined }}>{formatFixed8(value)}</span> },
      { title: '开仓后极值/开仓价', key: 'postOpenRatio', align: 'right', sorter: (a, b) => (a.postOpenExtreme / a.entryPrice) - (b.postOpenExtreme / b.entryPrice), render: (_, row) => row.postOpenExtreme && row.entryPrice ? formatFixed8(row.postOpenExtreme / row.entryPrice) : '—' },
      {
        title: '已持仓天数',
        key: 'days',
        sorter: (a, b) => (a.openTime || 0) - (b.openTime || 0),
        align: 'right',
        render: (_, row) => {
          const days = row.openTime ? Math.max(0, Math.floor((Date.now() - row.openTime) / 86400000)) : null;
          return <span style={{ color: days > 30 ? '#f5222d' : undefined, fontWeight: days > 30 ? 600 : undefined }}>{days == null ? '—' : days}</span>;
        },
      },
      { title: '一档止盈', key: 'tp1', align: 'right', render: (_, row) => statusCell(row.tp1Status) },
      { title: '二档止盈', key: 'tp2', align: 'right', render: (_, row) => statusCell(row.tp2Status) },
      {
        title: '三档止盈',
        key: 'tp3',
        align: 'right',
        render: (_, row) => (row.side === '空' ? <span style={{ color: '#8c8c8c' }}>—</span> : statusCell(row.tp3Status)),
      },
      { title: '追踪委托', key: 'trail', align: 'right', render: (_, row) => statusCell(row.trailStatus) },
      { title: '成本止损', key: 'stop', align: 'right', render: (_, row) => statusCell(row.stopStatus) },
      {
        title: '操作',
        key: 'actions',
        render: (_, row) => (
          <Space>
            <Button size="small" loading={busyKey === `tp1:${row.key}`} onClick={() => runAction(row, 'tp1')}>一档止盈</Button>
            <Button size="small" loading={busyKey === `tp2:${row.key}`} onClick={() => runAction(row, 'tp2')}>二档止盈</Button>
            {row.side === '多' ? (
              <Button size="small" loading={busyKey === `tp3:${row.key}`} onClick={() => runAction(row, 'tp3')}>三档止盈</Button>
            ) : null}
            <Button size="small" loading={busyKey === `trail:${row.key}`} onClick={() => runAction(row, 'trail')}>
              追踪委托
            </Button>
            <Popconfirm title={`确认市价平仓 ${row.symbol}？`} okText="确认" cancelText="取消" onConfirm={() => runAction(row, 'close')}>
              <Button danger size="small" loading={busyKey === `close:${row.key}`}>
                市价平仓
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [busyKey]
  );

  return (
    <Card bodyStyle={{ padding: 6, fontSize: 12 }}>
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          fontSize: 12,
        }}
      >
        <strong style={{ fontSize: 14, marginRight: 8 }}>持仓监控</strong>
        <Button size="small" onClick={load} loading={loading}>
          刷新
        </Button>
        <span style={{ marginLeft: 8, color: '#8c8c8c' }}>共 {rows.length} 个持仓</span>
      </div>
      {error ? <div style={{ color: '#cf1322', marginBottom: 8 }}>{error}</div> : null}
      <Table
        rowKey="key"
        loading={loading}
        dataSource={rows}
        columns={columns}
        size="small"
        className="position-monitor-table"
        locale={{ emptyText: <Empty description="暂无持仓" /> }}
        pagination={false}
        style={{ fontSize: 12, width: '100%' }}
        scroll={{ x: 1000 }}
      />
      <style>{`
        .position-monitor-table,
        .position-monitor-table .ant-table,
        .position-monitor-table .ant-table-thead > tr > th,
        .position-monitor-table .ant-table-tbody > tr > td {
          font-size: 12px !important;
        }
        .position-monitor-table .ant-table-thead > tr > th,
        .position-monitor-table .ant-table-tbody > tr > td {
          padding: 2px 4px !important;
        }
        .position-monitor-table .ant-table-container table {
          width: 100% !important;
          table-layout: auto;
        }
        .position-monitor-table .ant-table-thead > tr > th:not(:last-child),
        .position-monitor-table .ant-table-tbody > tr > td:not(:last-child) {
          white-space: nowrap;
          width: 1%;
        }
        .position-monitor-table .ant-table-thead > tr > th:last-child,
        .position-monitor-table .ant-table-tbody > tr > td:last-child {
          white-space: nowrap;
        }
      `}</style>
    </Card>
  );
};

export default PositionMonitor;