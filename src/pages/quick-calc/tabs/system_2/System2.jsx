import React from 'react';
import { Card, Menu, Typography } from 'antd';
import { navigate } from 'gatsby';
import PairSelector from './PairSelector';
import Watching from './Watching';

const { Text } = Typography;

const PATHS = {
  pairSelector: '/quick-calc/system_2/pair-selector',
  watching: '/quick-calc/system_2/watching',
  retrospective: '/quick-calc/system_2/retrospective',
  notes: '/quick-calc/system_2/notes',
};

// 路径按特异性从高到低排列，避免 startsWith 歧义
const PATH_ORDER = [PATHS.pairSelector, PATHS.retrospective, PATHS.watching, PATHS.notes];

const Placeholder = ({ label }) => (
  <div style={{ padding: '40px 0', textAlign: 'center' }}>
    <Text type="secondary">「{label}」建设中</Text>
  </div>
);

const System2 = ({ location }) => {
  const currentPath = (location?.pathname || PATHS.pairSelector).split('?')[0];
  const selectedKey = PATH_ORDER.find(p => currentPath.startsWith(p)) || PATHS.pairSelector;

  const menuItems = [
    { key: PATHS.pairSelector, label: '币对筛选' },
    { key: PATHS.watching, label: '观测中' },
    { key: PATHS.retrospective, label: '复盘' },
    { key: PATHS.notes, label: '笔记' },
  ];

  return (
    <Card>
      <Menu
        mode="horizontal"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ marginBottom: 16 }}
      />
      {selectedKey === PATHS.pairSelector && <PairSelector />}
      {selectedKey === PATHS.watching && <Watching />}
      {selectedKey === PATHS.retrospective && <Placeholder label="复盘" />}
      {selectedKey === PATHS.notes && <Placeholder label="笔记" />}
    </Card>
  );
};

export default System2;
