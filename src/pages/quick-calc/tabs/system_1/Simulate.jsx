import React, { useState, useMemo } from 'react';
import { Table, Statistic, Row, Col, Button, Input, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import moment from 'moment';

const INIT_DATA = [];

const columns = [
  { title: '币对', dataIndex: 'symbol', key: 'symbol', width: 120 },
  { title: '入场日期', dataIndex: 'entryDate', key: 'entryDate', width: 110 },
  { title: '入场价', dataIndex: 'entryPrice', key: 'entryPrice', width: 100 },
  { title: '止损价', dataIndex: 'stopLoss', key: 'stopLoss', width: 100 },
  { title: '入场理由', dataIndex: 'entryReason', key: 'entryReason' },
  { title: '杠杆', dataIndex: 'leverage', key: 'leverage', width: 70 },
  { title: '保证金', dataIndex: 'margin', key: 'margin', width: 80 },
  { title: '出场价', dataIndex: 'exitPrice', key: 'exitPrice', width: 100 },
  {
    title: '结果（R）',
    dataIndex: 'result',
    key: 'result',
    width: 100,
    render: val =>
      val == null ? '-' : (
        <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {val > 0 ? `+${val}R` : `${val}R`}
        </span>
      ),
  },
  { title: '备注', dataIndex: 'remark', key: 'remark' },
];

const calcR = ({ entryPrice, exitPrice, leverage, margin }) => {
  const e = Number(entryPrice), x = Number(exitPrice), l = Number(leverage), m = Number(margin);
  if (!e || !x || !l || !m) return null;
  return +((e - x) / e * l * m / 10).toFixed(2);
};

const EMPTY_FORM = {
  symbol: '',
  entryDate: '',
  entryPrice: '',
  stopLoss: '',
  entryReason: '',
  leverage: '',
  margin: '',
  exitPrice: '',
  remark: '',
};

const Simulate = () => {
  const [dataSource, setDataSource] = useState(INIT_DATA);
  const [form, setForm] = useState(EMPTY_FORM);

  const { wins, losses, totalR, avgR } = useMemo(() => {
    const wins = dataSource.filter(d => d.result > 0).length;
    const losses = dataSource.filter(d => d.result < 0).length;
    const totalR = dataSource.reduce((sum, d) => sum + (Number(d.result) || 0), 0);
    const avgR = dataSource.length ? +(totalR / dataSource.length).toFixed(2) : 0;
    return { wins, losses, totalR: +totalR.toFixed(2), avgR };
  }, [dataSource]);

  const handleAdd = () => {
    if (!form.symbol.trim()) {
      message.warning('请输入币对名称');
      return;
    }
    const newRecord = {
      ...form,
      key: Date.now().toString(),
      symbol: form.symbol.trim().toUpperCase(),
      entryDate: form.entryDate || moment().format('YYYY-MM-DD'),
      result: calcR(form),
    };
    setDataSource([...dataSource, newRecord]);
    setForm(EMPTY_FORM);
    message.success('添加成功');
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(JSON.stringify(dataSource, null, 2))
      .then(() => message.success('已复制到剪贴板'))
      .catch(() => message.error('复制失败'));
  };

  const handleAutoFill = () => {
    navigator.clipboard.readText().then(text => {
      const match = text.match(/^simulate:([^,]+),([^,]+),([^,]+)$/);
      if (!match) {
        message.warning('剪贴板内容不是模拟数据，请先在仓位计算器点「模拟」');
        return;
      }
      setForm(f => ({ ...f, entryPrice: match[1], stopLoss: match[2], leverage: match[3] }));
      message.success('已自动填入入场价、止损价、杠杆');
    }).catch(() => message.error('读取剪贴板失败，请检查浏览器权限'));
  };

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <div>
      <Row gutter={32} style={{ marginBottom: 20 }}>
        <Col>
          <Statistic title="盈利笔数" value={wins} valueStyle={{ color: '#52c41a' }} />
        </Col>
        <Col>
          <Statistic title="亏损笔数" value={losses} valueStyle={{ color: '#ff4d4f' }} />
        </Col>
        <Col>
          <Statistic
            title="累计收益"
            value={`${totalR >= 0 ? '+' : ''}${totalR}R`}
            valueStyle={{ color: totalR >= 0 ? '#52c41a' : '#ff4d4f' }}
          />
        </Col>
        <Col>
          <Statistic
            title="平均收益/笔"
            value={dataSource.length ? `${avgR >= 0 ? '+' : ''}${avgR}R` : '-'}
            valueStyle={{ color: avgR >= 0 ? '#52c41a' : '#ff4d4f' }}
          />
        </Col>
      </Row>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input placeholder="币对" value={form.symbol} onChange={set('symbol')} style={{ width: 120 }} />
        <Input placeholder="入场日期" value={form.entryDate} onChange={set('entryDate')} style={{ width: 110 }} />
        <Input placeholder="入场价" value={form.entryPrice} onChange={set('entryPrice')} style={{ width: 90 }} />
        <Input placeholder="止损价" value={form.stopLoss} onChange={set('stopLoss')} style={{ width: 90 }} />
        <Input placeholder="入场理由" value={form.entryReason} onChange={set('entryReason')} style={{ width: 180 }} />
        <Input placeholder="杠杆" value={form.leverage} onChange={set('leverage')} style={{ width: 70 }} />
        <Input placeholder="保证金" value={form.margin} onChange={set('margin')} style={{ width: 80 }} />
        <Input placeholder="出场价" value={form.exitPrice} onChange={set('exitPrice')} style={{ width: 90 }} />
        <Input placeholder="备注" value={form.remark} onChange={set('remark')} style={{ width: 150 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加</Button>
        <Button onClick={handleAutoFill}>一键填写</Button>
        <Button onClick={handleCopy}>复制数据</Button>
      </div>

      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="key"
        pagination={false}
        size="small"
        locale={{ emptyText: '暂无模拟数据' }}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
};

export default Simulate;
