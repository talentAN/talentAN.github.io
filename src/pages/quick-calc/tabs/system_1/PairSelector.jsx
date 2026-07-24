import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Typography,
  Space,
  Divider,
  Spin,
  Statistic,
  Table,
  Tag,
  Progress,
  Segmented,
  message,
  Select,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getTradingPairs, getFutureKlineData } from '@root/src/container/market';
import { getTradeUrl } from '@root/src/container/market';
import { useMarket } from '@root/src/container/market/MarketContext';
import watchData from '@root/contract-record/watch.json';
import moment from 'moment';
import PositionCalculatorButton from '@trade/system_1/PositionCalculatorButton';
import {
  SPIKE_CONFIG,
  HOLD_CONFIG,
  MARKET_CONFIG,
  RATIO_COLOR,
} from '@root/src/consts/pairSelectorConfig';
import { MARKET_DATA_CONFIG } from '@root/src/configs/pairSelectorConfig';
import { getSingleDaySpike, getWindowPeakSignal, getHoldReference } from './_pairSelectorRules';

const WATCHING_SYMBOLS = new Set(watchData.filter(d => !d.achieved).map(d => d.symbol));

// 筛选模式
const MODE_SPIKE = 'spike'; // 过去4天内单日涨幅 ≥30% 或最高价高于最远一天开盘价的40%
const MODE_HOLD = 'hold'; // 90天内最近一次暴涨 ≥30% 或连续 4 天最高价高于第一天开盘价 50%，且当前价仍高位

const { Text } = Typography;

const PairSelector = () => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [marketData, setMarketData] = useState({ BTC: {}, ETH: {} });
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [mode, setMode] = useState(MODE_SPIKE);
  const [spikeResults, setSpikeResults] = useState([]);
  const [holdResults, setHoldResults] = useState([]);
  const [spikeProgress, setSpikeProgress] = useState({ checked: 0, total: 0 });
  const [spikeRunning, setSpikeRunning] = useState(false);
  const abortRef = useRef(false);
  const { exchange, setExchange, registerExchange, availableExchanges } = useMarket();

  const calculatePriceChange = (klineData, days) => {
    if (!klineData || klineData.length < days) return null;
    const latestPrice = parseFloat(klineData[klineData.length - 1][4]);
    const pastPrice = parseFloat(klineData[klineData.length - 1 - days][4]);
    return (((latestPrice - pastPrice) / pastPrice) * 100).toFixed(2);
  };

  const renderMarketStats = (symbol, data) => {
    // Single-line summary: symbol latestPrice, e.g. "BTC 64,000 7日⬇️3% 15日⬆️13% 45日⬇️2%"
    const latest = data && data.latest ? Number(data.latest) : null;
    return (
      <div
        style={{
          fontSize: 13,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, minWidth: 120 }}>
          {symbol.replace('USDT', '')}{' '}
          {latest ? (
            <a
              href={getTradeUrl(`${symbol}USDT`, exchange)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'inherit' }}
            >
              {latest.toLocaleString()}
            </a>
          ) : (
            '-'
          )}
        </div>
        {MARKET_DATA_CONFIG.displayPeriods.map(days => {
          const key = `day${days}`;
          const raw = data && (data[key] === 0 || data[key] ? data[key] : null);
          const val = raw !== null ? parseFloat(raw) : null;
          const up = val !== null && val >= 0;
          const text = val === null ? '-' : `${val.toFixed(2)}%`;
          return (
            <div
              key={days}
              style={{ color: val === null ? 'inherit' : up ? '#3f8600' : '#cf1322' }}
            >
              {`${days}日 ${text}`}
            </div>
          );
        })}
      </div>
    );
  };

  const fetchMarketData = async () => {
    setLoadingMarket(true);
    try {
      const endTime = moment().valueOf();
      const startTime = moment().subtract(MARKET_CONFIG.klineDays, 'days').valueOf();

      const [btcData, ethData] = await Promise.all([
        getFutureKlineData(
          {
            symbol: 'BTCUSDT',
            granularity: '1D',
            limit: MARKET_CONFIG.klineDays,
            startTime,
            endTime,
          },
          exchange
        ),
        getFutureKlineData(
          {
            symbol: 'ETHUSDT',
            granularity: '1D',
            limit: MARKET_CONFIG.klineDays,
            startTime,
            endTime,
          },
          exchange
        ),
      ]);

      const mkChange = (data, days) => calculatePriceChange(data, days);
      const safeLatest = data =>
        data && Array.isArray(data) && data.length ? parseFloat(data[data.length - 1][4]) : null;
      setMarketData({
        BTC: {
          latest: safeLatest(btcData.data),
          day7: mkChange(btcData.data, MARKET_CONFIG.periods[0]),
          day15: mkChange(btcData.data, MARKET_CONFIG.periods[1]),
          day45: mkChange(btcData.data, MARKET_CONFIG.periods[2]),
        },
        ETH: {
          latest: safeLatest(ethData.data),
          day7: mkChange(ethData.data, MARKET_CONFIG.periods[0]),
          day15: mkChange(ethData.data, MARKET_CONFIG.periods[1]),
          day45: mkChange(ethData.data, MARKET_CONFIG.periods[2]),
        },
      });
    } catch (error) {
      message.error('获取市场数据失败：' + error.message);
    } finally {
      setLoadingMarket(false);
    }
  };

  const loadData = () => {
    abortRef.current = true;
    setSpikeRunning(false);
    setLoading(true);
    getTradingPairs({}, exchange)
      .then(res => {
        setTradingPairs(res);
      })
      .finally(() => setLoading(false));
  };

  // 模式一：过去 4 天内单日涨幅 ≥30% 或过去 4 天最高价高于最远一天开盘价的 40%
  const runSpikeFilter = async () => {
    abortRef.current = false;
    setSpikeRunning(true);
    setSpikeResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getTradingPairs({}, exchange);
    if (!tradingPairs.length) setTradingPairs(pairs);

    const startTime = moment
      .utc()
      .subtract(SPIKE_CONFIG.windowDays, 'days')
      .startOf('day')
      .valueOf();
    const endTime = moment.utc().valueOf();
    setSpikeProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];
      try {
        const res = await getFutureKlineData(
          {
            symbol,
            granularity: '1Dutc',
            limit: SPIKE_CONFIG.windowDays + 1,
            startTime,
            endTime,
          },
          exchange
        );
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        );

        if (candles.length < 2) {
          setSpikeProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const spikeSignal = getSingleDaySpike(candles);
        const peakSignal = getWindowPeakSignal(candles);
        const qualified = Boolean(spikeSignal) || Boolean(peakSignal);

        if (qualified && !WATCHING_SYMBOLS.has(symbol)) {
          const trigger = spikeSignal ? (peakSignal ? '两者' : '单日暴涨') : '窗口峰值';
          matched.push({
            key: symbol,
            symbol,
            date: spikeSignal?.date || peakSignal?.date,
            rise: spikeSignal?.rise,
            firstOpen: peakSignal?.firstOpen,
            maxHigh: peakSignal?.maxHigh,
            peakRatio: peakSignal?.ratio,
            trigger,
          });
          setSpikeResults([...matched]);
        }
      } catch (_) {}
      setSpikeProgress({ checked: i + 1, total: pairs.length });
    }
    setSpikeRunning(false);
  };

  // 模式二：90天内最近一次暴涨 ≥30% 或存在连续 4 天，4 天内最高价高于第一天开盘价 50%，且当前价仍 ≥ 基准价 × 95%
  const runHoldFilter = async () => {
    abortRef.current = false;
    setSpikeRunning(true);
    setHoldResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getTradingPairs({}, exchange);
    if (!tradingPairs.length) setTradingPairs(pairs);

    const endTime = moment.utc().valueOf();
    setSpikeProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];
      try {
        // 只传 endTime + limit，避免触发"区间不能超过90天"限制
        const res = await getFutureKlineData(
          {
            symbol,
            granularity: '1Dutc',
            limit: HOLD_CONFIG.klineLimit,
            endTime,
          },
          exchange
        );
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        ); // 升序：oldest → newest
        if (candles.length < 2) {
          setSpikeProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const holdSignal = getHoldReference(candles);
        if (!holdSignal) {
          setSpikeProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const hitCurrent = holdSignal.currentPrice >= holdSignal.threshold;
        if (hitCurrent && !WATCHING_SYMBOLS.has(symbol)) {
          matched.push({
            key: symbol,
            symbol,
            spikeDate: holdSignal.referenceDate,
            spikeRise: holdSignal.referenceRise || '—',
            spikeClose: holdSignal.baseline,
            refPrice: holdSignal.baseline,
            currentPrice: holdSignal.currentPrice,
            ratio: ((holdSignal.currentPrice / holdSignal.baseline) * 100).toFixed(1),
            trigger: holdSignal.trigger,
            daysAgo: holdSignal.daysAgo,
          });
          setHoldResults([...matched]);
        }
      } catch (_) {}
      setSpikeProgress({ checked: i + 1, total: pairs.length });
    }
    setSpikeRunning(false);
  };

  const handleRun = () => (mode === MODE_SPIKE ? runSpikeFilter() : runHoldFilter());

  // Load data on mount and whenever selected exchange changes
  useEffect(() => {
    loadData();
    fetchMarketData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange]);

  return (
    <>
      {loadingMarket ? (
        <div style={{ textAlign: 'center', padding: '20px', marginBottom: 16 }}>
          <Spin tip="加载市场数据..." />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ padding: '2px 0' }}>{renderMarketStats('BTC', marketData.BTC)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ padding: '2px 0' }}>{renderMarketStats('ETH', marketData.ETH)}</div>
          </div>
        </div>
      )}
      <Row gutter={16}>
        <Col span={24}>
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <Space size={12} align="center">
                <Segmented
                  value={mode}
                  onChange={v => {
                    setMode(v);
                    setSpikeProgress({ checked: 0, total: 0 });
                  }}
                  options={[
                    { label: '过去4天暴涨', value: MODE_SPIKE },
                    { label: '90天内暴涨仍高位', value: MODE_HOLD },
                  ]}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {mode === MODE_SPIKE
                    ? `过去 ${SPIKE_CONFIG.windowDays} 天内单日涨幅 ≥${SPIKE_CONFIG.riseRatio * 100}% 或过去 ${SPIKE_CONFIG.windowDays} 天的最高价高于最远一天开盘价的 ${SPIKE_CONFIG.peakRatio * 100}%`
                    : `${HOLD_CONFIG.klineLimit} 天内最近一次暴涨 ≥${HOLD_CONFIG.riseRatio * 100}% 或存在连续 4 天，4 天内最高价高于第一天开盘价的 ${HOLD_CONFIG.fourDayRunRatio * 100}% ，且当前价 ≥ 基准价 × ${HOLD_CONFIG.priceRatio * 100}%`}
                </Text>
              </Space>
              <Space align="center">
                <Select
                  size="small"
                  value={exchange}
                  onChange={v => setExchange(v)}
                  style={{ width: 140 }}
                >
                  {(availableExchanges || []).map(e => (
                    <Select.Option key={e} value={e}>
                      {e.charAt(0).toUpperCase() + e.slice(1)}
                    </Select.Option>
                  ))}
                </Select>
                {(mode === MODE_SPIKE ? spikeResults : holdResults).length > 0 && (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    共{' '}
                    <Text strong>{(mode === MODE_SPIKE ? spikeResults : holdResults).length}</Text>{' '}
                    条
                  </Text>
                )}
                <PositionCalculatorButton />
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={handleRun}
                  loading={spikeRunning}
                >
                  {spikeRunning ? '筛选中...' : '开始筛选'}
                </Button>
                {spikeRunning && (
                  <Button
                    onClick={() => {
                      abortRef.current = true;
                      setSpikeRunning(false);
                    }}
                  >
                    停止
                  </Button>
                )}
              </Space>
            </div>

            {spikeProgress.total > 0 && (
              <Progress
                percent={Math.round((spikeProgress.checked / spikeProgress.total) * 100)}
                status={spikeRunning ? 'active' : 'normal'}
                format={() => `${spikeProgress.checked} / ${spikeProgress.total}`}
                style={{ marginBottom: 12 }}
              />
            )}

            {mode === MODE_SPIKE ? (
              <Table
                size="small"
                pagination={{ pageSize: 100 }}
                dataSource={spikeResults}
                locale={{ emptyText: spikeRunning ? '筛选中...' : '点击「开始筛选」获取数据' }}
                columns={[
                  {
                    title: '币对',
                    dataIndex: 'symbol',
                    key: 'symbol',
                    width: 150,
                    render: symbol => (
                      <a
                        href={getTradeUrl(symbol, exchange)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {symbol}
                      </a>
                    ),
                  },
                  { title: '触发日期', dataIndex: 'date', key: 'date', width: 130 },
                  ...(spikeResults.some(r => r.trigger === '单日暴涨' || r.trigger === '两者')
                    ? [
                        {
                          title: '当日涨幅',
                          dataIndex: 'rise',
                          key: 'rise',
                          width: 100,
                          render: v => (v ? <Tag color="green">+{v}%</Tag> : '—'),
                        },
                      ]
                    : []),
                  ...(spikeResults.some(r => r.trigger === '窗口峰值' || r.trigger === '两者')
                    ? [
                        {
                          title: '开盘价/最高价',
                          key: 'openHigh',
                          width: 180,
                          render: (_, r) =>
                            r.firstOpen != null && r.maxHigh != null ? (
                              <span>
                                {r.firstOpen.toPrecision(5)} / {r.maxHigh.toPrecision(5)}
                                {r.peakRatio != null && (
                                  <Tag color="green" style={{ marginLeft: 6 }}>
                                    +{r.peakRatio}%
                                  </Tag>
                                )}
                              </span>
                            ) : (
                              '—'
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <Table
                size="small"
                pagination={{ pageSize: 100 }}
                dataSource={holdResults}
                locale={{ emptyText: spikeRunning ? '筛选中...' : '点击「开始筛选」获取数据' }}
                columns={[
                  {
                    title: '币对',
                    dataIndex: 'symbol',
                    key: 'symbol',
                    width: 150,
                    render: symbol => (
                      <a
                        href={getTradeUrl(symbol, exchange)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {symbol}
                      </a>
                    ),
                  },
                  {
                    title: '暴涨日期',
                    dataIndex: 'spikeDate',
                    key: 'spikeDate',
                    width: 110,
                  },
                  {
                    title: '距今(天)',
                    dataIndex: 'daysAgo',
                    key: 'daysAgo',
                    width: 80,
                    align: 'center',
                    sorter: (a, b) => a.daysAgo - b.daysAgo,
                  },
                  {
                    title: '暴涨幅度',
                    dataIndex: 'spikeRise',
                    key: 'spikeRise',
                    width: 90,
                    render: v => <Tag color="volcano">+{v}%</Tag>,
                    sorter: (a, b) => parseFloat(a.spikeRise) - parseFloat(b.spikeRise),
                  },
                  {
                    title: '暴涨收盘价',
                    dataIndex: 'spikeClose',
                    key: 'spikeClose',
                    width: 110,
                    render: v => v.toPrecision(5),
                  },
                  {
                    title: '基准价(a)',
                    dataIndex: 'refPrice',
                    key: 'refPrice',
                    width: 110,
                    render: (v, r) => (
                      <span style={{ color: v > r.spikeClose ? '#722ed1' : 'inherit' }}>
                        {v.toPrecision(5)}
                        {v > r.spikeClose && <span style={{ fontSize: 10, marginLeft: 3 }}>↑</span>}
                      </span>
                    ),
                  },
                  {
                    title: '当前价',
                    dataIndex: 'currentPrice',
                    key: 'currentPrice',
                    width: 100,
                    render: v => v.toPrecision(5),
                  },
                  {
                    title: '昨日最高',
                    dataIndex: 'yesterdayHigh',
                    key: 'yesterdayHigh',
                    width: 100,
                    render: v => v.toPrecision(5),
                  },
                  {
                    title: '当前/暴涨',
                    dataIndex: 'ratio',
                    key: 'ratio',
                    width: 100,
                    render: v => {
                      const pct = parseFloat(v);
                      const color =
                        pct >= RATIO_COLOR.green
                          ? '#3f8600'
                          : pct >= RATIO_COLOR.orange
                            ? '#fa8c16'
                            : '#cf1322';
                      return <span style={{ color, fontWeight: 500 }}>{v}%</span>;
                    },
                    sorter: (a, b) => parseFloat(a.ratio) - parseFloat(b.ratio),
                    defaultSortOrder: 'descend',
                  },
                  {
                    title: '触发方式',
                    dataIndex: 'trigger',
                    key: 'trigger',
                    width: 80,
                    render: v => (
                      <Tag color={v === '两者' ? 'green' : v === '当前价' ? 'blue' : 'orange'}>
                        {v}
                      </Tag>
                    ),
                    filters: [
                      { text: '当前价', value: '当前价' },
                      { text: '昨日高', value: '昨日高' },
                      { text: '两者', value: '两者' },
                    ],
                    onFilter: (val, r) => r.trigger === val,
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default PairSelector;
