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
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getTradingPairs, getFutureKlineData } from '../../../../container/bitget/api';
import watchData from '@root/contract-record/watch.json';
import moment from 'moment';

const WATCHING_SYMBOLS = new Set(
  watchData.filter(d => !d.achieved).map(d => d.symbol)
);

const { Title, Text } = Typography;

const PairSelector = () => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [marketData, setMarketData] = useState({ BTC: {}, ETH: {} });
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [spikeResults, setSpikeResults] = useState([]);
  const [spikeProgress, setSpikeProgress] = useState({ checked: 0, total: 0 });
  const [spikeRunning, setSpikeRunning] = useState(false);
  const abortRef = useRef(false);

  const calculatePriceChange = (klineData, days) => {
    if (!klineData || klineData.length < days) return null;
    const latestPrice = parseFloat(klineData[klineData.length - 1][4]);
    const pastPrice = parseFloat(klineData[klineData.length - 1 - days][4]);
    return (((latestPrice - pastPrice) / pastPrice) * 100).toFixed(2);
  };

  const fetchMarketData = async () => {
    setLoadingMarket(true);
    try {
      const endTime = moment().valueOf();
      const startTime = moment().subtract(20, 'days').valueOf();

      const [btcData, ethData] = await Promise.all([
        getFutureKlineData({
          symbol: 'BTCUSDT',
          granularity: '1D',
          limit: 20,
          startTime,
          endTime,
        }),
        getFutureKlineData({
          symbol: 'ETHUSDT',
          granularity: '1D',
          limit: 20,
          startTime,
          endTime,
        }),
      ]);

      setMarketData({
        BTC: {
          day3: calculatePriceChange(btcData.data, 3),
          day7: calculatePriceChange(btcData.data, 7),
          day15: calculatePriceChange(btcData.data, 15),
        },
        ETH: {
          day3: calculatePriceChange(ethData.data, 3),
          day7: calculatePriceChange(ethData.data, 7),
          day15: calculatePriceChange(ethData.data, 15),
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
    getTradingPairs()
      .then(res => {
        setTradingPairs(res);
      })
      .finally(() => setLoading(false));
  };

  const runSpikeFilter = async () => {
    abortRef.current = false;
    setSpikeRunning(true);
    setSpikeResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getTradingPairs();
    if (!tradingPairs.length) setTradingPairs(pairs);

    const startTime = moment.utc().subtract(4, 'days').startOf('day').valueOf();
    const endTime = moment.utc().valueOf();
    setSpikeProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];
      try {
        const res = await getFutureKlineData({ symbol, granularity: '1Dutc', limit: 5, startTime, endTime });
        const candles = Array.isArray(res?.data) ? res.data : [];
        const spike = candles.find(c => {
          const open = parseFloat(c[1]), close = parseFloat(c[4]);
          return open > 0 && (close - open) / open >= 0.3;
        });
        if (spike && !WATCHING_SYMBOLS.has(symbol)) {
          const open = parseFloat(spike[1]), close = parseFloat(spike[4]);
          matched.push({
            key: symbol,
            symbol,
            date: new Date(Number(spike[0])).toISOString().slice(0, 10),
            rise: (((close - open) / open) * 100).toFixed(1),
          });
          setSpikeResults([...matched]);
        }
      } catch (_) {}
      setSpikeProgress({ checked: i + 1, total: pairs.length });
    }
    setSpikeRunning(false);
  };

  useEffect(() => {
    loadData();
    fetchMarketData();
  }, []);

  const detailsContent = (
    <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Text strong>策略：高点缩量横盘</Text>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text strong>筛选条件：</Text>
          <ul>
            <li>价格处于近80日阻力位附近（高点）</li>
            <li>成交量缩小（相对于之前的水平）</li>
            <li>价格横盘波动（缺乏明确方向）</li>
          </ul>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text strong>交易逻辑：</Text>
          <ul>
            <li>这种形态表现为上升乏力，可能即将回调</li>
            <li>适合寻找空头机会或止盈点</li>
            <li>需配合其他技术指标确认</li>
          </ul>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text type="secondary">下方列表展示符合条件的交易对，点击可查看详情</Text>
        </div>
      </Space>
    </div>
  );

  return (
    <>
      {loadingMarket ? (
        <div style={{ textAlign: 'center', padding: '20px', marginBottom: 16 }}>
          <Spin tip="加载市场数据..." />
        </div>
      ) : (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <Card
              size="small"
              title={
                <a
                  href="https://www.bitget.com/zh-CN/futures/usdt/BTCUSDT"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit' }}
                >
                  BTC 涨跌幅
                </a>
              }
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="3日"
                    value={marketData.BTC.day3}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.BTC.day3) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="7日"
                    value={marketData.BTC.day7}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.BTC.day7) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="15日"
                    value={marketData.BTC.day15}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.BTC.day15) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
          <Col span={12}>
            <Card
              size="small"
              title={
                <a
                  href="https://www.bitget.com/zh-CN/futures/usdt/ETHUSDT"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit' }}
                >
                  ETH 涨跌幅
                </a>
              }
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="3日"
                    value={marketData.ETH.day3}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.ETH.day3) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="7日"
                    value={marketData.ETH.day7}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.ETH.day7) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="15日"
                    value={marketData.ETH.day15}
                    suffix="%"
                    valueStyle={{
                      color: parseFloat(marketData.ETH.day15) >= 0 ? '#3f8600' : '#cf1322',
                    }}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      )}
      <Row gutter={16}>
        <Col span={24}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Title level={3} style={{ margin: 0 }}>
                过去3天单日涨幅 &gt;= 30% 的币对
              </Title>
              <Space>
                <Button type="primary" icon={<ReloadOutlined />} onClick={runSpikeFilter} loading={spikeRunning}>
                  {spikeRunning ? '筛选中...' : '开始筛选'}
                </Button>
                {spikeRunning && (
                  <Button onClick={() => { abortRef.current = true; setSpikeRunning(false); }}>
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
            <Table
              size="small"
              pagination={{ pageSize: 20 }}
              dataSource={spikeResults}
              locale={{ emptyText: spikeRunning ? '筛选中...' : '点击「开始筛选」获取数据' }}
              columns={[
                {
                  title: '币对', dataIndex: 'symbol', key: 'symbol', width: 150,
                  render: symbol => (
                    <a href={`https://www.bitget.com/zh-CN/futures/usdt/${symbol}`} target="_blank" rel="noopener noreferrer">
                      {symbol}
                    </a>
                  ),
                },
                { title: '触发日期', dataIndex: 'date', key: 'date', width: 130 },
                {
                  title: '当日涨幅', dataIndex: 'rise', key: 'rise',
                  render: v => <Tag color="green">+{v}%</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default PairSelector;
