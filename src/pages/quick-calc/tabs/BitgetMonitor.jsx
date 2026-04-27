import React, { useState } from 'react';
import { Card, Row, Col, Button, Table, Tag, Progress, InputNumber } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import StableTable from '../../../container/bitget/components/stable';
import BurstTable from '../../../container/bitget/components/burst';
import StableRiseTable from '../../../container/bitget/components/stable-rise';
import RiseToFallTable from '../../../container/bitget/components/rise-to-fall';
import {
  getTradingPairs,
  getSpotTradingPairs,
  getFutureKlineData,
} from '../../../container/bitget/api';
import { PATTERN } from '@root/src/consts';

const SIM_START = '1752278400000'; // 2025-07-12 00:00:00 UTC
const SIM_END = '1760054400000'; // 2025-10-10 00:00:00 UTC
const SIM_THRESHOLD = 0.4;

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

// 自动按 3 个月分段查询 K 线，合并结果
const getKlineChunked = async params => {
  const start = Number(params.startTime);
  const end = Number(params.endTime);
  const allCandles = [];
  let chunkStart = start;
  while (chunkStart < end) {
    const chunkEnd = Math.min(chunkStart + THREE_MONTHS_MS, end);
    const res = await getFutureKlineData({
      ...params,
      startTime: chunkStart,
      endTime: chunkEnd,
      limit: 100,
    });
    const candles = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    allCandles.push(...candles);
    if (params.limit && allCandles.length >= params.limit) break;
    chunkStart = chunkEnd;
  }
  return allCandles;
};

const BitgetMonitor = ({ mode: externalMode }) => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [spotTradingPairs, setSpotTradingPairs] = useState([]);
  const [mode, _setMode] = useState(externalMode || 'stable');
  const [simMode, setSimMode] = useState(false);
  const [simProgress, setSimProgress] = useState({ checked: 0, total: 0 });
  const [simResults, setSimResults] = useState([]);
  const [burstMode, setBurstMode] = useState(false);
  const [burstProgress, setBurstProgress] = useState({ checked: 0, total: 0 });
  const [burstResults, setBurstResults] = useState([]);
  const [burstRunning, setBurstRunning] = useState(false);
  const [burstMinDays, setBurstMinDays] = useState(null);
  const burstAbortRef = React.useRef(false);

  React.useEffect(() => {
    if (externalMode) {
      _setMode(externalMode);
      refresh();
    }
  }, [externalMode]);

  const setMode = v => {
    localStorage.setItem('mode', v);
    _setMode(v);
  };

  const runSimFilter = async () => {
    setSimMode(true);
    setSimResults([]);
    const pairs = tradingPairs.length ? tradingPairs : await getTradingPairs();
    if (!tradingPairs.length) setTradingPairs(pairs);
    setSimProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      try {
        // K线格式: [ts, open, high, low, close, vol, quoteVol]
        const candles = await getKlineChunked({
          symbol: pair.symbol,
          granularity: '1Dutc',
          limit: 100,
          startTime: SIM_START,
          endTime: SIM_END,
        });
        const spike = candles.find(c => {
          const open = parseFloat(c[1]),
            close = parseFloat(c[4]);
          return open > 0 && (close - open) / open >= SIM_THRESHOLD;
        });
        if (spike) {
          const open = parseFloat(spike[1]),
            close = parseFloat(spike[4]);
          matched.push({
            key: pair.symbol,
            symbol: pair.symbol,
            date: new Date(Number(spike[0])).toISOString().slice(0, 10),
            rise: (((close - open) / open) * 100).toFixed(1),
          });
        }
      } catch (_) {}
      setSimProgress({ checked: i + 1, total: pairs.length });
    }
    setSimResults(matched);
  };

  const runBurstVerify = async () => {
    burstAbortRef.current = false;
    setBurstMode(true);
    setBurstRunning(true);
    setBurstResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getTradingPairs();
    if (!tradingPairs.length) setTradingPairs(pairs);
    setBurstProgress({ checked: 0, total: pairs.length });

    // 上架时间窗口
    const LIST_START = new Date('2025-01-01').getTime();
    const LIST_END = new Date('2026-04-01').getTime();

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (burstAbortRef.current) break;
      const { symbol } = pairs[i];
      try {
        // searchStart 早于 LIST_START，确保老币能被检测到并过滤
        let listTs = null;
        const chunkSize = THREE_MONTHS_MS;
        const searchStart = new Date('2024-10-01').getTime();
        const searchEnd = new Date('2026-04-01').getTime();
        for (let cs = searchStart; cs < searchEnd; cs += chunkSize) {
          const ce = Math.min(cs + chunkSize, searchEnd);
          const res = await getFutureKlineData({
            symbol,
            granularity: '1Dutc',
            limit: 100,
            startTime: cs,
            endTime: ce,
          });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          if (chunk.length) {
            // 找 chunk 内时间戳最小的一根
            listTs = Math.min(...chunk.map(c => Number(c[0])));
            break;
          }
        }
        if (!listTs) {
          setBurstProgress({ checked: i + 1, total: pairs.length });
          continue;
        }
        if (listTs < LIST_START || listTs >= LIST_END) {
          setBurstProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        // 逐批拉 K 线并逐天扩展窗口，直到跳出或没有更多数据
        let tradingCandles = [];
        let runMaxHigh = -Infinity;
        let runMinLow = Infinity;
        let stableDays = 0;
        let breakoutDate = null;
        let chunkFrom = listTs;
        let first20Checked = false;
        let shouldSkip = false;
        let done = false;

        while (!done) {
          const chunkTo = chunkFrom + THREE_MONTHS_MS;
          const res = await getFutureKlineData({ symbol, granularity: '1Dutc', limit: 100, startTime: chunkFrom, endTime: chunkTo });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          if (!chunk.length) break;
          chunk.sort((a, b) => Number(a[0]) - Number(b[0]));

          // 第一个 chunk 跳过上架当天
          const newCandles = tradingCandles.length === 0 ? chunk.slice(1) : chunk;
          tradingCandles = tradingCandles.concat(newCandles);

          // 过滤：前 20 天最低价 > 20 则跳过
          if (!first20Checked && tradingCandles.length >= 20) {
            first20Checked = true;
            const first20MinLow = Math.min(...tradingCandles.slice(0, 20).map(c => parseFloat(c[3])));
            if (first20MinLow > 20) { shouldSkip = true; break; }
          }

          // 逐天扩展，从上次停止的位置继续
          for (let d = stableDays; d < tradingCandles.length; d++) {
            const high = parseFloat(tradingCandles[d][2]);
            const low  = parseFloat(tradingCandles[d][3]);
            runMaxHigh = Math.max(runMaxHigh, high);
            runMinLow  = Math.min(runMinLow, low);
            if (runMinLow > 0 && runMaxHigh <= runMinLow * 2.5) {
              stableDays = d + 1;
            } else {
              breakoutDate = new Date(Number(tradingCandles[d][0])).toISOString().slice(0, 10);
              done = true;
              break;
            }
          }

          if (!done) chunkFrom = chunkTo;
        }

        if (shouldSkip) { setBurstProgress({ checked: i + 1, total: pairs.length }); continue; }
        if (tradingCandles.length < 1) { setBurstProgress({ checked: i + 1, total: pairs.length }); continue; }

        if (stableDays >= 20) {
          // 用 stableDays 窗口内的最终值
          const windowCandles = tradingCandles.slice(0, stableDays);
          const maxHigh = Math.max(...windowCandles.map(c => parseFloat(c[2])));
          const minLow = Math.min(...windowCandles.map(c => parseFloat(c[3])));
          matched.push({
            key: symbol,
            symbol,
            listDate: new Date(listTs).toISOString().slice(0, 10),
            maxHigh: maxHigh.toPrecision(4),
            minLow: minLow.toPrecision(4),
            ratio: (maxHigh / minLow).toFixed(2),
            stableDays,
            breakoutDate,
          });
          setBurstResults([...matched]);
        }
      } catch (_) {}
      setBurstProgress({ checked: i + 1, total: pairs.length });
    }
    setBurstRunning(false);
  };

  const refresh = () => {
    getTradingPairs().then(res => {
      setTradingPairs(res);
    });
    if (mode === 'stable-rise') {
      getSpotTradingPairs().then(res => {
        setSpotTradingPairs(res);
      });
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col span={3}>
            <Button
              block
              type={mode === PATTERN.LONG_STABLE ? 'primary' : ''}
              onClick={() => setMode(PATTERN.LONG_STABLE)}
            >
              低波动横盘
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={mode === PATTERN.high_volume_breakout_shrink_stall ? 'primary' : ''}
              onClick={() => setMode(PATTERN.high_volume_breakout_shrink_stall)}
            >
              高点缩量横盘
            </Button>
          </Col>
          <Col span={3}>
            <Button block type={mode === 'burst' ? 'primary' : ''} onClick={() => setMode('burst')}>
              burst
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={mode === 'stable-rise' ? 'primary' : ''}
              onClick={() => setMode('stable-rise')}
            >
              stable-rise
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={simMode ? 'primary' : ''}
              onClick={() => (simMode ? setSimMode(false) : runSimFilter())}
            >
              模拟币对筛选
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={burstMode ? 'primary' : ''}
              onClick={() => {
                if (burstMode) {
                  burstAbortRef.current = true;
                  setBurstMode(false);
                  setBurstRunning(false);
                } else runBurstVerify();
              }}
            >
              暴涨验证
            </Button>
          </Col>
          <Col span={3}>
            <Button block type="primary" icon={<ReloadOutlined />} onClick={refresh}>
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      {burstMode && !simMode ? (
        <Card title="暴涨验证（上架 2025-01 ~ 2026-03，前20天最低价 ≤ 20，横盘：最高价 ≤ 最低价 × 2.5）">
          {burstProgress.total > 0 && (
            <Progress
              percent={Math.round((burstProgress.checked / burstProgress.total) * 100)}
              status={burstRunning ? 'active' : 'normal'}
              style={{ marginBottom: 12 }}
              format={() => `${burstProgress.checked} / ${burstProgress.total}`}
            />
          )}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>共计 {burstResults.length} 币对</span>
            <span>横盘天数 ≥</span>
            <InputNumber
              min={1}
              value={burstMinDays}
              onChange={setBurstMinDays}
              placeholder="不限"
              style={{ width: 90 }}
            />
            <span>当前展示 {burstMinDays ? burstResults.filter(r => r.stableDays >= burstMinDays).length : burstResults.length} 币对</span>
            <Button
              size="small"
              onClick={() => {
                const rows = (burstMinDays ? burstResults.filter(r => r.stableDays >= burstMinDays) : burstResults)
                  .slice().sort((a, b) => parseFloat(a.ratio) - parseFloat(b.ratio));
                navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
              }}
            >
              一键复制
            </Button>
            {burstRunning && (
              <Button
                size="small"
                onClick={() => {
                  burstAbortRef.current = true;
                  setBurstRunning(false);
                }}
              >
                停止
              </Button>
            )}
          </div>
          <Table
            size="small"
            pagination={{ pageSize: 20 }}
            dataSource={
              (burstMinDays ? burstResults.filter(r => r.stableDays >= burstMinDays) : burstResults)
                .slice().sort((a, b) => parseFloat(a.ratio) - parseFloat(b.ratio))
            }
            locale={{ emptyText: burstRunning ? '验证中...' : '无符合条件的币对' }}
            columns={[
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
              { title: '区间最高', dataIndex: 'maxHigh', key: 'maxHigh', width: 110 },
              { title: '区间最低', dataIndex: 'minLow', key: 'minLow', width: 110 },
              {
                title: '最高/最低',
                dataIndex: 'ratio',
                key: 'ratio',
                width: 100,
                render: v => <Tag color="blue">{v}x</Tag>,
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
                render: v => v || '-',
              },
            ]}
          />
        </Card>
      ) : simMode ? (
        <Card title="模拟币对筛选（2025-07-12 ~ 2025-10-10，单日涨幅 ≥ 40%）">
          {simProgress.total > 0 && simProgress.checked < simProgress.total && (
            <Progress
              percent={Math.round((simProgress.checked / simProgress.total) * 100)}
              status="active"
              style={{ marginBottom: 12 }}
              format={() => `${simProgress.checked} / ${simProgress.total}`}
            />
          )}
          <Table
            size="small"
            pagination={{ pageSize: 20 }}
            dataSource={simResults}
            locale={{
              emptyText: simProgress.checked < simProgress.total ? '筛选中...' : '无符合条件的币对',
            }}
            columns={[
              { title: '币对', dataIndex: 'symbol', key: 'symbol', width: 150 },
              { title: '触发日期', dataIndex: 'date', key: 'date', width: 130 },
              {
                title: '当日涨幅',
                dataIndex: 'rise',
                key: 'rise',
                render: v => <Tag color="green">+{v}%</Tag>,
              },
            ]}
          />
        </Card>
      ) : (
        <Card title="Bitget 合约交易对列表">
          {mode === PATTERN.LONG_STABLE ? <StableTable futureSymbols={tradingPairs} /> : null}
          {mode === PATTERN.high_volume_breakout_shrink_stall ? (
            <RiseToFallTable futureSymbols={tradingPairs} />
          ) : null}
          {mode === 'burst' ? <BurstTable futureSymbols={tradingPairs} /> : null}
          {mode === 'stable-rise' ? (
            <StableRiseTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs} />
          ) : null}
        </Card>
      )}
    </div>
  );
};

export default BitgetMonitor;
