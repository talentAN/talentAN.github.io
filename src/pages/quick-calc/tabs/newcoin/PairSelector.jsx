import React, { useState, useRef } from 'react';
import { Card, Row, Col, Button, Typography, Table, Tag, Progress, InputNumber } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getTradingPairs, getFutureKlineData } from '../../../../container/bitget/api';
import watchData from '@root/contract-record/watch-newcoin.json';

const WATCHING_SYMBOLS = new Set(watchData.filter(d => !d.achieved).map(d => d.symbol));

const { Title } = Typography;

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_LIST_DAYS = 100;
const MAX_RATIO = 2.5;

const PairSelector = () => {
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const [minDays, setMinDays] = useState(null);
  const abortRef = useRef(false);

  const runFilter = async () => {
    abortRef.current = false;
    setRunning(true);
    setResults([]);

    const pairs = await getTradingPairs();
    setProgress({ checked: 0, total: pairs.length });

    const now = Date.now();
    const cutoff = now - MAX_LIST_DAYS * 24 * 60 * 60 * 1000;
    const searchStart = cutoff - 30 * 24 * 60 * 60 * 1000;

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];

      if (WATCHING_SYMBOLS.has(symbol)) {
        setProgress({ checked: i + 1, total: pairs.length });
        continue;
      }

      try {
        let listTs = null;
        for (let cs = searchStart; cs < now; cs += THREE_MONTHS_MS) {
          const ce = Math.min(cs + THREE_MONTHS_MS, now);
          const res = await getFutureKlineData({
            symbol,
            granularity: '1Dutc',
            limit: 100,
            startTime: cs,
            endTime: ce,
          });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          if (chunk.length) {
            listTs = Math.min(...chunk.map(c => Number(c[0])));
            break;
          }
        }

        if (!listTs || listTs < cutoff) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const listDays = Math.floor((now - listTs) / (24 * 60 * 60 * 1000));

        let allCandles = [];
        for (let cs = listTs; cs < now; cs += THREE_MONTHS_MS) {
          const ce = Math.min(cs + THREE_MONTHS_MS, now);
          const res = await getFutureKlineData({
            symbol,
            granularity: '1Dutc',
            limit: 100,
            startTime: cs,
            endTime: ce,
          });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          allCandles.push(...chunk);
        }

        if (allCandles.length < 2) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        allCandles.sort((a, b) => Number(a[0]) - Number(b[0]));

        const earlyMinLow = Math.min(...allCandles.slice(0, 20).map(c => parseFloat(c[3])));
        if (earlyMinLow > 20) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        let minLow = Infinity;
        let maxHigh = -Infinity;
        let stableDays = 0;
        let breakoutDate = null;

        for (let d = 0; d < allCandles.length; d++) {
          const high = parseFloat(allCandles[d][2]);
          const low = parseFloat(allCandles[d][3]);
          maxHigh = Math.max(maxHigh, high);
          minLow = Math.min(minLow, low);
          if (minLow > 0 && maxHigh <= minLow * MAX_RATIO) {
            stableDays = d + 1;
          } else {
            breakoutDate = new Date(Number(allCandles[d][0])).toISOString().slice(0, 10);
            break;
          }
        }

        if (breakoutDate) {
          const breakoutMs = new Date(breakoutDate).getTime();
          if (now - breakoutMs > 3 * 24 * 60 * 60 * 1000) {
            setProgress({ checked: i + 1, total: pairs.length });
            continue;
          }
        }

        if (stableDays >= 5) {
          const windowCandles = allCandles.slice(0, stableDays);
          const wMaxHigh = Math.max(...windowCandles.map(c => parseFloat(c[2])));
          const wMinLow = Math.min(...windowCandles.map(c => parseFloat(c[3])));
          matched.push({
            key: symbol,
            symbol,
            listDate: new Date(listTs).toISOString().slice(0, 10),
            listDays,
            maxHigh: wMaxHigh.toPrecision(4),
            minLow: wMinLow.toPrecision(4),
            ratio: (wMaxHigh / wMinLow).toFixed(2),
            stableDays,
            breakoutDate,
            candleCount: allCandles.length,
          });
          setResults([...matched]);
        }
      } catch (_) {}

      setProgress({ checked: i + 1, total: pairs.length });
    }

    setRunning(false);
  };

  const displayData = (minDays ? results.filter(r => r.stableDays >= minDays) : results)
    .slice()
    .sort((a, b) => parseFloat(a.ratio) - parseFloat(b.ratio));

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 150,
      render: s => (
        <a
          href={`https://www.bitget.com/zh-CN/futures/usdt/${s}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {s}
        </a>
      ),
    },
    { title: '上架日期', dataIndex: 'listDate', key: 'listDate', width: 120 },
    {
      title: '上线天数',
      dataIndex: 'listDays',
      key: 'listDays',
      width: 90,
      render: v => <Tag color={v < 30 ? 'green' : v < 60 ? 'blue' : 'orange'}>{v}天</Tag>,
    },
    { title: '区间最低', dataIndex: 'minLow', key: 'minLow', width: 110 },
    { title: '区间最高', dataIndex: 'maxHigh', key: 'maxHigh', width: 110 },
    {
      title: '最高/最低',
      dataIndex: 'ratio',
      key: 'ratio',
      width: 100,
      render: v => <Tag color={parseFloat(v) < 1.5 ? 'green' : 'blue'}>{v}x</Tag>,
    },
    {
      title: '横盘天数',
      dataIndex: 'stableDays',
      key: 'stableDays',
      width: 90,
      render: v => <Tag color="orange">{v}天</Tag>,
    },
    {
      title: '跳出区间日期',
      dataIndex: 'breakoutDate',
      key: 'breakoutDate',
      width: 120,
      render: v => v || '至今未跳出',
    },
  ];

  return (
    <Row gutter={16}>
      <Col span={24}>
        <Card title={`新币低波动筛选（上线 ≤ ${MAX_LIST_DAYS}天，最高价 ≤ 最低价 × ${MAX_RATIO}）`}>
          {progress.total > 0 && (
            <Progress
              percent={Math.round((progress.checked / progress.total) * 100)}
              status={running ? 'active' : 'normal'}
              style={{ marginBottom: 12 }}
              format={() => `${progress.checked} / ${progress.total}`}
            />
          )}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>共计 {results.length} 币对</span>
            <span>横盘天数 ≥</span>
            <InputNumber
              min={1}
              value={minDays}
              onChange={setMinDays}
              placeholder="不限"
              style={{ width: 90 }}
            />
            <span>当前展示 {displayData.length} 币对</span>
            <Button type="primary" icon={<ReloadOutlined />} onClick={runFilter} loading={running}>
              {running ? '筛选中...' : '开始筛选'}
            </Button>
            {running && (
              <Button
                onClick={() => {
                  abortRef.current = true;
                  setRunning(false);
                }}
              >
                停止
              </Button>
            )}
            <Button
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(displayData, null, 2));
              }}
            >
              一键复制
            </Button>
          </div>
          <Table
            size="small"
            pagination={{ pageSize: 20 }}
            dataSource={displayData}
            locale={{ emptyText: running ? '筛选中...' : '点击「开始筛选」获取数据' }}
            columns={columns}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default PairSelector;
