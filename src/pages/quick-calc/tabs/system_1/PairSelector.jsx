import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Typography,
  Space,
  Divider,
  Spin,
  Collapse,
  Statistic,
  message,
} from 'antd';
import { ReloadOutlined, MenuOutlined } from '@ant-design/icons';
import RiseToFallTable from '../../../../container/bitget/components/rise-to-fall';
import { getTradingPairs, getFutureKlineData } from '../../../../container/bitget/api';
import moment from 'moment';

const { Title, Text } = Typography;

const PairSelector = () => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [marketData, setMarketData] = useState({ BTC: {}, ETH: {} });
  const [loadingMarket, setLoadingMarket] = useState(true);

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
    setLoading(true);
    getTradingPairs()
      .then(res => {
        setTradingPairs(res);
      })
      .finally(() => {
        setLoading(false);
      });
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
        {showDetails && (
          <Col span={12}>
            <Card>
              <Title level={3}>筛选说明</Title>
              {detailsContent}
            </Card>
          </Col>
        )}
        <Col span={showDetails ? 12 : 24}>
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <Title level={3} style={{ margin: 0 }}>
                高点缩量横盘币对
              </Title>
              <Space>
                <Button
                  icon={<MenuOutlined />}
                  onClick={() => setShowDetails(!showDetails)}
                  title={showDetails ? '隐藏说明' : '显示说明'}
                />
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={loadData}
                  loading={loading}
                >
                  刷新
                </Button>
              </Space>
            </div>
            <Spin spinning={loading}>
              {tradingPairs.length > 0 ? (
                <RiseToFallTable futureSymbols={tradingPairs} />
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <Text type="secondary">{loading ? '加载中...' : '点击刷新获取数据'}</Text>
                </div>
              )}
            </Spin>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default PairSelector;
