import React, { useEffect } from 'react';
import { Card } from 'antd';
import { navigate } from 'gatsby';
import Rise100Backtest from './Rise100Backtest';
import LadderBacktest from './LadderBacktest';
import DayHighGain from './DayHighGain';
import After100Gain from './After100Gain';
import GentleRiseBacktest from './GentleRiseBacktest';
import LowVolRangeBlastBacktest from './LowVolRangeBlastBacktest';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const BASE = '/quick-calc/backtest';
const PATHS = {
  rise100: `${BASE}/rise-100`,
  ladder: `${BASE}/ladder`,
  dayHighGain: `${BASE}/day-high-gain`,
  after100Gain: `${BASE}/after-100-gain`,
  gentleRise: `${BASE}/gentle-rise`,
  lowVolRangeBlast: `${BASE}/low-vol-range-blast`,
};

const TABS = [
  { key: PATHS.rise100, label: '涨幅100%回测' },
  { key: PATHS.ladder, label: '阶梯开仓回测' },
  { key: PATHS.dayHighGain, label: 'data-单日最高涨幅' },
  { key: PATHS.after100Gain, label: 'data-涨幅100后' },
  { key: PATHS.gentleRise, label: '缓坡上行' },
  { key: PATHS.lowVolRangeBlast, label: '低波动横盘暴涨' },
];

const ACTIVE_PATHS = [
  PATHS.rise100,
  PATHS.ladder,
  PATHS.dayHighGain,
  PATHS.after100Gain,
  PATHS.gentleRise,
  PATHS.lowVolRangeBlast,
];

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
        {selectedKey === PATHS.after100Gain && <After100Gain />}
        {selectedKey === PATHS.gentleRise && <GentleRiseBacktest location={location} />}
        {selectedKey === PATHS.lowVolRangeBlast && <LowVolRangeBlastBacktest />}
      </div>
    </Card>
  );
};

export default Backtest;
