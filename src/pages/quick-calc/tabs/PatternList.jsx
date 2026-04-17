import React, { useState } from 'react';
import { Card, Table, Button } from 'antd';
import patternData from '@root/contract-record/pattern.json';

const PatternList = ({ onPatternMatch }) => {
  const [dataSource] = useState(patternData);

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
