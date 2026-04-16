import React, { useState, useEffect } from 'react';
import { Table, Button, message, Input, Switch, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '@root/contract-record/watch.json';
import { getFutureTicker } from '@root/src/container/bitget/api';

const CHECKS_CONFIG = [
  { key: 'btcEthNotStrong', label: 'BTC/ETH不处于强势上涨' },
  { key: 'volumeJustSpike', label: '币对刚放量暴涨' },
  { key: 'volumeReducedOver2Days', label: '已经缩量大于2天' },
  { key: ' bodyLoss', label: '实体越来越小' },
  { key: 'profitLossRatioGood', label: '盈亏比合适' },
];

const SIGNALS_CONFIG = [
  {
    category: '高优',
    items: [
      {
        key: 'bearishEngulfing',
        label: '看跌吞没',
        desc: '前一天小阳线，第二天一根大阴线把前一天的实体完全包住。',
      },
      {
        key: 'shootingStar',
        label: '流星线',
        desc: '上影线很长（至少是实体的 2 倍），实体小，在下方，下影线很短或没有。',
      },
    ],
  },
  {
    category: '第二梯队',
    items: [
      {
        key: 'eveningStar',
        label: '黄昏星',
        desc: '第一根大阳线 → 第二根小实体（十字星更好）→ 第三根大阴线。',
      },
      {
        key: 'tombstoneDoji',
        label: '墓碑十字',
        desc: '开盘价 = 收盘价 = 最低价，有长上影线。形态上像没有实体的流星线。',
      },
    ],
  },
  {
    category: '辅助信号',
    items: [
      {
        key: 'longUpperShadow',
        label: '长上影线 + 关键阻力位',
        desc: '不管实体是阳还是阴，只要上影线明显很长，就说明上方卖压重。',
      },
      {
        key: 'crossoverDoji',
        label: '十字星',
        desc: '开盘 ≈ 收盘，上下影线都有。需要等下一根 K 线确认方向。',
      },
    ],
  },
];

const WatchList = () => {
  const [dataSource, setDataSource] = useState(watchData);
  const [newSymbol, setNewSymbol] = useState('');
  const [newReason, setNewReason] = useState('');
  const [showOnlyWatching, setShowOnlyWatching] = useState(true);
  const [prices, setPrices] = useState({});

  // 获取价格
  useEffect(() => {
    const fetchPrices = async () => {
      const activeItems = dataSource.filter(item => item.achieved !== true);
      const newPrices = {};

      for (const item of activeItems) {
        try {
          const tickerData = await getFutureTicker(item.symbol);
          if (tickerData && tickerData.lastPr) {
            newPrices[item.symbol] = parseFloat(tickerData.lastPr).toFixed(6);
          }
        } catch (e) {
          console.error(`获取 ${item.symbol} 价格失败:`, e);
        }
      }

      setPrices(newPrices);
    };

    fetchPrices();
  }, [dataSource]);

  const baseColumns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 120,
      render: symbol => (
        <a
          href={`https://www.bitget.com/zh-CN/futures/usdt/${symbol}`}
          target="_blank"
          rel="noopener noreferrer"
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
    {
      title: '关注理由',
      dataIndex: 'reason',
      key: 'reason',
      width: 300,
      render: readon => (
        <div style={{ maxWidth: '300px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
          {readon}
        </div>
      ),
    },
  ];

  const columns = [
    ...baseColumns,
    ...(showOnlyWatching
      ? [
          {
            title: '最新价格',
            key: 'latestPrice',
            width: 80,
            render: (_, record) => prices[record.symbol] || '-',
          },
        ]
      : []),
    {
      title: '后续',
      dataIndex: 'followUp',
      key: 'followUp',
      width: 150,
      render: text => (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            maxHeight: '150px',
            overflowY: 'auto',
            wordBreak: 'break-word',
          }}
        >
          {text || '-'}
        </div>
      ),
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
      reason: newReason.trim(),
    };

    setDataSource([newRecord, ...dataSource]);
    setNewSymbol('');
    setNewReason('');
    message.success('添加成功');
  };

  const handleExport = () => {
    const text = JSON.stringify(dataSource, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success('已复制到剪贴板，请手动更新 watch.json 文件');
      })
      .catch(() => {
        message.error('复制失败');
      });
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
          {CHECKS_CONFIG.map(check => (
            <span
              key={check.key}
              style={{
                padding: '4px 10px',
                background: '#f0f2f5',
                borderRadius: '4px',
                fontSize: 12,
                color: '#666',
                display: 'inline-block',
              }}
            >
              {check.label}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', minWidth: 'fit-content' }}>信号</span>
          {SIGNALS_CONFIG.flatMap(category =>
            category.items.map(signal => (
              <Tooltip
                key={signal.key}
                title={signal.desc}
                color="#2f54eb"
                overlayStyle={{ maxWidth: 350 }}
              >
                <span
                  style={{
                    padding: '4px 10px',
                    background: '#f0f2f5',
                    borderRadius: '4px',
                    fontSize: 12,
                    cursor: 'help',
                    color: '#1890ff',
                    display: 'inline-block',
                  }}
                >
                  {signal.label}
                </span>
              </Tooltip>
            ))
          )}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="币对名称（如：BTCUSDT）"
          value={newSymbol}
          onChange={e => setNewSymbol(e.target.value)}
          style={{ width: 200, marginRight: 8 }}
        />
        <Input
          placeholder="关注理由"
          value={newReason}
          onChange={e => setNewReason(e.target.value)}
          style={{ width: 300, marginRight: 8 }}
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
      />
    </div>
  );
};

export default WatchList;
