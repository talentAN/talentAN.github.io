import React, { useState, useEffect } from 'react';
import { Table, Button, message, Input, Switch, Tag, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '@root/contract-record/watch-newcoin.json';
import { getFutureTicker, getFutureKlineData } from '@root/src/container/bitget/api';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const WatchList = () => {
  const [dataSource, setDataSource] = useState(watchData);
  const [newSymbol, setNewSymbol] = useState('');
  const [showOnlyWatching, setShowOnlyWatching] = useState(true);
  const [prices, setPrices] = useState({});
  const [klineInfo, setKlineInfo] = useState({});
  const [loadingKline, setLoadingKline] = useState(false);

  useEffect(() => {
    const activeItems = dataSource.filter(item => item.achieved !== true);
    if (!activeItems.length) return;

    const fetchPrices = async () => {
      const newPrices = {};
      for (const item of activeItems) {
        try {
          const tickerData = await getFutureTicker(item.symbol);
          if (tickerData) {
            const entry = {};
            if (tickerData.lastPr) entry.price = parseFloat(tickerData.lastPr).toFixed(6);
            if (tickerData.quoteVolume) entry.quoteVolume = parseFloat(tickerData.quoteVolume);
            newPrices[item.symbol] = entry;
          }
        } catch (e) {
          console.error(`获取 ${item.symbol} 价格失败:`, e);
        }
      }
      setPrices(newPrices);
    };

    const fetchKlineInfo = async () => {
      setLoadingKline(true);
      const info = {};
      const now = Date.now();
      const searchStart = now - 130 * 24 * 60 * 60 * 1000;

      for (const item of activeItems) {
        try {
          let listTs = null;
          for (let cs = searchStart; cs < now; cs += THREE_MONTHS_MS) {
            const ce = Math.min(cs + THREE_MONTHS_MS, now);
            const res = await getFutureKlineData({
              symbol: item.symbol,
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
          if (!listTs) continue;

          let allCandles = [];
          for (let cs = listTs; cs < now; cs += THREE_MONTHS_MS) {
            const ce = Math.min(cs + THREE_MONTHS_MS, now);
            const res = await getFutureKlineData({
              symbol: item.symbol,
              granularity: '1Dutc',
              limit: 100,
              startTime: cs,
              endTime: ce,
            });
            const chunk = Array.isArray(res?.data) ? res.data : [];
            allCandles.push(...chunk);
          }

          if (allCandles.length < 1) continue;
          allCandles.sort((a, b) => Number(a[0]) - Number(b[0]));

          let minLow = Infinity;
          let maxHigh = -Infinity;
          let stableDays = 0;

          for (let d = 0; d < allCandles.length; d++) {
            const high = parseFloat(allCandles[d][2]);
            const low = parseFloat(allCandles[d][3]);
            maxHigh = Math.max(maxHigh, high);
            minLow = Math.min(minLow, low);
            if (minLow > 0 && maxHigh <= minLow * 2.5) {
              stableDays = d + 1;
            } else {
              break;
            }
          }

          info[item.symbol] = {
            minLow: minLow === Infinity ? '-' : minLow.toPrecision(4),
            maxHigh: maxHigh === -Infinity ? '-' : maxHigh.toPrecision(4),
            stableDays,
          };
        } catch (_) {}
      }
      setKlineInfo(info);
      setLoadingKline(false);
    };

    fetchPrices();
    fetchKlineInfo();
  }, [dataSource]);

  const baseColumns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 120,
      render: (symbol, record) => (
        <a
          href={`https://www.bitget.com/zh-CN/futures/usdt/${symbol}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...(!showOnlyWatching && record.judge === 1 ? { color: '#52c41a' } : {}),
            ...(!showOnlyWatching && record.judge === -1 ? { color: '#f5222d' } : {}),
          }}
        >
          {symbol}
        </a>
      ),
    },
    {
      title: '添加时间',
      dataIndex: 'addTime',
      key: 'addTime',
      width: 100,
      render: time => time || '-',
    },
  ];

  const watchingColumns = [
    {
      title: '区间最低',
      key: 'minLow',
      width: 100,
      render: (_, record) =>
        klineInfo[record.symbol]?.minLow || (loadingKline ? <Spin size="small" /> : '-'),
    },
    {
      title: '区间最高',
      key: 'maxHigh',
      width: 100,
      render: (_, record) =>
        klineInfo[record.symbol]?.maxHigh || (loadingKline ? <Spin size="small" /> : '-'),
    },
    {
      title: '最新价格',
      key: 'latestPrice',
      width: 100,
      render: (_, record) => prices[record.symbol]?.price || '-',
    },
    {
      title: '24h成交额(USDT)',
      key: 'quoteVolume',
      width: 130,
      render: (_, record) => {
        const vol = prices[record.symbol]?.quoteVolume;
        if (vol == null) return '-';
        if (vol >= 1e8) return `${(vol / 1e8).toFixed(2)}亿`;
        if (vol >= 1e4) return `${(vol / 1e4).toFixed(1)}万`;
        return vol.toFixed(0);
      },
    },
    {
      title: '横盘天数',
      key: 'stableDays',
      width: 90,
      render: (_, record) => {
        const days = klineInfo[record.symbol]?.stableDays;
        if (days == null) return loadingKline ? <Spin size="small" /> : '-';
        return <Tag color={days >= 60 ? 'green' : days >= 30 ? 'blue' : 'orange'}>{days}天</Tag>;
      },
    },
  ];

  const columns = [
    ...baseColumns,
    ...(showOnlyWatching ? watchingColumns : []),
    {
      title: '后续',
      dataIndex: 'followUp',
      key: 'followUp',
      width: 150,
      render: text => <div>{text || '-'}</div>,
    },
  ];

  const handleAdd = () => {
    if (!newSymbol.trim()) {
      message.warning('请输入币对名称');
      return;
    }
    const newRecord = {
      symbol: newSymbol.trim().toUpperCase(),
      addTime: moment().format('YYYY-MM-DD HH:mm:ss'),
      reason: '',
    };
    setDataSource([newRecord, ...dataSource]);
    setNewSymbol('');
    message.success('添加成功');
  };

  const handleExport = () => {
    navigator.clipboard
      .writeText(JSON.stringify(dataSource, null, 2))
      .then(() => message.success('已复制到剪贴板，请手动更新 watch-newcoin.json 文件'))
      .catch(() => message.error('复制失败'));
  };

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ padding: '4px 10px', background: '#f0f2f5', borderRadius: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: '#52c41a' }}>
              {dataSource.filter(item => item.achieved !== true).length}
            </span>
            <span style={{ color: '#666', margin: '0 4px' }}>/</span>
            <span style={{ color: '#1890ff' }}>{dataSource.length}</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', minWidth: 'fit-content' }}>入选条件</span>
          {['上线 < 100天', '最高价 < 最低价×2.5', '低波动高潜力'].map(label => (
            <span
              key={label}
              style={{
                padding: '4px 10px',
                background: '#f0f2f5',
                borderRadius: '4px',
                fontSize: 12,
                color: '#666',
                display: 'inline-block',
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="币对名称（如：BTCUSDT）"
          value={newSymbol}
          onChange={e => setNewSymbol(e.target.value)}
          style={{ width: 200, marginRight: 8 }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          style={{ marginRight: 8 }}
        >
          添加
        </Button>
        <Button onClick={handleExport}>导出数据</Button>
        <Switch
          checked={showOnlyWatching}
          onChange={setShowOnlyWatching}
          style={{ marginLeft: 16 }}
        />
        <span style={{ marginLeft: 8 }}>观察中</span>
      </div>
      {!showOnlyWatching &&
        (() => {
          const finished = dataSource.filter(item => item.achieved === true);
          const correct = finished.filter(item => item.judge === 1).length;
          const wrong = finished.filter(item => item.judge === -1).length;
          return (
            <div style={{ marginBottom: 12, display: 'flex', gap: 16 }}>
              <span style={{ color: '#52c41a' }}>判断正确：{correct}</span>
              <span style={{ color: '#f5222d' }}>判断错误：{wrong}</span>
            </div>
          );
        })()}
      <Table
        columns={columns}
        dataSource={
          showOnlyWatching
            ? dataSource.filter(item => item.achieved !== true)
            : dataSource.filter(item => item.achieved === true)
        }
        rowKey={(record, index) => `${record.symbol}_${index}`}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowClassName={() => (!showOnlyWatching ? 'compact-row' : '')}
      />
    </div>
  );
};

export default WatchList;
