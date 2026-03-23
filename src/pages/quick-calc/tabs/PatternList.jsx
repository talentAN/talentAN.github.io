import React, { useState } from 'react';
import { Card, Table, Button, Input, message, Popconfirm } from 'antd';
import patternData from '../../../../contract-record/pattern.json';

const { TextArea } = Input;

const PatternList = ({ onPatternMatch }) => {
  const [dataSource, setDataSource] = useState(patternData);
  const [newPattern, setNewPattern] = useState('');
  const [newRemark, setNewRemark] = useState('');

  const columns = [
    {
      title: '模式',
      dataIndex: 'pattern',
      key: 'pattern',
      width: 200,
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
      render: (_, record, index) => (
        <>
          {record.id && (
            <Button
              type="primary"
              size="small"
              onClick={() => onPatternMatch && onPatternMatch(record.id)}
              style={{ marginRight: 8 }}
            >
              模式匹配
            </Button>
          )}
        </>
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      render: text => <div style={{ whiteSpace: 'pre-wrap' }}>{text || '-'}</div>,
    },
  ];

  const handleDelete = index => {
    const newData = dataSource.filter((_, i) => i !== index);
    setDataSource(newData);
    message.success('删除成功');
  };

  const handleExport = () => {
    const text = JSON.stringify(dataSource, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success('已复制到剪贴板，请手动更新 pattern.json 文件');
      })
      .catch(() => {
        message.error('复制失败');
      });
  };

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="模式名称"
          value={newPattern}
          onChange={e => setNewPattern(e.target.value)}
          style={{ width: 200, marginRight: 8 }}
        />
        <TextArea
          placeholder="备注说明"
          value={newRemark}
          onChange={e => setNewRemark(e.target.value)}
          style={{ width: 400, marginRight: 8 }}
          rows={2}
        />
        <Button onClick={handleExport}>导出数据</Button>
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
