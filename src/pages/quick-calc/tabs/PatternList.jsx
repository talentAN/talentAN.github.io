import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Input, message, Tag, Row, Col, Statistic, Spin } from 'antd';
import patternData from '@root/contract-record/pattern.json';
import { symbolMatchPattern } from '@root/src/container/bitget/utils/trade-record/symbol-match-pattern';
import { getFutureKlineData } from '../../../container/bitget/api';
import moment from 'moment';

const PatternList = ({ onPatternMatch }) => {
  const [dataSource] = useState(patternData);
  const [symbol, setSymbol] = useState('');
  const [checking, setChecking] = useState(false);
  const [matchedPatterns, setMatchedPatterns] = useState([]);
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

  useEffect(() => {
    fetchMarketData();
  }, []);

  const checkPattern = async () => {
    if (!symbol.trim()) {
      message.warning('请输入币对名称');
      return;
    }

    setChecking(true);
    setMatchedPatterns([]);

    try {
      const matched = await symbolMatchPattern(symbol);
      setMatchedPatterns(matched);

      if (matched.length > 0) {
        message.success(`匹配到 ${matched.length} 个模式`);
      } else {
        message.info('未匹配到任何模式');
      }
    } catch (error) {
      message.error('检测失败：' + error.message);
    } finally {
      setChecking(false);
    }
  };

  const columns = [
    {
      title: '模式',
      dataIndex: 'pattern',
      key: 'pattern',
      width: 200,
      render: (text, record) => {
        const income = record.income || 0;
        const color = income > 0 ? 'green' : income < 0 ? 'red' : 'inherit';
        return <span style={{ color, fontWeight: 'bold' }}>{text}</span>;
      },
    },
    {
      title: '形态',
      key: 'gesture',
      dataIndex: 'gesture',
      width: 400,
      render: text => <div style={{ whiteSpace: 'pre-wrap' }}>{text || '-'}</div>,
    },
    {
      title: '操作',
      key: 'action',
      width: 400,
      render: (_, record) => (
        <>
          {record.id && (
            <Button
              type="primary"
              size="small"
              onClick={() => onPatternMatch && onPatternMatch(record.id)}
            >
              搜索
            </Button>
          )}
        </>
      ),
    },
  ];

  return (
    <Card>
      {loadingMarket ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin tip="加载市场数据..." />
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Card size="small" title="BTC 涨跌幅">
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
              <Card size="small" title="ETH 涨跌幅">
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
        </div>
      )}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          placeholder="输入币对名称（如：BTCUSDT）"
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          onPressEnter={checkPattern}
          style={{ width: 300 }}
        />
        <Button type="primary" onClick={checkPattern} loading={checking}>
          检测模式
        </Button>
        {matchedPatterns.length > 0 && (
          <div style={{ marginLeft: 16 }}>
            {matchedPatterns.map((pattern, index) => (
              <Tag color="green" key={index}>
                匹配: {pattern}
              </Tag>
            ))}
          </div>
        )}
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey={(record, index) => `${record.pattern}_${index}`}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
};

export default PatternList;
