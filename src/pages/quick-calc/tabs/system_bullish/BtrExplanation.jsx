import React from 'react';
import { Typography, Tag } from 'antd';
import { UNIVERSE_V01, SUCCESS_V01 } from './_patternV01';

const { Title, Paragraph, Text } = Typography;
const pct = value => `${(value * 100).toFixed(0)}%`;

/**
 * 旧 BTR 状态机 explanation 已废弃（依赖已删除的 explanation.json）。
 * 做多系统改为：宇宙 + 成功事件 → 再归纳模式。本页仅作占位说明。
 */
const BtrExplanation = () => (
  <div style={{ padding: '8px 4px 24px', maxWidth: 720 }}>
    <Title level={4} style={{ marginTop: 0 }}>走势解释</Title>
    <Paragraph>
      <Tag color="default">已停用</Tag>
      旧版 BTRUSDT 日线状态机（依赖本地 explanation.json）已移除，不再作为做多系统依据。
    </Paragraph>
    <Paragraph type="secondary">
      当前研究框架见「看多规则」：
      <Text code>{UNIVERSE_V01.version}</Text>
      {' · '}
      <Text code>{SUCCESS_V01.version}</Text>
      （主口径：判定日后 {SUCCESS_V01.primaryHorizon} 日最高价相对收盘 ≥ {pct(SUCCESS_V01.primaryThreshold)}）。
    </Paragraph>
    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
      下一步：按冻结口径扫描成功事件池并归纳分型；本页将改为事件/分型浏览，而不是单样本状态机。
    </Paragraph>
  </div>
);

export default BtrExplanation;
