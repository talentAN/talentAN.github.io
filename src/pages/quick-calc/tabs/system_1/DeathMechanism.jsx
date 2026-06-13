import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Checkbox, Tag, Typography, Divider, Alert, Space, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  WarningFilled,
  StopFilled,
  CloseCircleFilled,
  InfoCircleOutlined,
} from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

const STORAGE_KEY = 'death_mechanism_state';

const DIMENSIONS = [
  {
    id: 'external',
    label: '外部结构变化',
    typeLabel: '领先指标',
    typeColor: 'blue',
    desc: '交易所机制或市场结构发生根本性变化，系统赖以存在的前提消失',
    triggerRule: '任意 1 项触发即视为该维度异常',
    triggerThreshold: 1,
    indicators: [
      {
        id: 'exchange_rule_change',
        text: '交易所修改新币合约上线规则，影响可做空性（有明确公告）',
      },
      {
        id: 'no_spike_30d',
        text: '近 30 天内上线的新币，无一触发暴涨条件（单日涨幅 ≥30%）',
      },
      {
        id: 'no_short_available',
        text: '新币上线后无法正常建立空单（流动性枯竭 / 平台限制）',
      },
    ],
  },
  {
    id: 'hypothesis',
    label: '假设链失效',
    typeLabel: '同步指标',
    typeColor: 'orange',
    desc: '暴涨→缩量→回归的核心现象不再可靠出现，系统底层逻辑被市场证伪',
    triggerRule: '任意 2 项触发即视为该维度异常',
    triggerThreshold: 2,
    indicators: [
      {
        id: 'no_regression_rate',
        text: '近 3 个月观测池中，满足 Phase 1+2 条件的标的，最终未回归比例 ≥ 50%',
      },
      {
        id: 'consecutive_sl',
        text: '连续 5 笔系统内合规交易开仓后，价格即反向运动触及止损',
      },
      {
        id: 'breakout_dominant',
        text: '缩量大阳线后继续突破高位（而非回落）的比例 ≥ 入场机会的 50%',
      },
    ],
  },
  {
    id: 'performance',
    label: '绩效表现',
    typeLabel: '滞后指标',
    typeColor: 'red',
    desc: '系统在实际交易中已失效，绩效数据证明不再产生正期望',
    triggerRule: '任意 1 项触发即视为该维度异常',
    triggerThreshold: 1,
    indicators: [
      {
        id: 'consecutive_loss_5',
        text: '连续亏损 ≥ 5 笔（均为系统内合规交易，非违规操作）',
      },
      {
        id: 'rolling_negative',
        text: '滚动最近 10 笔合规交易，整体期望值 ≤ 0',
      },
      {
        id: 'drawdown_20r',
        text: '系统运行以来累计资金回撤 ≥ 20R',
      },
    ],
  },
];

const LEVELS = [
  {
    count: 0,
    label: '正常运行',
    icon: <CheckCircleFilled style={{ fontSize: 20 }} />,
    color: '#52c41a',
    bg: '#f6ffed',
    border: '#b7eb8f',
    action: '按系统正常交易，保持既定仓位规模和入场标准。',
  },
  {
    count: 1,
    label: '观察期',
    icon: <WarningFilled style={{ fontSize: 20 }} />,
    color: '#faad14',
    bg: '#fffbe6',
    border: '#ffe58f',
    action:
      '降低单笔仓位（减半），同时提高入场门槛（需同时出现两种以上信号）。持续跟踪异常维度，30 天后重新评估。',
  },
  {
    count: 2,
    label: '暂停期',
    icon: <StopFilled style={{ fontSize: 20 }} />,
    color: '#fa8c16',
    bg: '#fff7e6',
    border: '#ffd591',
    action:
      '立即停止新开仓。已有仓位按既定出场规则正常管理，不追加。暂停期间专注记录和复盘，30 天后重新评估是否恢复。',
  },
  {
    count: 3,
    label: '系统死亡',
    icon: <CloseCircleFilled style={{ fontSize: 20 }} />,
    color: '#ff4d4f',
    bg: '#fff2f0',
    border: '#ffccc7',
    action:
      '停止使用本系统。复盘三个维度同时触发的根本原因，判断是市场结构永久改变还是阶段性失效，评估是否重建。',
  },
];

const DeathMechanism = () => {
  const [checked, setChecked] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  }, [checked]);

  const toggleIndicator = id => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getDimensionStatus = dim => {
    const triggeredCount = dim.indicators.filter(ind => checked[ind.id]).length;
    return {
      triggeredCount,
      isTriggered: triggeredCount >= dim.triggerThreshold,
    };
  };

  const triggeredDimensions = DIMENSIONS.filter(dim => getDimensionStatus(dim).isTriggered).length;

  const level = LEVELS[triggeredDimensions];

  return (
    <div style={{ maxWidth: 900 }}>
      {/* 系统状态 */}
      <div
        style={{
          background: level.bg,
          border: `1px solid ${level.border}`,
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <div style={{ color: level.color, marginTop: 2 }}>{level.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Text strong style={{ fontSize: 16, color: level.color }}>
              {level.label}
            </Text>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {triggeredDimensions} / 3 个维度异常
            </Text>
          </div>
          <Text style={{ fontSize: 13, color: '#595959' }}>{level.action}</Text>
        </div>
      </div>

      {/* 三个维度 */}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {DIMENSIONS.map(dim => {
          const { triggeredCount, isTriggered } = getDimensionStatus(dim);
          return (
            <Card
              key={dim.id}
              size="small"
              style={{
                borderColor: isTriggered ? '#ff4d4f' : '#d9d9d9',
                background: isTriggered ? '#fff2f0' : '#fff',
              }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Text strong style={{ fontSize: 14 }}>
                    {dim.label}
                  </Text>
                  <Tag color={dim.typeColor} style={{ margin: 0 }}>
                    {dim.typeLabel}
                  </Tag>
                  {isTriggered ? (
                    <Tag color="red" style={{ margin: 0 }}>
                      异常
                    </Tag>
                  ) : (
                    <Tag color="green" style={{ margin: 0 }}>
                      正常
                    </Tag>
                  )}
                  <Tooltip title={dim.triggerRule}>
                    <InfoCircleOutlined style={{ color: '#8c8c8c', cursor: 'help' }} />
                  </Tooltip>
                </div>
              }
            >
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                {dim.desc}
              </Text>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {dim.indicators.map(ind => (
                  <div
                    key={ind.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '8px 12px',
                      background: checked[ind.id] ? '#fff1f0' : '#fafafa',
                      borderRadius: 6,
                      border: `1px solid ${checked[ind.id] ? '#ffa39e' : '#f0f0f0'}`,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleIndicator(ind.id)}
                  >
                    <Checkbox
                      checked={!!checked[ind.id]}
                      onChange={() => toggleIndicator(ind.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ marginTop: 1 }}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        flex: 1,
                        color: checked[ind.id] ? '#cf1322' : '#262626',
                      }}
                    >
                      {ind.text}
                    </Text>
                  </div>
                ))}
              </Space>
              <div style={{ marginTop: 10, textAlign: 'right' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  已触发 {triggeredCount} / {dim.indicators.length} 项
                  {dim.triggerThreshold > 1 && `（需 ≥${dim.triggerThreshold} 项）`}
                </Text>
              </div>
            </Card>
          );
        })}
      </Space>

      {/* 说明 */}
      <Divider />
      <div style={{ background: '#fafafa', borderRadius: 6, padding: '12px 16px' }}>
        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          分级响应逻辑
        </Text>
        <Space direction="vertical" size={4}>
          {LEVELS.map(l => (
            <div key={l.count} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: l.color, fontWeight: 600, minWidth: 18, textAlign: 'right' }}>
                {l.count}
              </span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                个维度异常 →
              </Text>
              <Text strong style={{ fontSize: 12, color: l.color }}>
                {l.label}
              </Text>
            </div>
          ))}
        </Space>
      </div>
    </div>
  );
};

export default DeathMechanism;
