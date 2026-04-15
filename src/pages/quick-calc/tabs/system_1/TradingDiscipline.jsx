import React, { useState } from 'react';
import { Card, Typography, Divider, Button, Input, Space, List, Modal, Form } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

const TradingDiscipline = () => {
  const defaultDisciplines = [
    {
      id: 1,
      title: '插针当天不重新进场',
      description: '如果某个币对当日出现插针被止损，当天不再重新进场，等次日看形态再说。',
      category: '风险管理',
    },
    {
      id: 2,
      title: '只看已收盘的K线判断',
      description: '入场判断基于已经收盘的K线形态，不要看未收盘的K线。当前遇到价格波动时，只看价格是否符合自己的盈亏比计算，不要提前改仓位。',
      category: '入场规则',
    },
    {
      id: 3,
      title: '止损必须执行',
      description: '一旦触发预设止损，必须立即执行，不要有任何心理活动和犹豫。止损是对过去判断错误的认可，也是保护后续资金的必要措施。',
      category: '止损纪律',
    },
    {
      id: 4,
      title: '不要追高买入',
      description: '标的物价格已经大幅上涨后，不要再追高买入。应该等待技术性回调后再考虑建仓。',
      category: '入场规则',
    },
    {
      id: 5,
      title: '仓位计算先于入场',
      description: '在任何情况下，必须先计算仓位大小，再执行入场。不要先入场再想仓位。',
      category: '风险管理',
    },
  ];

  const [disciplines, setDisciplines] = useState(defaultDisciplines);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState(null);

  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleEdit = (record) => {
    setEditingId(record.id);
    form.setFieldsValue({
      title: record.title,
      description: record.description,
      category: record.category,
    });
    setIsModalVisible(true);
  };

  const handleDelete = (id) => {
    setDisciplines(disciplines.filter(d => d.id !== id));
  };

  const handleModalOk = () => {
    form.validateFields().then(values => {
      if (editingId) {
        setDisciplines(
          disciplines.map(d =>
            d.id === editingId ? { ...d, ...values } : d
          )
        );
      } else {
        setDisciplines([
          ...disciplines,
          {
            id: Math.max(...disciplines.map(d => d.id), 0) + 1,
            ...values,
          },
        ]);
      }
      setIsModalVisible(false);
      form.resetFields();
    });
  };

  const categories = [...new Set(disciplines.map(d => d.category))];

  return (
    <Card>
      <Typography>
        <Title level={2}>交易纪律</Title>
        <Paragraph type="secondary">
          记录在频繁交易中容易忘记或犯的错误，作为交易前的提醒清单
        </Paragraph>

        <Divider />

        <Paragraph type="warning" style={{ padding: '12px', background: '#fffbe6', borderRadius: 4 }}>
          <Text strong>💡 提示：</Text>
          <br />
          这份纪律是在实际交易中不断积累的经验教训。每次犯错后，都应该更新这份清单。交易前阅读一遍，可以显著降低重复犯错的概率。
        </Paragraph>

        <Divider />

        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加纪律
          </Button>
        </div>

        {categories.map(category => (
          <div key={category} style={{ marginBottom: 24 }}>
            <Title level={3} style={{ color: '#1890ff' }}>
              {category}
            </Title>
            <List
              dataSource={disciplines.filter(d => d.category === category)}
              renderItem={item => (
                <List.Item
                  key={item.id}
                  extra={
                    <Space>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(item)}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(item.id)}
                      />
                    </Space>
                  }
                >
                  <List.Item.Meta
                    title={
                      <Text strong style={{ fontSize: 14 }}>
                        {item.title}
                      </Text>
                    }
                    description={
                      <Paragraph style={{ marginTop: 8, marginBottom: 0, color: '#666' }}>
                        {item.description}
                      </Paragraph>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        ))}
      </Typography>

      <Modal
        title={editingId ? '编辑纪律' : '添加交易纪律'}
        open={isModalVisible}
        onOk={handleModalOk}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="纪律标题"
            rules={[{ required: true, message: '请输入纪律标题' }]}
          >
            <Input placeholder="例：插针当天不重新进场" />
          </Form.Item>
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请输入分类' }]}
          >
            <Input placeholder="例：风险管理、入场规则、止损纪律" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
            rules={[{ required: true, message: '请输入纪律描述' }]}
          >
            <Input.TextArea
              rows={6}
              placeholder="详细描述这条纪律的含义和重要性"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default TradingDiscipline;
