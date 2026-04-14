import React, { useState } from 'react';
import { Card, Table, Button, message, Input, Switch, Checkbox, Space, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';
import watchData from '@root/contract-record/watch.json';

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

  const MIN_DATE = moment('2026-04-14 00:00:00');

  const isNewFormat = addTime => {
    if (!addTime) return false;
    return moment(addTime).isSameOrAfter(MIN_DATE);
  };

  const getRenderReason = record => {
    if (!isNewFormat(record.addTime)) {
      return record.reason;
    }

    // 新格式逻辑
    const reason = typeof record.reason === 'string' ? { isNewFormat: false } : record.reason || {};
    if (!reason.isNewFormat) return record.reason;

    const checks = reason.checks || {};

    const handleCheckChange = (checkKey, checked) => {
      const newDataSource = dataSource.map(item => {
        if (item.symbol === record.symbol && item.addTime === record.addTime) {
          return {
            ...item,
            reason: {
              ...reason,
              checks: {
                ...checks,
                [checkKey]: checked,
              },
            },
          };
        }
        return item;
      });
      setDataSource(newDataSource);
    };

    const handleSignalTypeChange = newSignalType => {
      const newDataSource = dataSource.map(item => {
        if (item.symbol === record.symbol && item.addTime === record.addTime) {
          return {
            ...item,
            reason: {
              ...reason,
              signalType: newSignalType,
            },
          };
        }
        return item;
      });
      setDataSource(newDataSource);
    };

    const handleSignalChange = (signalKey, checked) => {
      const signals = reason.signals || {};
      const newDataSource = dataSource.map(item => {
        if (item.symbol === record.symbol && item.addTime === record.addTime) {
          return {
            ...item,
            reason: {
              ...reason,
              signals: {
                ...signals,
                [signalKey]: checked,
              },
            },
          };
        }
        return item;
      });
      setDataSource(newDataSource);
    };

    const items = [
      { key: 'btcEthNotStrong', label: 'BTC/ETH不处于强势上涨', checked: checks.btcEthNotStrong },
      { key: 'volumeJustSpike', label: '币对刚放量暴涨', checked: checks.volumeJustSpike },
      {
        key: 'volumeReducedOver2Days',
        label: '已经缩量大于2天',
        checked: checks.volumeReducedOver2Days,
      },
      { key: 'profitLossRatioGood', label: '盈亏比合适', checked: checks.profitLossRatioGood },
    ];

    return (
      <div style={{ fontSize: 12 }}>
        {items.map(item => (
          <div key={item.key} style={{ marginBottom: 4 }}>
            <Checkbox
              checked={item.checked}
              onChange={e => handleCheckChange(item.key, e.target.checked)}
            >
              {item.label}
            </Checkbox>
          </div>
        ))}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e8e8e8' }}>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>
            信号出现
            <Tooltip
              title={
                <div style={{ whiteSpace: 'pre-wrap', maxWidth: 400 }}>
                  <div style={{ marginBottom: 8, fontWeight: 'bold' }}>高优</div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 4 }}>
                      <strong>看跌吞没：</strong>
                      前一天小阳线，第二天一根大阴线把前一天的实体完全包住。
                    </div>
                    <div>
                      <strong>流星线：</strong>
                      上影线很长（至少是实体的 2 倍），实体小，在下方，下影线很短或没有。
                    </div>
                  </div>
                  <div style={{ marginBottom: 8, fontWeight: 'bold' }}>第二梯队</div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 4 }}>
                      <strong>黄昏星：</strong>
                      第一根大阳线 → 第二根小实体（十字星更好）→ 第三根大阴线。
                    </div>
                    <div>
                      <strong>墓碑十字：</strong>
                      开盘价 = 收盘价 = 最低价，有长上影线。形态上像没有实体的流星线。
                    </div>
                  </div>
                  <div style={{ marginBottom: 8, fontWeight: 'bold' }}>辅助信号</div>
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      <strong>长上影线 + 关键阻力位：</strong>
                      不管实体是阳还是阴，只要上影线明显很长，就说明上方卖压重。
                    </div>
                    <div>
                      <strong>十字星：</strong>
                      开盘 ≈ 收盘，上下影线都有。需要等下一根 K 线确认方向。
                    </div>
                  </div>
                </div>
              }
              color="#2f54eb"
            >
              <span style={{ marginLeft: 6, cursor: 'help', color: '#1890ff' }}>(?)</span>
            </Tooltip>
          </div>
          {SIGNALS_CONFIG.map(category => (
            <div key={category.category} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 500 }}>
                {category.category}
              </div>
              {category.items.map(signal => {
                const signals = reason.signals || {};
                const isChecked = signals[signal.key] || false;
                return (
                  <div key={signal.key} style={{ marginLeft: 8, marginBottom: 3 }}>
                    <Checkbox checked={isChecked} onChange={e => handleSignalChange(signal.key, e.target.checked)}>
                      {signal.label}
                    </Checkbox>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

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
      render: (_, record) => <div>{getRenderReason(record)}</div>,
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
      reason: isNewFormat(moment().format('YYYY-MM-DD HH:mm:ss'))
        ? {
            isNewFormat: true,
            checks: {
              btcEthNotStrong: false,
              volumeJustSpike: false,
              volumeReducedOver2Days: false,
              profitLossRatioGood: false,
            },
            signals: {},
            signalType: '',
          }
        : newReason.trim(),
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
      <div style={{ marginBottom: 16, padding: 12, background: '#f0f2f5', borderRadius: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          累计观测
          <span style={{ color: '#1890ff', marginLeft: 4, marginRight: 4 }}>
            {dataSource.length}
          </span>
          条， 观测中
          <span style={{ color: '#52c41a', marginLeft: 4, marginRight: 4 }}>
            {dataSource.filter(item => item.achieved !== true).length}
          </span>
          条
        </span>
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
