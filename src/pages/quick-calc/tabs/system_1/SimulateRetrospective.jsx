import React, { useState } from 'react';
import { Tag } from 'antd';
import Phase1 from '../../system_1/simulate-retrospective/Phase1';

const phases = [
  {
    key: 'phase1',
    title: '第一阶段',
    subtitle: '10/10 笔',
    date: '2026-04-12',
    tag: { label: '已完成', color: 'green' },
    component: <Phase1 />,
  },
];

const SimulateRetrospective = () => {
  const [active, setActive] = useState('phase1');
  const current = phases.find(p => p.key === active);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ width: 160, flexShrink: 0 }}>
        {phases.map(p => (
          <div
            key={p.key}
            onClick={() => setActive(p.key)}
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              marginBottom: 6,
              background: active === p.key ? '#e6f7ff' : '#fafafa',
              border: `1px solid ${active === p.key ? '#91d5ff' : '#f0f0f0'}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{p.title}</div>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 5 }}>
              {p.subtitle} · {p.date}
            </div>
            <Tag color={p.tag.color} style={{ fontSize: 11, padding: '0 5px', lineHeight: '18px' }}>
              {p.tag.label}
            </Tag>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{current?.title}模拟盘复盘</span>
          <span style={{ fontSize: 12, color: '#999', marginLeft: 10 }}>{current?.date}</span>
        </div>
        {current?.component}
      </div>
    </div>
  );
};

export default SimulateRetrospective;
