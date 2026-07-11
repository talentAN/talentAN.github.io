import React, { useState, useEffect } from 'react';
import { Table, Button, message, Input, Switch, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '@root/contract-record/watch.json';
import { getFutureTicker } from '@root/src/container/market';
import PositionCalculatorButton from '@trade/system_1/PositionCalculatorButton';

const BODY_SHRINK_TOOLTIP = (
  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
    <div style={{ marginBottom: 6, color: '#aaa' }}>核心指标：和暴涨那根K线比</div>
    <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 10 }}>
      <thead>
        <tr style={{ color: '#aaa', borderBottom: '1px solid #444' }}>
          <th style={{ textAlign: 'left', padding: '2px 8px 2px 0', fontWeight: 'normal' }}>
            阶段
          </th>
          <th style={{ textAlign: 'left', padding: '2px 8px', fontWeight: 'normal' }}>K线实体</th>
          <th style={{ textAlign: 'left', padding: '2px 8px', fontWeight: 'normal' }}>日内振幅</th>
          <th style={{ textAlign: 'left', padding: '2px 0', fontWeight: 'normal' }}>大致感觉</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ padding: '2px 8px 2px 0', color: '#faad14' }}>暴涨日</td>
          <td style={{ padding: '2px 8px' }}>基准 (100%)</td>
          <td style={{ padding: '2px 8px' }}>大</td>
          <td style={{ padding: '2px 0' }}>市场疯狂</td>
        </tr>
        <tr>
          <td style={{ padding: '2px 8px 2px 0' }}>缩量第1-2天</td>
          <td style={{ padding: '2px 8px' }}>1/3 以内</td>
          <td style={{ padding: '2px 8px' }}>明显收窄</td>
          <td style={{ padding: '2px 0' }}>开始安静</td>
        </tr>
        <tr>
          <td style={{ padding: '2px 8px 2px 0', color: '#52c41a' }}>横盘成熟 ✓</td>
          <td style={{ padding: '2px 8px' }}>1/5 ~ 1/10</td>
          <td style={{ padding: '2px 8px' }}>接近十字星</td>
          <td style={{ padding: '2px 0' }}>市场快睡着了</td>
        </tr>
      </tbody>
    </table>
    <div style={{ marginBottom: 6, color: '#aaa' }}>举个具体场景：</div>
    <div>暴涨日：实体 30%，振幅 35%</div>
    <div>第2天：实体 8%，振幅 12% → 还在消化，不急</div>
    <div>第3天：实体 4%，振幅 6%　→ 在收敛，继续等</div>
    <div style={{ color: '#52c41a' }}>第4天：实体 1.5%，振幅 3% → 到位了，开始蹲确认K线</div>
    <div style={{ marginTop: 8, color: '#aaa', borderTop: '1px solid #444', paddingTop: 6 }}>
      比绝对数字更重要的是趋势 — 每天都在缩小。如果第3天突然又放大了，说明多空还在打架，重新计时。
    </div>
    <div style={{ marginTop: 6 }}>
      快速判断：看最近两根K线，肉眼上和暴涨那根放一起像
      <span style={{ color: '#52c41a' }}>「一根柱子旁边站了两根牙签」</span>，差不多了； 还像
      <span style={{ color: '#faad14' }}>「两根筷子」</span>，再等等。
    </div>
  </div>
);

const CHECKS_CONFIG = [
  { key: 'btcEthNotStrong', label: 'BTC/ETH不处于强势上涨' },
  { key: 'volumeJustSpike', label: '币对刚放量暴涨' },
  { key: 'volumeReducedOver2Days', label: '已经缩量大于2天' },
  { key: ' bodyLoss', label: '实体最好越来越小', tooltip: BODY_SHRINK_TOOLTIP },
  { key: 'profitLossRatioGood', label: '盈亏比合适' },
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
    {
      title: '关注理由',
      dataIndex: 'reason',
      key: 'reason',
      width: 150,
      render: reason => <div>{reason}</div>,
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
      width: 300,
      render: text => <div style={{ whiteSpace: 'pre-wrap' }}>{text || '-'}</div>,
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
          <Tooltip
            title="暴涨放量 → 高位缩量 → K 线越来越小 → 突然一根放量阴线砸下来"
            color="#2f54eb"
            overlayStyle={{ maxWidth: 400 }}
          >
            <span
              style={{
                fontWeight: 'bold',
                minWidth: 'fit-content',
                borderBottom: '1px dashed #999',
                cursor: 'help',
              }}
            >
              入选条件
            </span>
          </Tooltip>
          {CHECKS_CONFIG.map(check => {
            const tag = (
              <span
                key={check.key}
                style={{
                  padding: '4px 10px',
                  background: '#f0f2f5',
                  borderRadius: '4px',
                  fontSize: 12,
                  color: '#666',
                  display: 'inline-block',
                  ...(check.tooltip ? { borderBottom: '1px dashed #999', cursor: 'help' } : {}),
                }}
              >
                {check.label}
              </span>
            );
            return check.tooltip ? (
              <Tooltip
                key={check.key}
                title={check.tooltip}
                color="#1f1f1f"
                overlayStyle={{ maxWidth: 420 }}
              >
                {tag}
              </Tooltip>
            ) : (
              tag
            );
          })}
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
        <span style={{ marginLeft: 8 }}>
          <PositionCalculatorButton />
        </span>
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
