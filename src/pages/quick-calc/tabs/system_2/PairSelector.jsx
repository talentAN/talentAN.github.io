import React, { useState, useRef } from 'react';
import {
  Button,
  Checkbox,
  InputNumber,
  Space,
  Table,
  Tag,
  Progress,
  Typography,
  Card,
  Row,
  Col,
  Statistic,
  message,
} from 'antd';
import { EyeOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { getTradingPairs, getFutureKlineData } from '../../../../container/bitget/api';
import { FILTERS } from './_filters/_index';
import { getHigherLowsResult } from './_filters/_higherLows';
import { getHighsMetrics } from './_filters/_notAtHighs';
import { getVolumeMetrics } from './_filters/_lowVolume';

const { Text } = Typography;

const WATCHLIST_KEY = 'system2_watchlist';
const DAY_MS = 24 * 60 * 60 * 1000;
const KLINE_DAYS = 110; // 至少 100 根日 K，多取 10 根作缓冲

const fmtVol = v => {
  if (v == null) return '-';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
};

const PairSelector = () => {
  // allData：所有扫描结果（至少满足一个条件），含详细指标
  const [allData, setAllData] = useState([]);
  // checked：每个 filter 的 checkbox 状态
  const [checked, setChecked] = useState(() => Object.fromEntries(FILTERS.map(f => [f.id, true])));
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  // 最低日均量过滤（实时，不需重扫）
  const [minVolEnabled, setMinVolEnabled] = useState(true);
  const [minVolThreshold, setMinVolThreshold] = useState(200); // 万 U
  const abortRef = useRef(false);

  const runScan = async () => {
    abortRef.current = false;
    setRunning(true);
    setAllData([]);

    let pairs;
    try {
      pairs = await getTradingPairs();
    } catch (_) {
      message.error('获取交易对失败');
      setRunning(false);
      return;
    }

    setProgress({ done: 0, total: pairs.length });
    const endTime = Date.now();
    const results = [];

    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];

      try {
        const res = await getFutureKlineData({
          symbol,
          granularity: '1Dutc',
          limit: KLINE_DAYS,
          endTime,
        });
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        );

        // 至少需要 SWING_WINDOW*2 + 3 根才能检测 swing low；
        // 条件2/3 内部各自有 candles.length < 100 的判断，不在此拦截
        if (candles.length < 30) {
          setProgress({ done: i + 1, total: pairs.length });
          continue;
        }

        // ── 运行所有纯函数 ────────────────────────────────────────
        const f1 = FILTERS[0].fn(candles);
        const f2 = FILTERS[1].fn(candles);
        const f3 = FILTERS[2].fn(candles);
        const f4 = FILTERS[3].fn(candles);

        // 至少满足一个条件才加入结果集
        if (!f1 && !f2 && !f3 && !f4) {
          setProgress({ done: i + 1, total: pairs.length });
          continue;
        }

        // ── 提取展示指标（不受 filter 结果影响，始终计算）────────
        const hlResult = getHigherLowsResult(candles); // { l1, l2, l3 } | null
        const hMetrics = getHighsMetrics(candles); // { currentPrice, high100, highRatio } | null
        const vMetrics = getVolumeMetrics(candles); // { vol15, vol100, volRatio } | null

        results.push({
          key: symbol,
          symbol,
          f1,
          f2,
          f3,
          f4,
          // 低点信息
          l1: hlResult?.l1 ?? null,
          l2: hlResult?.l2 ?? null,
          l3: hlResult?.l3 ?? null,
          // 价格 / 高点
          currentPrice: hMetrics?.currentPrice ?? parseFloat(candles[candles.length - 1][4]),
          high100: hMetrics?.high100 ?? null,
          highRatio: hMetrics?.highRatio ?? null,
          highLookback: hMetrics?.lookback ?? null,
          // 成交量
          vol15: vMetrics?.vol15 ?? null,
          vol100: vMetrics?.vol100 ?? null,
          volRatio: vMetrics?.volRatio ?? null,
          volRecentW: vMetrics?.recentWindow ?? null,
          volLongW: vMetrics?.longWindow ?? null,
        });

        setAllData([...results]);
      } catch (_) {}

      setProgress({ done: i + 1, total: pairs.length });
    }

    setAllData([...results]);
    setRunning(false);
  };

  const stopScan = () => {
    abortRef.current = true;
    setRunning(false);
  };

  const saveToWatchlist = () => {
    const toSave = displayData.filter(r => selectedKeys.includes(r.symbol));
    if (!toSave.length) {
      message.warning('请先勾选要加入观测的币对');
      return;
    }
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || [];
      } catch {
        return [];
      }
    })();
    const map = Object.fromEntries(existing.map(it => [it.symbol, it]));
    const now = Date.now();
    toSave.forEach(r => {
      if (!map[r.symbol]) map[r.symbol] = { ...r, savedAt: now };
    });
    const merged = Object.values(map);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(merged));
    const added = toSave.filter(r => !existing.find(e => e.symbol === r.symbol)).length;
    const skipped = toSave.length - added;
    const hint = skipped > 0 ? `，${skipped} 个已存在跳过` : '';
    message.success(`新增 ${added} 个币对至观测列表（共 ${merged.length} 个${hint}）`);
  };

  // ── 根据 checkbox 状态实时过滤（无需重扫） ────────────────────
  const minVolUSDT = minVolThreshold * 10_000;
  const displayData = allData.filter(r => {
    if (!FILTERS.every(f => !checked[f.id] || r[f.id])) return false;
    if (minVolEnabled && r.vol15 != null && r.vol15 < minVolUSDT) return false;
    return true;
  });

  // ── 统计 ────────────────────────────────────────────────────
  const allPass = allData.filter(
    r => FILTERS.every(f => r[f.id]) && (!minVolEnabled || r.vol15 == null || r.vol15 >= minVolUSDT)
  ).length;

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
      title: '当前价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 96,
      align: 'right',
      render: v => v?.toPrecision(4) ?? '-',
    },
    // ── 低点三列 ─────────────────────────────────────────────
    {
      title: '低点1',
      key: 'l1',
      width: 120,
      render: (_, r) =>
        r.l1 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.l1.date}
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
      title: '低点2',
      key: 'l2',
      width: 120,
      render: (_, r) =>
        r.l2 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.l2.date}
            </Text>
            <Text style={{ color: '#1677ff', fontWeight: 500 }}>
              {r.l2.lowPrice.toPrecision(4)}
            </Text>
            {r.l1 && (
              <Text type="secondary" style={{ fontSize: 10 }}>
                距低点1 {r.l2.idx - r.l1.idx}天
              </Text>
            )}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '低点3（最近）',
      key: 'l3',
      width: 140,
      render: (_, r) =>
        r.l3 ? (
          <Space direction="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.l3.date}
            </Text>
            <Text style={{ color: '#52c41a', fontWeight: 600 }}>
              {r.l3.lowPrice.toPrecision(4)}
            </Text>
            {r.l2 && (
              <Text type="secondary" style={{ fontSize: 10 }}>
                距低点2 {r.l3.idx - r.l2.idx}天
              </Text>
            )}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    // ── 历史高点 ────────────────────────────────────────────
    {
      title: '历史高点',
      dataIndex: 'high100',
      key: 'high100',
      width: 96,
      align: 'right',
      render: (v, r) =>
        v != null ? (
          <Space direction="vertical" size={0}>
            <span>{v.toPrecision(4)}</span>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {r.highLookback}日内
            </Text>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '当前/高点',
      dataIndex: 'highRatio',
      key: 'highRatio',
      width: 90,
      align: 'right',
      sorter: (a, b) => (a.highRatio ?? 999) - (b.highRatio ?? 999),
      render: v =>
        v != null ? (
          <span
            style={{
              color: v < 50 ? '#722ed1' : v < 70 ? '#1677ff' : '#fa8c16',
              fontWeight: 600,
            }}
          >
            {v}%
          </span>
        ) : (
          '-'
        ),
    },
    // ── 成交量 ──────────────────────────────────────────────
    {
      title: '量比(近/全)',
      dataIndex: 'volRatio',
      key: 'volRatio',
      width: 104,
      align: 'right',
      sorter: (a, b) => (a.volRatio ?? 999) - (b.volRatio ?? 999),
      render: (v, r) =>
        v != null ? (
          <Space direction="vertical" size={0}>
            <span style={{ color: v <= 70 ? '#3f8600' : '#fa8c16', fontWeight: 500 }}>
              {v}%
              <Text type="secondary" style={{ fontSize: 10, marginLeft: 3 }}>
                ({r.volRecentW}/{r.volLongW}日)
              </Text>
            </span>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {fmtVol(r.vol15)}/日
            </Text>
          </Space>
        ) : (
          '-'
        ),
    },
    // ── 满足条件标签 ─────────────────────────────────────────
    {
      title: '满足条件',
      key: 'tags',
      width: 160,
      render: (_, r) => (
        <Space size={4} wrap>
          {FILTERS.map((f, idx) => (
            <Tag
              key={f.id}
              color={r[f.id] ? 'success' : 'default'}
              style={{ fontSize: 10, margin: 0 }}
            >
              条件{idx + 1}
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* 筛选条件 Checkbox */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space direction="vertical" size={6}>
            {FILTERS.map(f => (
              <Checkbox
                key={f.id}
                checked={checked[f.id]}
                onChange={e => setChecked(prev => ({ ...prev, [f.id]: e.target.checked }))}
              >
                <Text strong>{f.label}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {f.desc}
                </Text>
              </Checkbox>
            ))}
            {/* 最低日均量：实时过滤，改阈值无需重扫 */}
            <Checkbox checked={minVolEnabled} onChange={e => setMinVolEnabled(e.target.checked)}>
              <Text strong>最低日均量</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                15日均成交额 ≥
              </Text>
              <InputNumber
                size="small"
                min={0}
                step={50}
                value={minVolThreshold}
                onChange={v => setMinVolThreshold(v ?? 0)}
                addonAfter="万 U"
                style={{ width: 120, marginLeft: 6 }}
                disabled={!minVolEnabled}
              />
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                （改阈值实时生效，无需重扫）
              </Text>
            </Checkbox>
          </Space>

          <Space wrap>
            <Button type="primary" icon={<ReloadOutlined />} onClick={runScan} loading={running}>
              {running ? '扫描中…' : '开始筛选'}
            </Button>
            {running && <Button onClick={stopScan}>停止</Button>}
            {displayData.length > 0 && !running && (
              <Button
                icon={<EyeOutlined />}
                onClick={saveToWatchlist}
                disabled={selectedKeys.length === 0}
              >
                加入观测 {selectedKeys.length > 0 ? `(${selectedKeys.length})` : ''}
              </Button>
            )}
            {allData.length > 0 && !running && (
              <Text type="secondary">
                已扫描 {progress.done} 个币对，命中 {allData.length} 个，当前显示{' '}
                {displayData.length} 个
              </Text>
            )}
          </Space>

          {progress.total > 0 && (
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              status={running ? 'active' : 'normal'}
              format={() => `${progress.done} / ${progress.total}`}
              style={{ marginBottom: 0 }}
            />
          )}
        </Space>
      </Card>

      {/* 统计 */}
      {allData.length > 0 && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col>
            <Statistic
              title="全部满足（3/3）"
              value={allPass}
              valueStyle={{ color: '#3f8600', fontWeight: 700 }}
            />
          </Col>
          {FILTERS.map((f, idx) => (
            <Col key={f.id}>
              <Statistic title={`满足条件${idx + 1}`} value={allData.filter(r => r[f.id]).length} />
            </Col>
          ))}
          <Col>
            <Statistic title="当前显示" value={displayData.length} />
          </Col>
        </Row>
      )}

      {/* 结果表格 */}
      <Card>
        <Table
          size="small"
          dataSource={displayData}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: keys => setSelectedKeys(keys),
            preserveSelectedRowKeys: true,
          }}
          pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 1060 }}
          locale={{
            emptyText: running ? '扫描中，数据会实时更新…' : '点击「开始筛选」获取数据',
          }}
        />
      </Card>
    </>
  );
};

export default PairSelector;
