import React, { useEffect } from 'react';
import { Card } from 'antd';
import { navigate } from 'gatsby';
import Rise100Backtest from './Rise100Backtest';
import LadderBacktest from './LadderBacktest';
import DayHighGain from './DayHighGain';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const BASE = '/quick-calc/backtest';
const PATHS = {
  rise100: `${BASE}/rise-100`,
  ladder: `${BASE}/ladder`,
  dayHighGain: `${BASE}/day-high-gain`,
};

const TABS = [
  { key: PATHS.rise100, label: '涨幅100%回测' },
  { key: PATHS.ladder, label: '阶梯开仓回测' },
  { key: PATHS.dayHighGain, label: 'data-单日最高涨幅' },
  { key: 'pending-4', label: '回测4（待定）', disabled: true },
  { key: 'pending-5', label: '回测5（待定）', disabled: true },
];

const ACTIVE_PATHS = [PATHS.rise100, PATHS.ladder, PATHS.dayHighGain];

const Backtest = ({ location }) => {
  const cleanPath = (location?.pathname || PATHS.rise100).split('?')[0];
  const selectedKey =
    ACTIVE_PATHS.find(path => cleanPath === path || cleanPath.startsWith(`${path}/`)) ||
    PATHS.rise100;

  useEffect(() => {
    if (cleanPath === BASE || cleanPath === `${BASE}/`) {
      navigate(PATHS.rise100);
    }
  }, [cleanPath]);

  return (
    <Card bodyStyle={{ padding: '10px 12px 12px' }}>
      <div className={s.panel}>
        <div className={s.pillGroup}>
          {TABS.map(tab => (
            <span
              key={tab.key}
              onClick={() => !tab.disabled && navigate(tab.key)}
              className={cx(
                s.pill,
                selectedKey === tab.key && s.pillActive,
                tab.disabled && s.pillDisabled
              )}
            >
              {tab.label}
            </span>
          ))}
        </div>

        {selectedKey === PATHS.rise100 && <Rise100Backtest />}
        {selectedKey === PATHS.ladder && <LadderBacktest />}
        {selectedKey === PATHS.dayHighGain && <DayHighGain />}
      </div>
    </Card>
  );
};

export default Backtest;
