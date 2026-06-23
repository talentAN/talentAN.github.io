import React, { useState, useEffect } from 'react';
import {
  Button,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Card,
  Row,
  Col,
  Statistic,
  message,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { getFutureKlineData } from '../../../../container/bitget/api';

const { Text } = Typography;

const WATCHLIST_KEY = 'system2_watchlist';
const KLINE_DAYS = 150; // 保证覆盖 L3 后30天 + 足够历史
const HIGH = 2;

const fmtVol = v => {
  if (v == null) return '-';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
};

const fmtDate = iso => iso ?? '-';

/** 从加入关注时刻起，取后续 K 线最高价相对加入时价格的涨幅 */
function calcPostWatchMax(candles, savedAt, joinPrice) {
  if (!savedAt || !joinPrice) return null;

  const savedDate = new Date(savedAt).toISOString().slice(0, 10);
  let startIdx = candles.findIndex(
    c => new Date(Number(c[0])).toISOString().slice(0, 10) === savedDate
  );
  if (startIdx < 0) {
    for (let i = candles.length - 1; i >= 0; i--) {
      if (Number(candles[i][0]) <= savedAt) {
        startIdx = i;
        break;
      }
    }
    if (startIdx < 0) return null;
  }

  const slice = candles.slice(startIdx);
  if (!slice.length) return null;
  const maxHigh = Math.max(...slice.map(c => parseFloat(c[HIGH])));
  return {
    watchMaxHigh: maxHigh,
    watchGain: +((maxHigh / joinPrice - 1) * 100).toFixed(1),
    watchDaysAvail: slice.length - 1,
  };
}

/** 在 K 线中找 L3 日期之后最多30根蜡烛的最高价（有多少算多少） */
function calcPostL3Max(candles, l3Date, l3LowPrice) {
  // 用 UTC 日期字符串匹配，允许 ±1 天容错（Bitget 时间戳为 UTC+8 零点）
  let l3Idx = candles.findIndex(c => new Date(Number(c[0])).toISOString().slice(0, 10) === l3Date);
  if (l3Idx < 0) {
    // 容错：找相差不超过1天的最近蜡烛
    const l3Ts = new Date(l3Date).getTime();
    let minDiff = Infinity;
    candles.forEach((c, i) => {
      const diff = Math.abs(Number(c[0]) - l3Ts);
      if (diff < minDiff) {
        minDiff = diff;
        l3Idx = i;
      }
    });
    if (minDiff > 2 * 24 * 3600 * 1000) return null; // 超过2天就放弃
  }
  const slice = candles.slice(l3Idx, l3Idx + 31); // L3 当天 + 后最多30根
  if (!slice.length) return null;
  const maxHigh = Math.max(...slice.map(c => parseFloat(c[HIGH])));
  return {
    maxHigh,
    gain: +((maxHigh / l3LowPrice - 1) * 100).toFixed(1),
    daysAvail: slice.length - 1,
  };
}

const Watching = () => {
  const [watchlist, setWatchlist] = useState([]);
  const [enriched, setEnriched] = useState({}); // symbol -> { maxHigh, daysAvail, watchGain, ... } | null
  const [refreshing, setRefreshing] = useState(false);

  // ── 核心 fetch 逻辑（接受 list 参数，与 state 解耦）────────
  const doRefresh = async list => {
    if (!list.length) return;

    setRefreshing(true);
    const endTime = Date.now();

    for (const item of list) {
      try {
        const res = await getFutureKlineData({
          symbol: item.symbol,
          granularity: '1D',
          limit: KLINE_DAYS,
          endTime,
        });
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        );

        const l3Result =
          item.l3?.date && item.l3?.lowPrice
            ? calcPostL3Max(candles, item.l3.date, item.l3.lowPrice)
            : null;
        const watchResult =
          item.savedAt && item.currentPrice
            ? calcPostWatchMax(candles, item.savedAt, item.currentPrice)
            : null;
        const result = { ...l3Result, ...watchResult };
        // 逐条实时更新，不等全部完成
        setEnriched(prev => ({
          ...prev,
          [item.symbol]: Object.keys(result).length ? result : null,
        }));
      } catch (_) {
        setEnriched(prev => ({ ...prev, [item.symbol]: null }));
      }
    }

    setRefreshing(false);
  };

  // ── 读取 localStorage 并自动刷新高点 ────────────────────────
  const loadList = async () => {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || [];
      const list = raw.map(r => ({ ...r, key: r.symbol }));
      setWatchlist(list);
      setEnriched({});
      await doRefresh(list); // 加载后立即自动计算
    } catch {
      setWatchlist([]);
    }
  };

  useEffect(() => {
    loadList();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 删除单条 ─────────────────────────────────────────────────
  const removeItem = symbol => {
    const next = watchlist.filter(r => r.symbol !== symbol);
    setWatchlist(next);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    setEnriched(prev => {
      const n = { ...prev };
      delete n[symbol];
      return n;
    });
    message.success(`已移除 ${symbol}`);
  };

  // ── 清空全部 ─────────────────────────────────────────────────
  const clearAll = () => {
    localStorage.removeItem(WATCHLIST_KEY);
    setWatchlist([]);
    setEnriched({});
    message.success('已清空观测列表');
  };

  // ── 手动刷新（使用当前 watchlist state）────────────────────
  const refreshMaxPrice = () => {
    if (!watchlist.length) {
      message.warning('观测列表为空');
      return;
    }
    setEnriched({});
    doRefresh(watchlist);
  };

  // ── 表格列 ──────────────────────────────────────────────────
  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 130,
      fixed: 'left',
      render: symbol => (
        <a
          href={`https://www.bitget.com/zh-CN/futures/usdt/${symbol}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {symbol.replace('USDT', '')} <RightOutlined style={{ fontSize: 10 }} />
        </a>
      ),
    },
    {
      title: '加入时间',
      dataIndex: 'savedAt',
      key: 'savedAt',
      width: 110,
      render: v => (v ? new Date(v).toLocaleDateString('zh-CN') : '-'),
    },
    {
      title: 'L3 低点',
      key: 'l3',
      width: 120,
      render: (_, r) =>
        r.l3 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtDate(r.l3.date)}
            </Text>
            <Text style={{ color: '#1677ff', fontWeight: 500 }}>
              {r.l3.lowPrice.toPrecision(4)}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: 'L2 低点',
      key: 'l2',
      width: 120,
      render: (_, r) =>
        r.l2 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtDate(r.l2.date)}
            </Text>
            <Text style={{ color: '#1677ff', fontWeight: 500 }}>
              {r.l2.lowPrice.toPrecision(4)}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: 'L1 低点',
      key: 'l1',
      width: 120,
      render: (_, r) =>
        r.l1 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtDate(r.l1.date)}
            </Text>
            <Text style={{ color: '#1677ff', fontWeight: 500 }}>
              {r.l1.lowPrice.toPrecision(4)}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '加入时价格',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 96,
      align: 'right',
      render: v => v?.toPrecision(4) ?? '-',
    },
    {
      title: '15日均量',
      dataIndex: 'vol15',
      key: 'vol15',
      width: 90,
      align: 'right',
      render: v => <Text type="secondary">{fmtVol(v)}</Text>,
    },
    // ── 关键列：L3后30日最高价 ───────────────────────────────
    {
      title: 'L3后30日最高价',
      key: 'maxHigh',
      width: 130,
      align: 'right',
      render: (_, r) => {
        const e = enriched[r.symbol];
        if (!r.l3) return <Text type="secondary">无L3</Text>;
        if (!e) return <Text type="secondary">—</Text>;
        if (e === null) return <Text type="danger">获取失败</Text>;
        return (
          <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
            <Text style={{ fontWeight: 500 }}>{e.maxHigh.toPrecision(4)}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {e.daysAvail < 30 ? `仅${e.daysAvail}天` : '满30日'}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '加入→高点涨幅',
      key: 'watchGain',
      width: 110,
      align: 'right',
      render: (_, r) => {
        const e = enriched[r.symbol];
        if (!r.savedAt || !r.currentPrice || !e || e.watchGain == null)
          return <Text type="secondary">—</Text>;
        return (
          <Tag
            color={
              e.watchGain >= 30
                ? 'green'
                : e.watchGain >= 10
                  ? 'blue'
                  : e.watchGain >= 0
                    ? 'default'
                    : 'red'
            }
            style={{ fontWeight: 700 }}
          >
            {e.watchGain >= 0 ? '+' : ''}
            {e.watchGain}%
          </Tag>
        );
      },
      sorter: (a, b) => {
        const ga = enriched[a.symbol]?.watchGain ?? -Infinity;
        const gb = enriched[b.symbol]?.watchGain ?? -Infinity;
        return ga - gb;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, r) => (
        <Popconfirm
          title="从观测列表移除？"
          onConfirm={() => removeItem(r.symbol)}
          okText="移除"
          cancelText="取消"
        >
          <Button size="small" icon={<DeleteOutlined />} danger type="text" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      {/* 操作栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={refreshMaxPrice}
            loading={refreshing}
          >
            {refreshing ? '计算中…' : '刷新30日高点'}
          </Button>
          <Button onClick={loadList}>重新加载列表</Button>
          {watchlist.length > 0 && (
            <Popconfirm
              title="确认清空所有观测？"
              onConfirm={clearAll}
              okText="清空"
              cancelText="取消"
            >
              <Button danger>清空全部</Button>
            </Popconfirm>
          )}
          <Text type="secondary">共 {watchlist.length} 个币对在观测中</Text>
        </Space>
      </Card>

      {/* 统计 */}
      {Object.keys(enriched).length > 0 && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {[
            { label: '涨幅 ≥30%', pred: g => g >= 30, color: '#3f8600' },
            { label: '涨幅 ≥10%', pred: g => g >= 10 && g < 30, color: '#1677ff' },
            { label: '涨幅 <10%', pred: g => g >= 0 && g < 10, color: '#8c8c8c' },
            { label: '下跌', pred: g => g < 0, color: '#cf1322' },
          ].map(({ label, pred, color }) => (
            <Col key={label}>
              <Statistic
                title={label}
                value={
                  Object.values(enriched).filter(e => e?.watchGain != null && pred(e.watchGain))
                    .length
                }
                valueStyle={{ color }}
              />
            </Col>
          ))}
        </Row>
      )}

      {/* 结果表格 */}
      <Card>
        <Table
          size="small"
          dataSource={watchlist}
          columns={columns}
          pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 1100 }}
          locale={{ emptyText: '暂无观测数据，在「币对筛选」页筛选后点击「加入观测」' }}
        />
      </Card>
    </>
  );
};

export default Watching;
