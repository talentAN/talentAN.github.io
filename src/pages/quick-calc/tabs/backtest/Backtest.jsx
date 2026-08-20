import React, { useState } from 'react';
import { Card } from 'antd';
import Rise100Backtest from './Rise100Backtest';
import LadderBacktest from './LadderBacktest';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const TABS = [
  { key: 'rise100', label: '涨幅100%回测' },
  { key: 'ladder', label: '阶梯开仓回测' },
  { key: 'pending-3', label: '回测3（待定）', disabled: true },
  { key: 'pending-4', label: '回测4（待定）', disabled: true },
  { key: 'pending-5', label: '回测5（待定）', disabled: true },
];

const Backtest = () => {
  const [activeKey, setActiveKey] = useState('rise100');

  return (
    <Card bodyStyle={{ padding: '10px 12px 12px' }}>
      <div className={s.panel}>
        <div className={s.pillGroup}>
          {TABS.map(tab => (
            <span
              key={tab.key}
              onClick={() => !tab.disabled && setActiveKey(tab.key)}
              className={cx(
                s.pill,
                activeKey === tab.key && s.pillActive,
                tab.disabled && s.pillDisabled
              )}
            >
              {tab.label}
            </span>
          ))}
        </div>

        {activeKey === 'rise100' && <Rise100Backtest />}
        {activeKey === 'ladder' && <LadderBacktest />}
        {activeKey.startsWith('pending') && <div className={s.empty}>规则待定义</div>}
      </div>
    </Card>
  );
};

export default Backtest;
