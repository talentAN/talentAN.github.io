import React from 'react';
import { Typography, Tag } from 'antd';

const { Text } = Typography;

// 章节标题
export const Section = ({ title, children }) => (
  <div style={{ marginBottom: 28 }}>
    <div style={{
      fontSize: 13,
      fontWeight: 600,
      color: '#1890ff',
      borderLeft: '3px solid #1890ff',
      paddingLeft: 10,
      marginBottom: 14,
      letterSpacing: 1,
    }}>
      {title}
    </div>
    {children}
  </div>
);

// 交易诊断卡片
const borderColor = { green: '#52c41a', orange: '#faad14', red: '#f5222d' };
export const TradeCard = ({ color = 'green', title, children }) => (
  <div style={{
    borderLeft: `3px solid ${borderColor[color]}`,
    background: color === 'green' ? '#f6ffed' : color === 'orange' ? '#fffbe6' : '#fff1f0',
    borderRadius: '0 6px 6px 0',
    padding: '12px 16px',
    marginBottom: 10,
  }}>
    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{title}</div>
    {children}
  </div>
);

// 标签行
export const Row = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: 13, lineHeight: 1.6 }}>
    <Text type="secondary" style={{ minWidth: 52, flexShrink: 0 }}>{label}</Text>
    <span>{children}</span>
  </div>
);

// 高亮提示块
export const Callout = ({ type = 'info', children }) => {
  const styles = {
    info:    { background: '#e6f7ff', borderColor: '#91d5ff', color: '#0050b3' },
    success: { background: '#f6ffed', borderColor: '#b7eb8f', color: '#135200' },
    warning: { background: '#fffbe6', borderColor: '#ffe58f', color: '#874d00' },
    danger:  { background: '#fff1f0', borderColor: '#ffa39e', color: '#820014' },
  };
  const s = styles[type];
  return (
    <div style={{
      ...s,
      border: `1px solid ${s.borderColor}`,
      borderRadius: 6,
      padding: '10px 14px',
      fontSize: 13,
      marginBottom: 10,
      lineHeight: 1.7,
    }}>
      {children}
    </div>
  );
};

// 代码块
export const CodeBlock = ({ children }) => (
  <pre style={{
    background: '#f5f5f5',
    border: '1px solid #e8e8e8',
    borderRadius: 4,
    padding: '10px 14px',
    fontSize: 12,
    lineHeight: 1.8,
    margin: '8px 0 0',
    whiteSpace: 'pre-wrap',
  }}>
    {children}
  </pre>
);

// 规则卡片
export const RuleCard = ({ no, title, children }) => (
  <div style={{
    background: '#fafafa',
    border: '1px solid #f0f0f0',
    borderRadius: 6,
    padding: '12px 16px',
    marginBottom: 8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>{no}</Tag>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
    </div>
    <div style={{ fontSize: 13, color: '#444', lineHeight: 1.7 }}>{children}</div>
  </div>
);

// 指标网格
export const MetricGrid = ({ items }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 10,
    marginBottom: 16,
  }}>
    {items.map((item, i) => (
      <div key={i} style={{
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: '10px 14px',
      }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{item.label}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: item.color || '#262626' }}>{item.value}</div>
      </div>
    ))}
  </div>
);
