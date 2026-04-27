import React, { useState, useEffect } from 'react';
import { Tabs, Table, Button, Input, message, Modal } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import moment from 'moment';
import patternData from '@root/contract-record/find-pattern.json';
import { getFutureTicker } from '@root/src/container/bitget/api';

const FindPattern = () => {
  const [tabs, setTabs] = useState(patternData.tabs || []);
  const [activeKey, setActiveKey] = useState(tabs[0]?.key || 'tab1');
  const [newSymbol, setNewSymbol] = useState('');
  const [newKeyDate, setNewKeyDate] = useState('');
  const [newTabName, setNewTabName] = useState('');
  const [showAddTab, setShowAddTab] = useState(false);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    const fetchPrices = async () => {
      const allSymbols = new Set();
      tabs.forEach(tab => {
        tab.data.forEach(item => allSymbols.add(item.symbol));
      });

      const newPrices = {};
      for (const symbol of allSymbols) {
        try {
          const tickerData = await getFutureTicker(symbol);
          if (tickerData && tickerData.lastPr) {
            newPrices[symbol] = parseFloat(tickerData.lastPr).toFixed(6);
          }
        } catch (e) {
          console.error(`获取 ${symbol} 价格失败:`, e);
        }
      }
      setPrices(newPrices);
    };

    fetchPrices();
  }, [tabs]);

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 140,
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
    activeKey === "tab_1777012187647" &&{
        title: '横盘天数',
        dataIndex: 'period',
        key: 'period',
        width: 90,
        render: (v, r) => r.stableDays ? `${r.stableDays}天` : (v || '-'),
    },
    activeKey === "tab_1777012187647" && {
      title: '下沿/上沿/最高点',
      dataIndex: 'sum',
      key: 'sum',
      width: 150,
      render: (_, r) => (r.low && r.high && r.highPoint) ? `${r.low} / ${r.high} / ${r.highPoint}` : '-',
    },
    activeKey === "tab_1777012187647" && {
      title: '上架日期',
      dataIndex: 'listDate',
      key: 'listDate',
      width: 110,
      render: v => v || '-',
    },
    activeKey === "tab_1777012187647" && {
      title: '区间最高',
      dataIndex: 'maxHigh',
      key: 'maxHigh',
      width: 100,
      render: v => v || '-',
    },
    activeKey === "tab_1777012187647" && {
      title: '区间最低',
      dataIndex: 'minLow',
      key: 'minLow',
      width: 100,
      render: v => v || '-',
    },
    activeKey === "tab_1777012187647" && {
      title: '最高/最低',
      dataIndex: 'ratio',
      key: 'ratio',
      width: 90,
      render: v => v ? `${v}x` : '-',
    },
    activeKey === "tab_1777012187647" && {
      title: '跳出日期',
      dataIndex: 'breakoutDate',
      key: 'breakoutDate',
      width: 110,
      render: v => v || '-',
    },
    activeKey === 'tab1' && {
      title: '关键日期',
      dataIndex: 'keyDate',
      key: 'keyDate',
      width: 120,
      render: text => text || '-',
    },
    activeKey === 'tab1' &&{
      title: '添加日期',
      dataIndex: 'addDate',
      key: 'addDate',
      width: 120,
      render: text => text || '-',
    },
    {
      title: '最新价',
      key: 'latestPrice',
      width: 120,
      render: (_, record) => prices[record.symbol] || '-',
    },
  ].filter(column => !!column);

  const handleAddRecord = () => {
    if (!newSymbol.trim()) {
      message.warning('请输入币对名称');
      return;
    }

    const newRecord = {
      symbol: newSymbol.trim().toUpperCase(),
      keyDate: newKeyDate.trim() || moment().format('YYYY-MM-DD'),
      addDate: moment().format('YYYY-MM-DD'),
    };

    setTabs(prev =>
      prev.map(tab => (tab.key === activeKey ? { ...tab, data: [newRecord, ...tab.data] } : tab))
    );
    setNewSymbol('');
    setNewKeyDate('');
    message.success('添加成功');
  };

  const handleAddTab = () => {
    if (!newTabName.trim()) {
      message.warning('请输入分组名称');
      return;
    }
    const key = `tab_${Date.now()}`;
    setTabs(prev => [...prev, { key, label: newTabName.trim(), data: [] }]);
    setActiveKey(key);
    setNewTabName('');
    setShowAddTab(false);
    message.success('分组已添加');
  };

  const handleDeleteTab = targetKey => {
    if (tabs.length <= 1) {
      message.warning('至少保留一个分组');
      return;
    }
    const newTabs = tabs.filter(t => t.key !== targetKey);
    if (activeKey === targetKey) {
      setActiveKey(newTabs[0].key);
    }
    setTabs(newTabs);
  };

  const handleExport = () => {
    const text = JSON.stringify({ tabs }, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => message.success('已复制到剪贴板，请手动更新 find-pattern.json'))
      .catch(() => message.error('复制失败'));
  };

  const tabItems = tabs.map(tab => ({
    key: tab.key,
    label: tab.label,
    children: (
      <Table
        columns={columns}
        dataSource={tab.data}
        rowKey={(record, index) => `${record.symbol}_${index}`}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="small"
      />
    ),
  }));

  return (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Input
          placeholder="币对名称（如：BTCUSDT）"
          value={newSymbol}
          onChange={e => setNewSymbol(e.target.value)}
          style={{ width: 200 }}
          onPressEnter={handleAddRecord}
        />
        <Input
          placeholder="关键日期（如：2026-04-20）"
          value={newKeyDate}
          onChange={e => setNewKeyDate(e.target.value)}
          style={{ width: 200 }}
          onPressEnter={handleAddRecord}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRecord}>
          添加到当前分组
        </Button>
        <Button onClick={() => setShowAddTab(true)}>新建分组</Button>
        <Button onClick={handleExport}>导出数据</Button>
      </div>

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        type="editable-card"
        onEdit={(targetKey, action) => {
          if (action === 'add') setShowAddTab(true);
          if (action === 'remove') handleDeleteTab(targetKey);
        }}
        items={tabItems}
      />

      <Modal
        title="新建分组"
        open={showAddTab}
        onOk={handleAddTab}
        onCancel={() => {
          setShowAddTab(false);
          setNewTabName('');
        }}
        okText="确定"
        cancelText="取消"
      >
        <Input
          placeholder="分组名称"
          value={newTabName}
          onChange={e => setNewTabName(e.target.value)}
          onPressEnter={handleAddTab}
        />
      </Modal>
    </div>
  );
};

export default FindPattern;
