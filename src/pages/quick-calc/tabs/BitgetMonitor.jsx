import React, { useState } from 'react';
import { Card, Row, Col, Button, Table, Tag, Progress } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import StableTable from '../../../container/bitget/components/stable';
import BurstTable from '../../../container/bitget/components/burst';
import StableRiseTable from '../../../container/bitget/components/stable-rise';
import RiseToFallTable from '../../../container/bitget/components/rise-to-fall';
import { getTradingPairs, getSpotTradingPairs, getFutureKlineData } from '../../../container/bitget/api';
import { PATTERN } from '@root/src/consts';

const SIM_START = '1752278400000'; // 2025-07-12 00:00:00 UTC
const SIM_END   = '1760054400000'; // 2025-10-10 00:00:00 UTC
const SIM_THRESHOLD = 0.4;

const BitgetMonitor = ({ mode: externalMode }) => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [spotTradingPairs, setSpotTradingPairs] = useState([]);
  const [mode, _setMode] = useState(externalMode || 'stable');
  const [simMode, setSimMode] = useState(false);
  const [simProgress, setSimProgress] = useState({ checked: 0, total: 0 });
  const [simResults, setSimResults] = useState([]);

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
        const res = await getFutureKlineData({
          symbol: pair.symbol,
          granularity: '1Dutc',
          limit: 100,
          startTime: SIM_START,
          endTime: SIM_END,
        });
        // K线格式: [ts, open, high, low, close, vol, quoteVol]
        const candles = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const spike = candles.find(c => {
          const open = parseFloat(c[1]), close = parseFloat(c[4]);
          return open > 0 && (close - open) / open >= SIM_THRESHOLD;
        });
        if (spike) {
          const open = parseFloat(spike[1]), close = parseFloat(spike[4]);
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
            <Button block type="primary" icon={<ReloadOutlined />} onClick={refresh}>
              刷新数据
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={simMode ? 'primary' : ''}
              onClick={() => simMode ? setSimMode(false) : runSimFilter()}
            >
              模拟币对筛选
            </Button>
          </Col>
        </Row>
      </Card>

      {simMode ? (
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
            locale={{ emptyText: simProgress.checked < simProgress.total ? '筛选中...' : '无符合条件的币对' }}
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
