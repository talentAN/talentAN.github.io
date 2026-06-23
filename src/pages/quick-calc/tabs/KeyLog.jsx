import React, { useState } from 'react';
import { Button, Modal, Form, Input, Empty, Typography } from 'antd';
import keyLogsData from '../../../data/key-logs.json';

const { Paragraph, Title } = Typography;

const KeyLog = () => {
  const [logs, setLogs] = useState(keyLogsData);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form] = Form.useForm();

  const handleAdd = () => {
    form.resetFields();
    setEditingId(null);
    setIsModalVisible(true);
  };

  const handleEdit = record => {
    form.setFieldsValue(record);
    setEditingId(record.id);
    setIsModalVisible(true);
  };

  const handleDelete = id => {
    setLogs(logs.filter(log => log.id !== id));
  };

  const handleSubmit = values => {
    if (editingId) {
      setLogs(logs.map(log => (log.id === editingId ? { ...log, ...values } : log)));
    } else {
      const newId = Math.max(...logs.map(l => l.id), 0) + 1;
      const today = new Date().toISOString().split('T')[0];
      setLogs([{ id: newId, date: today, ...values }, ...logs]);
    }
    setIsModalVisible(false);
  };

  const sortedLogs = [...logs].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      {sortedLogs.length === 0 ? (
        <Empty description="暂无日志" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {sortedLogs.map(log => (
            <div key={log.id} style={{ padding: '16px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ marginBottom: 8, color: '#333', fontWeight: 600 }}>{log.date}</div>
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {log.content}
              </Paragraph>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editingId ? '编辑日志' : '新增日志'}
        open={isModalVisible}
        onOk={() => form.submit()}
        onCancel={() => setIsModalVisible(false)}
        width={680}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label="日期"
            name="date"
            rules={[{ required: true, message: '请输入日期 (YYYY-MM-DD)' }]}
          >
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item
            label="内容"
            name="content"
            rules={[{ required: true, message: '请输入日志内容' }]}
          >
            <Input.TextArea rows={6} placeholder="记录关键的交易思路、结论和观察" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default KeyLog;
