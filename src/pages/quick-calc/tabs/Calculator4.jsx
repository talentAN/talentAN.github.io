import React, { useState, useEffect } from 'react';
import { Card, Table, Button, message, Progress } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getFutureKlineData } from '../../../container/bitget/api';
import localRecords from '@root/contract-record/all.json';
import moment from 'moment';

const Calculator4 = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const columns = [
    {
      title: '开仓时间',
      dataIndex: 'ctime',
      key: 'ctime',
      width: 120,
      render: time => moment(parseInt(time)).format('YYYY-MM-DD'),
    },
    {
      title: '合约',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 120,
    },
    {
      title: '方向',
      dataIndex: 'holdSide',
      key: 'holdSide',
      width: 80,
      render: side => (side === 'long' ? '做多' : '做空'),
    },
    {
      title: '开仓价',
      dataIndex: 'openAvgPrice',
      key: 'openAvgPrice',
      width: 100,
      render: price => (price ? parseFloat(price).toFixed(4) : '-'),
    },
    {
      title: '初始保证金',
      key: 'initialMargin',
      width: 100,
      render: () => '10',
    },
    {
      title: '60天极限价',
      key: 'extremePrice',
      width: 120,
      render: (_, record) => {
        const price = record.holdSide === 'short' ? record.highPrice : record.lowPrice;
        return price ? parseFloat(price).toFixed(4) : '-';
      },
      onCell: (record) => {
        const price = record.holdSide === 'short' ? record.highPrice : record.lowPrice;
        return {
          style: { backgroundColor: !price ? '#ffe6e6' : 'transparent' }
        };
      }
    },
    {
      title: '极限价日期',
      key: 'extremeDate',
      width: 120,
      render: (_, record) => {
        const date = record.holdSide === 'short' ? record.highDate : record.lowDate;
        return date || '-';
      },
      onCell: (record) => {
        const date = record.holdSide === 'short' ? record.highDate : record.lowDate;
        return {
          style: { backgroundColor: !date ? '#ffe6e6' : 'transparent' }
        };
      }
    },
    {
      title: '需额外补充保证金',
      dataIndex: 'requiredMargin',
      key: 'requiredMargin',
      width: 120,
      render: margin => (margin ? parseFloat(margin).toFixed(2) : '-'),
      onCell: (record) => ({
        style: { backgroundColor: !record.requiredMargin ? '#ffe6e6' : 'transparent' }
      })
    },
    {
      title: '60天内是否可盈利',
      key: 'canProfit',
      width: 120,
      render: (_, record) => {
        const openPrice = parseFloat(record.openAvgPrice);
        if (record.holdSide === 'short') {
          // 做空：如果最低价低于开仓价，则可盈利
          const lowPrice = record.lowPrice;
          if (!lowPrice) return '-';
          return parseFloat(lowPrice) < openPrice ? '✅' : '❌';
        } else {
          // 做多：如果最高价高于开仓价，则可盈利
          const highPrice = record.highPrice;
          if (!highPrice) return '-';
          return parseFloat(highPrice) > openPrice ? '✅' : '❌';
        }
      },
      onCell: (record) => {
        const hasData = record.holdSide === 'short' ? record.lowPrice : record.highPrice;
        return {
          style: { backgroundColor: !hasData ? '#ffe6e6' : 'transparent' }
        };
      }
    },
  ];

  // 计算所需保证金
  const calculateRequiredMargin = (openPrice, extremePrice, holdSide, leverage, quantity) => {
    if (!extremePrice || !openPrice) return null;

    const initialMargin = 10;
    const lev = parseFloat(leverage);
    const qty = parseFloat(quantity);
    const open = parseFloat(openPrice);
    const extreme = parseFloat(extremePrice);

    // 逐仓爆仓价公式：
    // 做多: 爆仓价 = 开仓价 - (保证金 * 杠杆) / 数量
    // 做空: 爆仓价 = 开仓价 + (保证金 * 杠杆) / 数量
    //
    // 反推所需保证金：
    // 做多: 保证金 = (开仓价 - 极值价) * 数量 / 杠杆
    // 做空: 保证金 = (极值价 - 开仓价) * 数量 / 杠杆

    let requiredMargin;
    if (holdSide === 'long') {
      // 做多时，极值价是最低价，需要保证不在最低价爆仓
      requiredMargin = ((open - extreme) * qty) / lev;
    } else {
      // 做空时，极值价是最高价，需要保证不在最高价爆仓
      requiredMargin = ((extreme - open) * qty) / lev;
    }

    // 如果计算出的保证金小于初始保证金，说明初始保证金已足够
    return Math.max(requiredMargin, initialMargin);
  };

  const getExtremePrice = async (symbol, startTime, holdSide) => {
    try {
      const endTime = startTime + 60 * 24 * 60 * 60 * 1000;

      const klineData = await getFutureKlineData({
        symbol,
        granularity: '1D',
        limit: 60,
        startTime,
        endTime,
      });

      if (!klineData.data || klineData.data.length === 0) {
        return { highPrice: null, highDate: null, lowPrice: null, lowDate: null };
      }

      // K线数据格式: [timestamp, open, high, low, close, volume, quoteVolume]
      // 获取最高价
      const highPrice = Math.max(...klineData.data.map(k => parseFloat(k[2])));
      const highCandle = klineData.data.find(k => parseFloat(k[2]) === highPrice);
      
      // 获取最低价
      const lowPrice = Math.min(...klineData.data.map(k => parseFloat(k[3])));
      const lowCandle = klineData.data.find(k => parseFloat(k[3]) === lowPrice);

      return {
        highPrice,
        highDate: highCandle ? moment(parseInt(highCandle[0])).format('YYYY-MM-DD') : null,
        lowPrice,
        lowDate: lowCandle ? moment(parseInt(lowCandle[0])).format('YYYY-MM-DD') : null,
      };
    } catch (error) {
      console.error(`获取${symbol}极值价格失败:`, error);
      return { highPrice: null, highDate: null, lowPrice: null, lowDate: null };
    }
  };

  const processBatch = async (records, batchSize = 10) => {
    const results = [];
    const total = records.length;

    for (let i = 0; i < total; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      console.log(`处理第 ${i + 1}-${Math.min(i + batchSize, total)} 条记录`);

      const batchResults = await Promise.all(
        batch.map(async record => {
          const openTime = parseInt(record.ctime);
          const extreme = await getExtremePrice(record.symbol, openTime, record.holdSide);

          const extremePrice = record.holdSide === 'short' ? extreme.highPrice : extreme.lowPrice;
          const requiredMargin = calculateRequiredMargin(
            record.openAvgPrice,
            extremePrice,
            record.holdSide,
            record.leverage,
            record.openTotalPos
          );

          return {
            ctime: record.ctime,
            symbol: record.symbol,
            holdSide: record.holdSide,
            openAvgPrice: record.openAvgPrice,
            leverage: record.leverage,
            openTotalPos: record.openTotalPos,
            highPrice: extreme.highPrice,
            highDate: extreme.highDate,
            lowPrice: extreme.lowPrice,
            lowDate: extreme.lowDate,
            requiredMargin,
          };
        })
      );

      results.push(...batchResults);
      setProgress(Math.floor(((i + batchSize) / total) * 100));

      // 批次间延迟2秒
      if (i + batchSize < total) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  };

  const fetchData = async () => {
    setLoading(true);
    setProgress(0);

    try {
      const validRecords = localRecords.filter(r => r.type !== 'summery');
      const results = await processBatch(validRecords);

      setProgress(100);
      setData(results);
      message.success(`处理完成，共 ${results.length} 条记录`);
    } catch (error) {
      message.error('处理失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          重新分析
        </Button>
        {loading && (
          <div style={{ marginTop: 16 }}>
            <Progress percent={progress} status="active" />
          </div>
        )}
      </div>
      <Table
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey={(record, index) => `${record.symbol}_${record.ctime}_${index}`}
        pagination={{ pageSize: 50 }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
};

export default Calculator4;
