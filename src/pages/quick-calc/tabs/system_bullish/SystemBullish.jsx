import React, { useEffect } from 'react';
import { Card, Typography } from 'antd';
import { navigate } from 'gatsby';
import Archetypes from './Archetypes';
import BtrExplanation from './BtrExplanation';
import CurrentFilter from './CurrentFilter';
import Rules from './Rules';
import SlopePositive from './SlopePositive';
import Soil from './Soil';
import * as s from '../system_1/pairSelector.module.less';

const { Text } = Typography;
const cx = (...names) => names.filter(Boolean).join(' ');

const BASE = '/quick-calc/system_bullish';
const PATHS = {
  rules: `${BASE}/rules`,
  soil: `${BASE}/soil`,
  archetypes: `${BASE}/archetypes`,
  filter: `${BASE}/filter`,
  slope: `${BASE}/slope`,
  explanation: `${BASE}/explanation`,
};

const TABS = [
  { key: PATHS.rules, label: '看多规则' },
  { key: PATHS.soil, label: '土壤观察' },
  { key: PATHS.archetypes, label: '候选分型' },
  { key: PATHS.filter, label: '当前筛选' },
  { key: PATHS.slope, label: '斜率正' },
  { key: PATHS.explanation, label: '走势解释' },
];

const ORDER = TABS.map(tab => tab.key);

const SystemBullish = ({ location }) => {
  const currentPath = (location?.pathname || PATHS.rules).split('?')[0];
  const selectedKey = ORDER.find(path => currentPath.startsWith(path)) || PATHS.rules;

  useEffect(() => {
    if (currentPath === BASE || currentPath === `${BASE}/`) {
      navigate(PATHS.rules);
    }
  }, [currentPath]);

  let body = (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Text type="secondary">
        「{TABS.find(item => item.key === selectedKey)?.label}」建设中
      </Text>
    </div>
  );
  if (selectedKey === PATHS.rules) body = <Rules />;
  else if (selectedKey === PATHS.soil) body = <Soil />;
  else if (selectedKey === PATHS.archetypes) body = <Archetypes />;
  else if (selectedKey === PATHS.filter) body = <CurrentFilter />;
  else if (selectedKey === PATHS.slope) body = <SlopePositive />;
  else if (selectedKey === PATHS.explanation) body = <BtrExplanation />;

  return (
    <Card bodyStyle={{ padding: '10px 12px 12px' }}>
      <div className={s.panel}>
        <div className={s.toolbar} style={{ marginBottom: 10 }}>
          <div className={s.pillGroup}>
            {TABS.map(tab => (
              <span
                key={tab.key}
                onClick={() => navigate(tab.key)}
                className={cx(s.pill, selectedKey === tab.key && s.pillActive)}
              >
                {tab.label}
              </span>
            ))}
          </div>
        </div>
        {body}
      </div>
    </Card>
  );
};

export default SystemBullish;
