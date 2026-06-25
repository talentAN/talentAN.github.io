import React, { useState } from 'react';
import { Tabs, Tag, Typography } from 'antd';

const { Text } = Typography;

// ── 规则数据 ──────────────────────────────────────────────────────────
// status: 'active' | 'deprecated'
// history[].type: 'added' | 'modified' | 'deprecated'
const RULES = [
  // ── 标的筛选 ──────────────────────────────────────────────
  {
    id: 'S01',
    category: '标的筛选',
    content: '只做市值排名 100 名以外的币种',
    status: 'active',
    addedAt: '2026-06-24',
    sources: ['系统讨论·历史93笔交易分析'],
    history: [
      {
        date: '2026-06-24',
        type: 'added',
        note: '历史12笔交易均为市值100名外的币，作为有效的隐性过滤器，现显式写入。市值100名内遭遇基本面驱动行情（B类风险）的概率显著更高。',
      },
    ],
  },

  // ── 入场条件 ──────────────────────────────────────────────
  {
    id: 'E01',
    category: '入场条件',
    content: '只基于已收盘的 K 线判断入场，不看未收盘的盘中信号',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [
      { date: '2026-04', type: 'added', note: '基础规则，防止被未收盘的盘中波动干扰判断。' },
    ],
  },
  {
    id: 'E02',
    category: '入场条件',
    content: '暴涨后连续缩量横盘 ≥ 2 天，最早第 3 天才可考虑入场；第 2 天任何形态均不构成入场理由',
    status: 'active',
    addedAt: '2026-04-16',
    highlight: true,
    sources: ['第一阶段复盘·BOBUSDT', '第一阶段复盘·SKYAIUSDT', '复盘·SYNUSDT·260623'],
    history: [
      { date: '2026-04', type: 'added', note: '初始版本：缩量至少 2 天以上。' },
      {
        date: '2026-04-16',
        type: 'modified',
        note: '第一阶段复盘：BOBUSDT、SKYAIUSDT 均因横盘不充分过早入场导致亏损，改为至少 3 天。',
      },
    ],
  },
  {
    id: 'E03',
    category: '入场条件',
    content: '暴涨后 7 天内未出现确认信号，从观察列表移除',
    status: 'deprecated',
    addedAt: '2026-04-16',
    sources: ['第一阶段复盘·系统规则'],
    history: [
      {
        date: '2026-04-16',
        type: 'added',
        note: '超过 7 天的横盘性质已改变，从"衰竭"变为"平台蓄力"，属于另一套系统逻辑。',
      },
      {
        date: '2026-06-25',
        type: 'deprecated',
        note: '系统2的币对筛选功能已完善，可实时扫描全市场，不再需要人工维护观察列表，该规则失去适用场景，废弃。',
      },
    ],
  },
  {
    id: 'E04',
    category: '入场条件',
    content: '检查失效价（横盘区间上沿）：次日价格已突破失效价则放弃该笔交易',
    status: 'active',
    addedAt: '2026-04-16',
    sources: ['第一阶段复盘·系统规则'],
    history: [
      { date: '2026-04-16', type: 'added', note: '确保入场时信号仍然有效，避免追入已失效的形态。' },
    ],
  },
  {
    id: 'E05',
    category: '入场条件',
    content: '价格处于历史高位（无阻力锚点）时不入场',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则', '第一阶段复盘·SKYAIUSDT'],
    history: [
      { date: '2026-04', type: 'added', note: '历史高位无阻力，止损缺乏技术参考。' },
      {
        date: '2026-04-16',
        type: 'modified',
        note: 'SKYAIUSDT 在历史高位入场，爆拉 60% 被止损，强化该规则，从"慎入"改为"不入场"。',
      },
    ],
  },
  {
    id: 'E06',
    category: '入场条件',
    content: '先确定止损点位，再根据止损幅度计算仓位；永远不要先入场再想止损',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [{ date: '2026-04', type: 'added', note: '基础风控原则。' }],
  },
  {
    id: 'E07',
    category: '入场条件',
    content: '入场前确认盈亏比 ≥ 1:2，低于此比例不交易',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [{ date: '2026-04', type: 'added', note: '保证每笔交易的正期望值。' }],
  },

  // ── 止损管理 ──────────────────────────────────────────────
  {
    id: 'SL01',
    category: '止损管理',
    content: '止损必须设在横盘区间上沿或确认 K 线最高价以上，不能设在前高以下',
    status: 'active',
    addedAt: '2026-04-16',
    sources: ['第一阶段复盘·BOBUSDT'],
    history: [
      {
        date: '2026-04-16',
        type: 'added',
        note: 'BOBUSDT 止损设在前高以下，被精确触发后价格回归，是明确的执行失误。',
      },
    ],
  },
  {
    id: 'SL02',
    category: '止损管理',
    content: '触发止损后立即执行，不犹豫、不等待、不扛单',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [
      { date: '2026-04', type: 'added', note: '基础执行纪律，止损是对过去判断错误的承认。' },
    ],
  },

  // ── 仓位管理 ──────────────────────────────────────────────
  {
    id: 'P01',
    category: '仓位管理',
    content: '单笔风险不超过总资金 2%（1R = 10U）',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [{ date: '2026-04', type: 'added', note: '基础仓位管理规则，控制单次最大亏损。' }],
  },
  {
    id: 'P02',
    category: '仓位管理',
    content: '浮亏仓位不加仓；只有仓位浮盈且止损已上移至保本位以上时，才允许加仓',
    status: 'deprecated',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [
      { date: '2026-04', type: 'added', note: '"摊低成本"是亏损交易者最常见的错误，明确禁止。' },
      {
        date: '2026-06-25',
        type: 'deprecated',
        note: '当前系统只做做空，做空方向没有加仓一说，该规则不适用，废弃。',
      },
    ],
  },

  // ── 出场管理 ──────────────────────────────────────────────
  {
    id: 'X01',
    category: '出场管理',
    content:
      '识别入场信号可能失效时（形态变化 / BTC 同日明显反向强势），主动防御性平仓，不需要等到止损触发',
    status: 'active',
    addedAt: '2026-06-24',
    sources: ['第二阶段复盘·IRYSUSDT', '系统讨论'],
    history: [
      {
        date: '2026-06-24',
        type: 'added',
        note: 'IRYSUSDT 入场后识别信号失效，防御性平仓执行正确。防御性平仓与止损的区别：前者是主动判断退出，不需要价格触及止损线。',
      },
    ],
  },
  {
    id: 'X02',
    category: '出场管理',
    content: '时间止损：持仓超过 60-70 天，无论盈亏强制平仓；超过 50 天且浮亏仍在扩大，开始减仓',
    status: 'active',
    addedAt: '2026-06-24',
    sources: ['系统讨论·历史扛单数据分析'],
    history: [
      {
        date: '2026-06-24',
        type: 'added',
        note: '历史扛单数据：最长成功扛单约 50 天。超过该周期仍未盈利认定为异常情况，强制退出。',
      },
    ],
  },
  {
    id: 'X03',
    category: '出场管理',
    content: '被插针止损当天不重新进场同一币对',
    status: 'active',
    addedAt: '2026-04',
    sources: ['基础系统规则'],
    history: [{ date: '2026-04', type: 'added', note: '给市场时间复原，次日评估形态后再决定。' }],
  },

  // ── 操作纪律 ──────────────────────────────────────────────
  {
    id: 'D01',
    category: '操作纪律',
    content:
      '睡前取消所有未成交的开仓委托单；次日 08:00（UTC+8，日线收盘后）重新评估，白天重新挂单',
    status: 'active',
    addedAt: '2026-04-16',
    sources: ['第一阶段复盘·BOBUSDT', '第一阶段复盘·SKYAIUSDT'],
    history: [
      {
        date: '2026-04-16',
        type: 'added',
        note: 'BOBUSDT、SKYAIUSDT 均为夜间委托成交，夜间流动性差、插针频繁，成交质量极低。',
      },
    ],
  },
];

// ── 分类配置 ─────────────────────────────────────────────────────────
const CATEGORIES = ['标的筛选', '入场条件', '止损管理', '仓位管理', '出场管理', '操作纪律'];

const CATEGORY_COLOR = {
  标的筛选: '#722ed1',
  入场条件: '#1677ff',
  止损管理: '#f5222d',
  仓位管理: '#fa8c16',
  出场管理: '#52c41a',
  操作纪律: '#13c2c2',
};

const CHANGE_TYPE_CONFIG = {
  added: { color: 'green', label: '新增' },
  modified: { color: 'orange', label: '修改' },
  deprecated: { color: 'red', label: '废弃' },
};

// ── Tab 1：当前规则 ───────────────────────────────────────────────────
const ActiveRules = () => (
  <div>
    {CATEGORIES.map(cat => {
      const catRules = RULES.filter(r => r.category === cat && r.status === 'active');
      if (!catRules.length) return null;
      return (
        <div key={cat} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: CATEGORY_COLOR[cat],
              borderLeft: `3px solid ${CATEGORY_COLOR[cat]}`,
              paddingLeft: 10,
              marginBottom: 12,
              letterSpacing: 1,
            }}
          >
            {cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {catRules.map(rule => (
              <div
                key={rule.id}
                style={{
                  background: rule.highlight ? '#fffbe6' : '#fafafa',
                  border: `1px solid ${rule.highlight ? '#ffe58f' : '#f0f0f0'}`,
                  borderLeft: rule.highlight ? '3px solid #fa8c16' : '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Text
                    type="secondary"
                    style={{ fontSize: 11, minWidth: 36, flexShrink: 0, paddingTop: 2 }}
                  >
                    {rule.id}
                  </Text>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <div
                        style={{ fontSize: 13, fontWeight: 500, color: '#262626', lineHeight: 1.7 }}
                      >
                        {rule.content}
                      </div>
                      {rule.highlight && (
                        <span
                          style={{
                            fontSize: 11,
                            color: '#fa8c16',
                            background: '#fff7e6',
                            border: '1px solid #ffd591',
                            borderRadius: 4,
                            padding: '0 5px',
                            lineHeight: '18px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          ⚠ 高频触发
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                        alignItems: 'center',
                      }}
                    >
                      {rule.sources.map(s => (
                        <Tag key={s} style={{ fontSize: 11, margin: 0 }}>
                          {s}
                        </Tag>
                      ))}
                      <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                        {rule.addedAt}
                      </Text>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

// ── Tab 2：变更历史 ───────────────────────────────────────────────────
const FILTER_OPTIONS = [
  { key: 'modified', label: '修改', color: 'orange' },
  { key: 'deprecated', label: '废弃', color: 'red' },
  { key: 'added', label: '新增', color: 'green' },
];

const DOT_COLOR = { green: '#52c41a', orange: '#fa8c16', red: '#ff4d4f' };

const ChangeHistory = () => {
  const [activeFilters, setActiveFilters] = useState(['modified', 'deprecated']);

  const allEvents = RULES.flatMap(rule =>
    rule.history.map(h => ({
      ...h,
      ruleId: rule.id,
      category: rule.category,
      ruleContent: rule.content,
    }))
  ).sort((a, b) => (a.date < b.date ? 1 : -1));

  const filtered =
    activeFilters.length === 0
      ? allEvents
      : allEvents.filter(ev => activeFilters.includes(ev.type));

  const toggle = key => {
    setActiveFilters(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  return (
    <div>
      {/* 过滤器 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          筛选：
        </Text>
        {FILTER_OPTIONS.map(opt => {
          const active = activeFilters.includes(opt.key);
          return (
            <div
              key={opt.key}
              onClick={() => toggle(opt.key)}
              style={{
                cursor: 'pointer',
                padding: '2px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 500,
                border: `1px solid ${DOT_COLOR[opt.color]}`,
                background: active ? DOT_COLOR[opt.color] : 'transparent',
                color: active ? '#fff' : DOT_COLOR[opt.color],
                userSelect: 'none',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}
              <span style={{ marginLeft: 4, opacity: 0.8 }}>
                {allEvents.filter(e => e.type === opt.key).length}
              </span>
            </div>
          );
        })}
        {activeFilters.length > 0 && (
          <Text
            type="secondary"
            style={{ fontSize: 12, cursor: 'pointer', marginLeft: 4 }}
            onClick={() => setActiveFilters([])}
          >
            全部
          </Text>
        )}
      </div>

      {/* 时间轴 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {filtered.length === 0 && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            暂无匹配记录
          </Text>
        )}
        {filtered.map((ev, idx) => {
          const cfg = CHANGE_TYPE_CONFIG[ev.type] || { color: 'gray', label: ev.type };
          const isLast = idx === filtered.length - 1;
          return (
            <div key={`${ev.ruleId}-${idx}`} style={{ display: 'flex', gap: 0 }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 24,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: DOT_COLOR[cfg.color] || '#999',
                    marginTop: 14,
                    flexShrink: 0,
                  }}
                />
                {!isLast && (
                  <div style={{ width: 2, flex: 1, background: '#e8e8e8', marginTop: 4 }} />
                )}
              </div>
              <div style={{ flex: 1, paddingLeft: 12, paddingBottom: isLast ? 0 : 20 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 11, display: 'block', marginBottom: 4, marginTop: 12 }}
                >
                  {ev.date}
                </Text>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    marginBottom: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <Tag color={cfg.color} style={{ margin: 0, fontSize: 11 }}>
                    {cfg.label}
                  </Tag>
                  <Tag
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: '#fff',
                      background: CATEGORY_COLOR[ev.category] || '#666',
                    }}
                  >
                    {ev.category}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {ev.ruleId}
                  </Text>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#262626',
                    marginBottom: 4,
                    fontWeight: 500,
                    lineHeight: 1.7,
                  }}
                >
                  {ev.ruleContent}
                </div>
                {ev.note && (
                  <div style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>{ev.note}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── 主组件 ───────────────────────────────────────────────────────────
const TradingDiscipline = () => {
  const [activeTab, setActiveTab] = useState('rules');

  const items = [
    {
      key: 'rules',
      label: `当前规则（${RULES.filter(r => r.status === 'active').length} 条）`,
      children: <ActiveRules />,
    },
    {
      key: 'history',
      label: '变更历史',
      children: <ChangeHistory />,
    },
  ];

  return (
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} style={{ minHeight: 400 }} />
  );
};

export default TradingDiscipline;
