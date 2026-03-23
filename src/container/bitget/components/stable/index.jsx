import React, { useMemo, useState, useEffect } from 'react';
import { Table, Typography } from 'antd';
import { Operation } from '../column';
import { useStableLine } from '../../hooks/stable-type';
import { getFutureKlineData } from '../../api';
import moment from 'moment';

const { Text } = Typography;

const StableTable = ({ futureSymbols }) => {
  const [priceData, setPriceData] = useState({});

  const { stablePairs: stableFutureSymbols, checkedSymbolCount: checkedFutureSymbolCount } =
    useStableLine({
      symbols: futureSymbols,
    });

  // 获取近两个月的最高价和最低价
  const fetchPriceRange = async symbol => {
    try {
      const endTime = moment().valueOf();
      const startTime = moment().subtract(60, 'days').valueOf();

      const klineData = await getFutureKlineData({
        symbol,
        granularity: '1D',
        limit: 60,
        startTime,
        endTime,
      });

      if (!klineData.data || klineData.data.length === 0) {
        return { highPrice: null, lowPrice: null };
      }

      const highPrice = Math.max(...klineData.data.map(k => parseFloat(k[2])));
      const lowPrice = Math.min(...klineData.data.map(k => parseFloat(k[3])));

      return { highPrice, lowPrice };
    } catch (error) {
      console.error(`获取${symbol}价格范围失败:`, error);
      return { highPrice: null, lowPrice: null };
    }
  };

  useEffect(() => {
    const loadPriceData = async () => {
      const newPriceData = {};
      for (const item of stableFutureSymbols) {
        const prices = await fetchPriceRange(item.symbol);
        newPriceData[item.symbol] = prices;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      setPriceData(newPriceData);
    };

    if (stableFutureSymbols.length > 0) {
      loadPriceData();
    }
  }, [stableFutureSymbols]);

  const data = useMemo(() => {
    const ret = stableFutureSymbols.map(f => ({
      ...f,
      highPrice: priceData[f.symbol]?.highPrice,
      lowPrice: priceData[f.symbol]?.lowPrice,
    }));
    return ret;
  }, [stableFutureSymbols, priceData]);

  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '7日平均成交额',
      dataIndex: 'avsTradingValueLast7Days',
      key: 'avsTradingValueLast7Days',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '最低价(60天)',
      dataIndex: 'lowPrice',
      key: 'lowPrice',
      render: price => (price ? parseFloat(price).toFixed(4) : '-'),
    },
    {
      title: '最高价(60天)',
      dataIndex: 'highPrice',
      key: 'highPrice',
      render: price => (price ? parseFloat(price).toFixed(4) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => <Operation record={record} />,
    },
  ];

  return (
    <>
      <div>{`合约共${futureSymbols.length}，已查看${checkedFutureSymbolCount}，已筛选${stableFutureSymbols.length}`}</div>
      <Table
        columns={columns}
        dataSource={data}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: total => `共 ${total} 个交易对`,
        }}
        scroll={{ x: 800 }}
      />
    </>
  );
};

export default StableTable;
