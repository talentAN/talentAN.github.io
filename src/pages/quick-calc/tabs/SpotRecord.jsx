import React, { useState, useEffect } from 'react';
import { Table, Tag, Typography, Spin } from 'antd';
import { getSpotTicker } from '../../../container/bitget/api';

const { Text } = Typography;

/** 由 Bitget「导出现货成交明细」汇总（2026-09-23 导出，156 笔） */
const rawData = [
  {
    key: 1,
    symbol: 'BLUM/USDT',
    status: 'open',
    totalBuyQty: 370.75,
    avgBuyPrice: 0.08,
    remainingQty: 370.75,
    remainingCost: 29.66,
    realizedPnl: 0,
  },
  {
    key: 2,
    symbol: 'BTC/USDT',
    status: 'open',
    totalBuyQty: 0.013059,
    avgBuyPrice: 112765.76,
    remainingQty: 0.013059,
    remainingCost: 1472.61,
    realizedPnl: 0,
  },
  {
    key: 3,
    symbol: 'BGB/USDT',
    status: 'partial',
    totalBuyQty: 1151.73,
    totalSellQty: 152.01,
    avgBuyPrice: 4.6006,
    avgSellPrice: 4.844,
    remainingQty: 1001.73,
    remainingCost: 4646.71,
    realizedPnl: 84.44,
  },
  {
    key: 4,
    symbol: 'ETH/USDT',
    status: 'partial',
    totalBuyQty: 1.0,
    totalSellQty: 0.9991,
    avgBuyPrice: 3789.13,
    avgSellPrice: 4074.6,
    remainingQty: 0.0009,
    remainingCost: 3.41,
    realizedPnl: 285.21,
  },
  {
    key: 5,
    symbol: 'CC/USDT',
    status: 'closed',
    totalBuyQty: 73.28,
    totalSellQty: 72.45,
    avgBuyPrice: 0.1501,
    avgSellPrice: 0.1209,
    // 灰尘尾仓忽略，按已平仓计
    realizedPnl: -2.12,
    realizedPnlAfterFees: -2.12,
  },
  {
    key: 6,
    symbol: 'GENIUS/USDT',
    status: 'closed',
    totalBuyQty: 47.16,
    totalSellQty: 47.14,
    avgBuyPrice: 0.474,
    avgSellPrice: 0.4058,
    // 灰尘尾仓忽略，按已平仓计
    realizedPnl: -3.22,
    realizedPnlAfterFees: -3.22,
  },
  {
    key: 7,
    symbol: 'ZAMA/USDT',
    status: 'closed',
    totalBuyQty: 386.22,
    totalSellQty: 532.61,
    avgBuyPrice: 0.0285,
    avgSellPrice: 0.0459,
    // 卖出多于买入：含空投成本为 0 的卖出；已无持仓
    realizedPnl: 13.54,
    realizedPnlAfterFees: 13.54,
  },
  {
    key: 8,
    symbol: 'CROSS/USDT',
    status: 'closed',
    totalBuyQty: 681.12,
    totalSellQty: 681.12,
    avgBuyPrice: 0.09,
    avgSellPrice: 0.3086,
    realizedPnl: 148.89,
    realizedPnlAfterFees: 148.89,
  },
  {
    key: 9,
    symbol: 'NAORIS/USDT',
    status: 'closed',
    totalBuyQty: 8574.33,
    totalSellQty: 8574.33,
    avgBuyPrice: 0.035,
    avgSellPrice: 0.0382,
    realizedPnl: 27.82,
    realizedPnlAfterFees: 27.59,
  },
  {
    key: 10,
    symbol: 'UAI/USDT',
    status: 'closed',
    totalBuyQty: 1107.05,
    totalSellQty: 1107.05,
    avgBuyPrice: 0.3171,
    avgSellPrice: 0.3607,
    realizedPnl: 48.29,
    realizedPnlAfterFees: 48.1,
  },
  {
    key: 11,
    symbol: 'HYPE/USDT',
    status: 'closed',
    totalBuyQty: 2.5,
    totalSellQty: 2.5,
    avgBuyPrice: 40,
    avgSellPrice: 59.48,
    realizedPnl: 48.7,
    realizedPnlAfterFees: 48.7,
  },
  {
    key: 12,
    symbol: 'RIVER/USDT',
    status: 'closed',
    totalBuyQty: 13.68,
    totalSellQty: 13.68,
    avgBuyPrice: 7.33,
    avgSellPrice: 7.7747,
    realizedPnl: 6.08,
    realizedPnlAfterFees: 5.98,
  },
  {
    key: 13,
    symbol: 'USDC/USDT',
    status: 'closed',
    totalBuyQty: 10000,
    totalSellQty: 10003.01,
    avgBuyPrice: 0.9999,
    avgSellPrice: 1.0002,
    realizedPnl: 6.51,
    realizedPnlAfterFees: 6.51,
  },
  {
    key: 14,
    symbol: 'AI/USDT',
    status: 'closed',
    totalBuyQty: 294.69,
    totalSellQty: 294.69,
    avgBuyPrice: 0.0373,
    avgSellPrice: 0.0234,
    realizedPnl: -4.11,
    realizedPnlAfterFees: -4.11,
  },
  {
    key: 15,
    symbol: 'PROS/USDT',
    status: 'closed',
    totalBuyQty: 17.51,
    totalSellQty: 17.51,
    avgBuyPrice: 0.628,
    avgSellPrice: 0.4146,
    realizedPnl: -3.74,
    realizedPnlAfterFees: -3.74,
  },
  {
    key: 16,
    symbol: 'MEGA/USDT',
    status: 'closed',
    totalBuyQty: 90.54,
    totalSellQty: 90.54,
    avgBuyPrice: 0.1215,
    avgSellPrice: 0.0452,
    realizedPnl: -6.9,
    realizedPnlAfterFees: -6.9,
  },
  {
    key: 17,
    symbol: 'TOWNS/USDT',
    status: 'closed',
    totalBuyQty: 12823,
    totalSellQty: 13249.66,
    avgBuyPrice: 0.039,
    avgSellPrice: 0.0256,
    realizedPnl: -160.86,
    realizedPnlAfterFees: -161.7,
  },
  {
    key: 18,
    symbol: 'APR/USDT',
    status: 'sell_only',
    totalSellQty: 20.87,
    avgSellPrice: 0.4827,
    totalSellAmount: 10.07,
  },
  {
    key: 19,
    symbol: 'COMMON/USDT',
    status: 'sell_only',
    totalSellQty: 482.4,
    avgSellPrice: 0.0143,
    totalSellAmount: 6.91,
  },
  {
    key: 20,
    symbol: 'MON/USDT',
    status: 'sell_only',
    totalSellQty: 357.7,
    avgSellPrice: 0.0345,
    totalSellAmount: 12.32,
  },
  {
    key: 21,
    symbol: 'NIGHT/USDT',
    status: 'sell_only',
    totalSellQty: 106.56,
    avgSellPrice: 0.036,
    totalSellAmount: 3.84,
  },
  {
    key: 22,
    symbol: 'preSPCX/USDT',
    status: 'sell_only',
    totalSellQty: 0.0489,
    avgSellPrice: 659.2765,
    totalSellAmount: 32.24,
  },
  {
    key: 23,
    symbol: 'STABLE/USDT',
    status: 'sell_only',
    totalSellQty: 686.7,
    avgSellPrice: 0.0143,
    totalSellAmount: 9.8,
  },
  {
    key: 24,
    symbol: 'THQ/USDT',
    status: 'sell_only',
    totalSellQty: 38.06,
    avgSellPrice: 0.0414,
    totalSellAmount: 1.58,
  },
  {
    key: 25,
    symbol: 'USDGO/USDT',
    status: 'sell_only',
    totalSellQty: 2.4314,
    avgSellPrice: 1.0002,
    totalSellAmount: 2.43,
  },
  {
    key: 26,
    symbol: 'XAUT/USDT',
    status: 'sell_only',
    totalSellQty: 0.0257,
    avgSellPrice: 4748.2,
    totalSellAmount: 122.03,
  },
];

// 有持仓的行才需要拉价格
const holdingRows = rawData.filter(r => r.remainingQty > 0);

const statusConfig = {
  open: { label: '持仓中', color: 'blue' },
  partial: { label: '部分卖出', color: 'cyan' },
  closed: { label: '已平仓', color: 'default' },
  sell_only: { label: '仅卖出', color: 'purple' },
};

const fmt = (v, digits = 2) => (v != null ? Number(v).toFixed(digits) : '-');
const pnlColor = v => (v > 0 ? '#52c41a' : v < 0 ? '#f5222d' : '#888');
// BTC/USDT → BTCUSDT
const toApiSymbol = s => s.replace('/', '');

const SpotRecord = () => {
  const [prices, setPrices] = useState({});
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [noPrice, setNoPrice] = useState(new Set());

  useEffect(() => {
    const fetchPrices = async () => {
      setLoadingPrices(true);
      const result = {};
      const noPriceSymbols = new Set();
      for (const row of holdingRows) {
        const apiSymbol = toApiSymbol(row.symbol);
        const ticker = await getSpotTicker(apiSymbol);
        if (ticker?.lastPr) {
          result[row.symbol] = parseFloat(ticker.lastPr);
        } else {
          result[row.symbol] = 0;
          noPriceSymbols.add(row.symbol);
        }
      }
      setPrices(result);
      setNoPrice(noPriceSymbols);
      setLoadingPrices(false);
    };
    fetchPrices();
  }, []);
const data = rawData.map(r => {
    const lastPr = prices[r.symbol] ?? 0;
    const hasNoPrice = noPrice.has(r.symbol);
    const status = hasNoPrice && r.remainingQty > 0 ? 'closed' : r.status;
    const unrealizedPnl =
      r.remainingQty > 0 && !hasNoPrice ? (lastPr - r.avgBuyPrice) * r.remainingQty : null;
    // 查询不到价格时，按平仓价 0 计算已实现盈亏
    const realizedPnl =
      hasNoPrice && r.remainingQty > 0
        ? (r.realizedPnl || 0) - r.avgBuyPrice * r.remainingQty
        : r.realizedPnl;
    return { ...r, lastPr, unrealizedPnl, status, realizedPnl };
  });

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      width: 130,
      fixed: 'left',
      render: v => <Text strong>{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: v => {
        const c = statusConfig[v] || { label: v, color: 'default' };
        return <Tag color={c.color}>{c.label}</Tag>;
      },
    },
    {
      title: '买入均价',
      dataIndex: 'avgBuyPrice',
      width: 110,
      render: v => (v != null ? fmt(v, 4) : '-'),
    },
    {
      title: '卖出均价',
      dataIndex: 'avgSellPrice',
      width: 110,
      render: v => (v != null ? fmt(v, 4) : '-'),
    },
    {
      title: '买入数量',
      dataIndex: 'totalBuyQty',
      width: 110,
      render: v => (v != null ? fmt(v, 4) : '-'),
    },
    {
      title: '卖出数量',
      dataIndex: 'totalSellQty',
      width: 110,
      render: v => (v != null ? fmt(v, 4) : '-'),
    },
    {
      title: '剩余持仓',
      dataIndex: 'remainingQty',
      width: 100,
      render: v => (v != null ? fmt(v, 4) : '-'),
    },
    {
      title: '持仓成本(U)',
      dataIndex: 'remainingCost',
      width: 110,
      render: v => (v != null ? fmt(v) : '-'),
    },
    {
      title: '卖出金额(U)',
      dataIndex: 'totalSellAmount',
      width: 110,
      render: v => (v != null ? fmt(v) : '-'),
    },
    {
      title: '最新价格',
      dataIndex: 'lastPr',
      width: 110,
      render: (v, r) => {
        if (!r.remainingQty) return '-';
        if (loadingPrices) return <Spin size="small" />;
        return fmt(v, 4);
      },
    },
    {
      title: '未实现盈亏',
      dataIndex: 'unrealizedPnl',
      width: 120,
      fixed: 'right',
      render: (v, r) => {
        if (!r.remainingQty) return '-';
        if (loadingPrices) return <Spin size="small" />;
        if (v == null) return '-';
        return (
          <Text strong style={{ color: pnlColor(v) }}>
            {v > 0 ? '+' : ''}
            {fmt(v)} U
          </Text>
        );
      },
    },
    {
      title: '已实现盈亏',
      dataIndex: 'realizedPnl',
      width: 110,
      fixed: 'right',
      render: v =>
        v != null ? (
          <Text strong style={{ color: pnlColor(v) }}>
            {v > 0 ? '+' : ''}
            {fmt(v)} U
          </Text>
        ) : (
          '-'
        ),
    },
    {
      title: '扣费后盈亏',
      dataIndex: 'realizedPnlAfterFees',
      width: 110,
      fixed: 'right',
      render: v =>
        v != null ? (
          <Text style={{ color: pnlColor(v) }}>
            {v > 0 ? '+' : ''}
            {fmt(v)} U
          </Text>
        ) : (
          '-'
        ),
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
          { label: '已平仓扣费后盈亏', value: closedPnl, colored: true },
          { label: '当前持仓成本', value: totalHoldingCost, colored: false },
          { label: '未实现盈亏', value: loadingPrices ? null : totalUnrealized, colored: true },
        ].map((item, i) => (
          <div
            key={i}
            style={{
              background: '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: '10px 18px',
              minWidth: 180,
            }}
          >
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{item.label}</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: item.colored && item.value != null ? pnlColor(item.value) : '#262626',
              }}
            >
              {item.value == null ? (
                <Spin size="small" />
              ) : (
                `${item.colored && item.value > 0 ? '+' : ''}${fmt(item.value)} U`
              )}
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
        rowClassName={r => (r.status === 'closed' || r.status === 'sell_only' ? 'row-muted' : '')}
      />
      <style>{`.row-muted td { opacity: 0.5; }`}</style>
    </div>
  );
};

export default SpotRecord;
