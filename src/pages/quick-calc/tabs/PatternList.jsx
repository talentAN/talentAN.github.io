import React, { useState } from 'react';
import { Card, Table, Button, Input, message, Tag } from 'antd';
import patternData from '@root/contract-record/pattern.json';
import { symbolMatchPattern } from '@trade/utils/symbol-match-pattern';

const PatternList = ({ onPatternMatch }) => {
  const [dataSource] = useState(patternData);
  const [symbol, setSymbol] = useState('');
  const [checking, setChecking] = useState(false);
  const [matchedPatterns, setMatchedPatterns] = useState([]);

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
