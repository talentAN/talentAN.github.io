import React, { useState, useEffect } from 'react';
import { Table, Tag, Typography, Spin } from 'antd';
import { getSpotTicker } from '../../../container/bitget/api';

const { Text } = Typography;

const rawData = [
  { key: 1,  symbol: 'BTC/USDT',    status: 'open',      totalBuyQty: 0.013059,  avgBuyPrice: 112765.76, remainingQty: 0.013059, remainingCost: 1472.61,  realizedPnl: 0 },
  { key: 2,  symbol: 'BGB/USDT',    status: 'partial',   totalBuyQty: 1151.73,   totalSellQty: 152.01,   avgBuyPrice: 4.60,      avgSellPrice: 4.844,    remainingQty: 999.72,  remainingCost: 4599.27,  realizedPnl: 37.01 },
  { key: 3,  symbol: 'ETH/USDT',    status: 'partial',   totalBuyQty: 1.0,       totalSellQty: 0.9991,   avgBuyPrice: 3789.13,   avgSellPrice: 4074.60,  remainingQty: 0.0009,  remainingCost: 3.41,     realizedPnl: 285.21 },
  { key: 4,  symbol: 'BLUM/USDT',   status: 'open',      totalBuyQty: 370.75,    avgBuyPrice: 0.08,      remainingQty: 370.75,   remainingCost: 29.66,    realizedPnl: 0 },
  { key: 5,  symbol: 'CROSS/USDT',  status: 'closed',    avgBuyPrice: 0.09,      avgSellPrice: 0.3086,   realizedPnl: 148.89,    realizedPnlAfterFees: 148.67 },
  { key: 6,  symbol: 'RIVER/USDT',  status: 'closed',    avgBuyPrice: 7.33,      avgSellPrice: 7.7747,   realizedPnl: 6.08,      realizedPnlAfterFees: 5.90 },
  { key: 7,  symbol: 'TOWNS/USDT',  status: 'closed',    avgBuyPrice: 0.039,     avgSellPrice: 0.02560,  realizedPnl: -160.86,   realizedPnlAfterFees: -161.70 },
  { key: 8,  symbol: 'USDC/USDT',   status: 'closed',    avgBuyPrice: 0.99985,   avgSellPrice: 1.0002,   realizedPnl: 6.51,      realizedPnlAfterFees: 6.51 },
  { key: 9,  symbol: 'APR/USDT',    status: 'sell_only', totalSellQty: 20.87,    avgSellPrice: 0.4827,   totalSellAmount: 10.07 },
  { key: 10, symbol: 'COMMON/USDT', status: 'sell_only', totalSellAmount: 6.91 },
  { key: 11, symbol: 'MON/USDT',    status: 'sell_only', totalSellAmount: 12.32 },
  { key: 12, symbol: 'NIGHT/USDT',  status: 'sell_only', totalSellAmount: 3.84 },
  { key: 13, symbol: 'STABLE/USDT', status: 'sell_only', totalSellAmount: 9.80 },
  { key: 14, symbol: 'THQ/USDT',    status: 'sell_only', totalSellAmount: 1.58 },
  { key: 15, symbol: 'XAUT/USDT',   status: 'sell_only', totalSellAmount: 122.03 },
  { key: 16, symbol: 'ZAMA/USDT',   status: 'sell_only', totalSellAmount: 3.85 },
];

// 有持仓的行才需要拉价格
const holdingRows = rawData.filter(r => r.remainingQty > 0);

const statusConfig = {
  open:      { label: '持仓中',   color: 'blue' },
  partial:   { label: '部分卖出', color: 'cyan' },
  closed:    { label: '已平仓',   color: 'default' },
  sell_only: { label: '仅卖出',   color: 'purple' },
};

const fmt = (v, digits = 2) => v != null ? Number(v).toFixed(digits) : '-';
const pnlColor = v => v > 0 ? '#52c41a' : v < 0 ? '#f5222d' : '#888';
// BTC/USDT → BTCUSDT
const toApiSymbol = s => s.replace('/', '');

const SpotRecord = () => {
  const [prices, setPrices] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(true);

  useEffect(() => {
    const fetchPrices = async () => {
      setLoadingPrices(true);
      const result = {};
      for (const row of holdingRows) {
        const apiSymbol = toApiSymbol(row.symbol);
        const ticker = await getSpotTicker(apiSymbol);
        if (ticker?.lastPr) result[row.symbol] = parseFloat(ticker.lastPr);
        else result[row.symbol] = 0;
      }
      setPrices(result);
      setLoadingPrices(false);
    };
    fetchPrices();
  }, []);

  const data = rawData.map(r => {
    const lastPr = prices[r.symbol] ?? 0;
    const unrealizedPnl =
      r.remainingQty > 0
        ? (lastPr - r.avgBuyPrice) * r.remainingQty
        : null;
    return { ...r, lastPr, unrealizedPnl };
  });

  const columns = [
    {
      title: '币对', dataIndex: 'symbol', width: 130, fixed: 'left',
      render: v => <Text strong>{v}</Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: v => {
        const c = statusConfig[v] || { label: v, color: 'default' };
        return <Tag color={c.color}>{c.label}</Tag>;
      },
    },
    {
      title: '买入均价', dataIndex: 'avgBuyPrice', width: 110,
      render: v => v != null ? fmt(v, 4) : '-',
    },
    {
      title: '卖出均价', dataIndex: 'avgSellPrice', width: 110,
      render: v => v != null ? fmt(v, 4) : '-',
    },
    {
      title: '买入数量', dataIndex: 'totalBuyQty', width: 110,
      render: v => v != null ? fmt(v, 4) : '-',
    },
    {
      title: '卖出数量', dataIndex: 'totalSellQty', width: 110,
      render: v => v != null ? fmt(v, 4) : '-',
    },
    {
      title: '剩余持仓', dataIndex: 'remainingQty', width: 100,
      render: v => v != null ? fmt(v, 4) : '-',
    },
    {
      title: '持仓成本(U)', dataIndex: 'remainingCost', width: 110,
      render: v => v != null ? fmt(v) : '-',
    },
    {
      title: '卖出金额(U)', dataIndex: 'totalSellAmount', width: 110,
      render: v => v != null ? fmt(v) : '-',
    },
    {
      title: '最新价格', dataIndex: 'lastPr', width: 110,
      render: (v, r) => {
        if (!r.remainingQty) return '-';
        if (loadingPrices) return <Spin size="small" />;
        return fmt(v, 4);
      },
    },
    {
      title: '未实现盈亏', dataIndex: 'unrealizedPnl', width: 120, fixed: 'right',
      render: (v, r) => {
        if (!r.remainingQty) return '-';
        if (loadingPrices) return <Spin size="small" />;
        if (v == null) return '-';
        return (
          <Text strong style={{ color: pnlColor(v) }}>
            {v > 0 ? '+' : ''}{fmt(v)} U
          </Text>
        );
      },
    },
    {
      title: '已实现盈亏', dataIndex: 'realizedPnl', width: 110, fixed: 'right',
      render: v => v != null
        ? <Text strong style={{ color: pnlColor(v) }}>{v > 0 ? '+' : ''}{fmt(v)} U</Text>
        : '-',
    },
    {
      title: '扣费后盈亏', dataIndex: 'realizedPnlAfterFees', width: 110, fixed: 'right',
      render: v => v != null
        ? <Text style={{ color: pnlColor(v) }}>{v > 0 ? '+' : ''}{fmt(v)} U</Text>
        : '-',
    },
  ];

  const closedPnl = data
    .filter(r => r.status === 'closed' && r.realizedPnlAfterFees != null)
    .reduce((s, r) => s + r.realizedPnlAfterFees, 0);

  const allRealizedPnl = data
    .filter(r => r.realizedPnl != null)
    .reduce((s, r) => s + r.realizedPnl, 0);

  const totalHoldingCost = data
    .filter(r => r.remainingCost != null)
    .reduce((s, r) => s + r.remainingCost, 0);

  const totalUnrealized = data
    .filter(r => r.unrealizedPnl != null)
    .reduce((s, r) => s + r.unrealizedPnl, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '已实现盈亏（全部）', value: allRealizedPnl, colored: true },
          { label: '已平仓扣费后盈亏',   value: closedPnl,      colored: true },
          { label: '当前持仓成本',       value: totalHoldingCost, colored: false },
          { label: '未实现盈亏',         value: loadingPrices ? null : totalUnrealized, colored: true },
        ].map((item, i) => (
          <div key={i} style={{
            background: '#fafafa', border: '1px solid #f0f0f0',
            borderRadius: 6, padding: '10px 18px', minWidth: 180,
          }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{item.label}</div>
            <div style={{
              fontSize: 18, fontWeight: 700,
              color: item.colored && item.value != null ? pnlColor(item.value) : '#262626',
            }}>
              {item.value == null
                ? <Spin size="small" />
                : `${item.colored && item.value > 0 ? '+' : ''}${fmt(item.value)} U`
              }
            </div>
          </div>
        ))}
      </div>

      <Table
        columns={columns}
        dataSource={data}
        pagination={false}
        size="small"
        scroll={{ x: 1300 }}
        rowClassName={r => r.status === 'closed' || r.status === 'sell_only' ? 'row-muted' : ''}
      />
      <style>{`.row-muted td { opacity: 0.5; }`}</style>
    </div>
  );
};

export default SpotRecord;
