import React, { useState } from 'react';
import { Card, Table, Button, message, Input, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '@root/contract-record/watch.json';

const WatchList = () => {
  const [dataSource, setDataSource] = useState(watchData);
  const [newSymbol, setNewSymbol] = useState('');
  const [newReason, setNewReason] = useState('');
  const [showOnlyWatching, setShowOnlyWatching] = useState(true);

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 150,
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
      width: 120,
      render: time => time || '-',
    },
    {
      title: '关注理由',
      dataIndex: 'reason',
      key: 'reason',
      render: text => (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            maxHeight: '150px',
            overflowY: 'auto',
            maxWidth: '400px',
            wordBreak: 'break-word',
          }}
        >
          {text || '-'}
        </div>
      ),
    },
    {
      title: '后续',
      dataIndex: 'followUp',
      key: 'followUp',
      render: text => (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            maxHeight: '150px',
            overflowY: 'auto',
            maxWidth: '400px',
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
      followUp: '',
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
