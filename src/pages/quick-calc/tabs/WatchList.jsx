import React, { useState } from 'react';
import { Card, Table, Button, Input, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '../../../../contract-record/watch.json';

const WatchList = () => {
  const [dataSource, setDataSource] = useState(watchData);
  const [newSymbol, setNewSymbol] = useState('');
  const [newReason, setNewReason] = useState('');

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 150,
      render: (symbol) => (
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
      render: (time) => time || '-',
    },
    {
      title: '关注理由',
      dataIndex: 'reason',
      key: 'reason',
      render: (text) => <div style={{ whiteSpace: 'pre-wrap' }}>{text || '-'}</div>,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record, index) => (
        <Popconfirm
          title="确定删除？"
          onConfirm={() => handleDelete(index)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            删除
          </Button>
        </Popconfirm>
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
    
    setDataSource([...dataSource, newRecord]);
    setNewSymbol('');
    setNewReason('');
    message.success('添加成功');
  };

  const handleDelete = (index) => {
    const newData = dataSource.filter((_, i) => i !== index);
    setDataSource(newData);
    message.success('删除成功');
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
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="币对名称（如：BTCUSDT）"
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value)}
          style={{ width: 200, marginRight: 8 }}
        />
        <Input
          placeholder="关注理由"
          value={newReason}
          onChange={(e) => setNewReason(e.target.value)}
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
        <Button onClick={handleExport}>
          导出数据
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={dataSource}
        rowKey={(record, index) => `${record.symbol}_${index}`}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
};

export default WatchList;
