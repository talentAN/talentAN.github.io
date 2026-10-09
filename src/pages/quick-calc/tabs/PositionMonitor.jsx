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
import { RANGE_MONITOR_TRAIL_ARM_MULT as TRAIL_ARM_MULT } from './low_vol_range_blast/_rangeMonitorParams';
import { getPositionOpenTime } from '@root/src/container/binance/positionOpenTime';
import { getPositionExtreme } from '@root/src/container/binance/positionExtremes';
const TRAIL_CALLBACK_RATE = 10;
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

const orderTypeText = order =>
  `${order?.type || ''} ${order?.orderType || ''} ${order?.origType || ''} ${order?.algoType || ''}`.toUpperCase();
const isExitOrder = (order, side, kind) => {
  const orderSide = String(order?.side || '').toUpperCase();
  const expectedSide = side === '多' ? 'SELL' : 'BUY';
  if (orderSide !== expectedSide) return false;
  const text = orderTypeText(order);
  if (kind === 'trail') return text.includes('TRAILING');
  if (kind === 'stop') return text.includes('STOP') && !text.includes('TAKE_PROFIT');
  // 旧版/代理返回可能只保留条件单数据结构，缺少类型字段；按止盈客户端 ID 做最后兜底。
  return text.includes('TAKE_PROFIT') || /(?:^|_)s3tp|(?:^|_)rmtp|(?:^|_)pmtp/i.test(String(order?.clientAlgoId || order?.clientOrderId || ''));
};

const getTriggerPrice = order =>
  Number(order?.triggerPrice ?? order?.stopPrice ?? order?.price ?? order?.activatePrice);

const expectedTakeProfitPrice = (entryPrice, side, multiplier) =>
  // 止盈档位按收益率计算：多仓 +20%，空仓 -20%，不能用空仓 entry / 1.2。
  side === '多' ? entryPrice * multiplier : entryPrice * (2 - multiplier);

const matchesTakeProfitTier = (trigger, entryPrice, side, multiplier) => {
  if (!(trigger > 0) || !(entryPrice > 0)) return false;
  const expected = expectedTakeProfitPrice(entryPrice, side, multiplier);
  // 委托可能按区间上沿而非当前持仓均价计算；按目标倍数给 1% 相对容差，兼容 tick 舍入及参考价差异。
  return Math.abs(trigger - expected) / expected <= 0.01;
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
  const tpOrders = symbolOrders.filter(order => isExitOrder(order, row.side, 'tp'));
  const trailOrders = symbolOrders.filter(order => isExitOrder(order, row.side, 'trail'));
  const stopOrders = symbolOrders.filter(order => isExitOrder(order, row.side, 'stop'));
  const ratio = postOpenExtreme && row.entryPrice ? postOpenExtreme / row.entryPrice : null;
  const crossed = multiplier => ratio != null && (row.side === '多' ? ratio >= multiplier : ratio <= 1 / multiplier);
  const tpStatus = multiplier => {
    const exists = tpOrders.some(order => {
      const trigger = getTriggerPrice(order);
      return matchesTakeProfitTier(trigger, row.entryPrice, row.side, multiplier);
    });
    if (exists) return 'placed';
    return crossed(multiplier) ? 'filled' : 'pending';
  };
  return {
    ...row,
    openTime: Number(effectiveOpenTime) || 0,
    postOpenExtreme,
    tp1Status: tpStatus(1.2),
    tp2Status: tpStatus(1.5),
    tp3Status: tpStatus(2),
    trailStatus: trailOrders.length ? 'placed' : crossed(1.4) ? 'filled' : 'pending',
    stopStatus: trailOrders.length
      ? 'tracked'
      : stopOrders.length
        ? 'placed'
        : crossed(1.2)
          ? 'missing'
          : 'pending',
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
    let activatePrice = entry * TRAIL_ARM_MULT;
    if (mark > 0 && activatePrice <= mark) activatePrice = mark * 1.001;
    if (rules.tickSize > 0) {
      activatePrice = Math.ceil(activatePrice / rules.tickSize - 1e-10) * rules.tickSize;
    }
    const positionSide = rules.dualSidePosition ? row.positionSide : undefined;
    const result = await placeFutureTrailingStopAlgo({
      symbol: row.symbol,
      side: row.side === '多' ? 'SELL' : 'BUY',
      quantity,
      activatePrice,
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
    const positionSide = rules.dualSidePosition ? row.positionSide : undefined;
    const result = await placeFutureMarketOrder({
      symbol: row.symbol,
      side: row.side === '多' ? 'SELL' : 'BUY',
      quantity,
      reduceOnly: !positionSide,
      positionSide,
      newClientOrderId: `pmcl${Date.now()}${Math.floor(Math.random() * 1e4)}`.slice(0, 32),
    });
    if (!result?.ok) throw new Error(result?.error || result?.response?.msg || '市价平仓失败');
  };

  const placeTakeProfit = async (row, multiplier) => {
    if (!isLiveOrderEnabled()) throw new Error('交易未解锁');
    const rules = await withRules(row.symbol);
    const quantity = quantizeQuantity(row.quantity * 0.1, rules.stepSize, rules.quantityPrecision);
    if (!(quantity > 0)) throw new Error('止盈数量无效');
    const triggerPrice = row.entryPrice * (row.side === '多' ? multiplier : 1 / multiplier);
    const result = await placeFutureQtyTakeProfitAlgo({
      symbol: row.symbol,
      side: row.side === '多' ? 'SELL' : 'BUY',
      quantity,
      triggerPrice,
      positionSide: rules.dualSidePosition ? row.positionSide : undefined,
      clientAlgoId: `pmtp${multiplier}${Date.now()}`.slice(0, 32),
    });
    if (!result?.ok) throw new Error(result?.error || result?.response?.msg || '止盈委托失败');
  };

  const runAction = async (row, type) => {
    const key = `${type}:${row.key}`;
    setBusyKey(key);
    try {
      if (type === 'trail') await placeTrail(row);
      else if (type === 'close') await closeMarket(row);
      else await placeTakeProfit(row, Number(type));
      await refreshBinanceAccountMirror();
      await load();
      message.success(type === 'trail' ? `${row.symbol} 追踪委托已提交` : `${row.symbol} 已提交市价平仓`);
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
      { title: '三档止盈', key: 'tp3', align: 'right', render: (_, row) => statusCell(row.tp3Status) },
      { title: '追踪委托', key: 'trail', align: 'right', render: (_, row) => statusCell(row.trailStatus) },
      { title: '成本止损', key: 'stop', align: 'right', render: (_, row) => statusCell(row.stopStatus) },
      {
        title: '操作',
        key: 'actions',
        render: (_, row) => (
          <Space>
            <Button size="small" loading={busyKey === `1.2:${row.key}`} onClick={() => runAction(row, '1.2')}>一档止盈</Button>
            <Button size="small" loading={busyKey === `1.5:${row.key}`} onClick={() => runAction(row, '1.5')}>二档止盈</Button>
            <Button size="small" loading={busyKey === `2:${row.key}`} onClick={() => runAction(row, '2')}>三档止盈</Button>
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