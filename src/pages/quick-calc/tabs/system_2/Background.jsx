import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const Title = ({ children }) => (
  <div
    style={{
      fontSize: 13,
      fontWeight: 700,
      color: '#262626',
      borderLeft: '3px solid #1677ff',
      paddingLeft: 10,
      marginBottom: 14,
    }}
  >
    {children}
  </div>
);

const Chain = ({ steps }) => (
  <div style={{ marginBottom: 8 }}>
    {steps.map((step, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div
          style={{
            background: step.highlight ? '#e6f7ff' : '#fafafa',
            border: `1px solid ${step.highlight ? '#91d5ff' : '#e8e8e8'}`,
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 13,
            color: step.highlight ? '#003a8c' : '#434343',
            lineHeight: 1.7,
            maxWidth: 560,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {step.label && (
            <span style={{ fontWeight: 600, color: '#8c8c8c', fontSize: 11, marginRight: 6 }}>
              {step.label}
            </span>
          )}
          <span>{step.text}</span>
          {step.tooltip && (
            <Tooltip title={step.tooltip} placement="right" overlayStyle={{ maxWidth: 360 }}>
              <InfoCircleOutlined style={{ color: '#bfbfbf', cursor: 'pointer', fontSize: 12 }} />
            </Tooltip>
          )}
        </div>
        {i < steps.length - 1 && (
          <div style={{ paddingLeft: 20, color: '#bfbfbf', fontSize: 16, lineHeight: '22px' }}>
            ↓
          </div>
        )}
      </div>
    ))}
  </div>
);

const Background = () => (
  <div style={{ maxWidth: 640, padding: '4px 0' }}>
    {/* 系统定位 */}
    <div
      style={{
        background: 'linear-gradient(135deg, #f0f5ff 0%, #e6fffb 100%)',
        border: '1px solid #adc6ff',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 28,
        fontSize: 12,
        color: '#0050b3',
      }}
    >
      做多系统 · 重仓 · 基本面驱动 · K 线辅助入场时机
    </div>

    {/* 逻辑链一：我为什么要这样做 */}
    <div style={{ marginBottom: 32 }}>
      <Title>一、我为什么要这样做（推导路径）</Title>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 14 }}>
        这是我发现这套方法的思路，解释了「为什么重仓」「为什么研究基本面」。
      </div>
      <Chain
        steps={[
          { text: '做空系统 = 轻仓 + K 线择时 + 快跑 → 实测资金增速慢' },
          { text: '要实现更快增长，需要更大的仓位规模' },
          {
            text: '我选择重仓这条路——不是唯一的路，是我的选择',
            tooltip: (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>其他路径及为什么不选：</div>
                <div>
                  · <b>提高单笔回报率</b>（优化判断质量）→ 有天花板，不可能100%对
                </div>
                <div>
                  · <b>提高交易频率</b>（找更多机会）→ 受市场控制，强行提高=降低标准
                </div>
                <div>
                  · <b>复利</b>（仓位随本金增长）→ 确定但太慢，做空系统已包含此逻辑
                </div>
                <div>
                  · <b>杠杆</b>（合约放大）→ 本质还是扩大仓位，多一层爆仓风险
                </div>
                <div style={{ marginTop: 6, color: '#8c8c8c', fontStyle: 'italic' }}>
                  结论：轻仓模式的上限就是慢，要突破量级只能换仓位的量级。
                  主动选择上限更高但犯错代价也更高的路。
                </div>
              </div>
            ),
          },
          { text: '基本面负责判断「能不能进」——这东西到底值不值这个钱' },
          {
            text: '所以需要基本面支撑：只有相信自己清楚它值多少钱，才敢在下跌时拿住',
            highlight: true,
          },
          {
            text: '但要清醒：基本面判断可能出错。错了必须认，不能靠「相信」硬扛',
            highlight: true,
          },
          {
            text: 'K 线只负责判断「什么时候进」——两件事不能混淆',
            tooltip: (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>不在框架内的指标：</div>
                <div>
                  · <b>挖矿成本</b>：「成本撑住价格」因果反了。价格跌 → 高成本矿机关机 → 难度调整 →
                  存活矿工成本自动降低。成本是价格的跟随者，不是支撑。
                </div>
                <div style={{ marginTop: 6 }}>
                  · <b>链上数据</b>
                  （交易所流入流出、巨鲸动向等）：本质是市场行为指标，告诉你别人在干什么，不是这东西值多少钱。同一数据可以看涨也可以看跌，是不了解的噪音源。
                </div>
                <div style={{ marginTop: 6, color: '#8c8c8c', fontStyle: 'italic' }}>
                  结论：框架只需要两样——独立思考的基本面判断 +
                  客观独立的K线择时。不了解的东西不放进决策链路。
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>

    {/* 逻辑链二：应有的执行顺序 */}
    <div style={{ marginBottom: 32 }}>
      <Title>二、应有的执行顺序（操作规程）</Title>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 14 }}>
        这是执行时的正确顺序。推导路径是从结果往回找原因，执行顺序必须反过来。
      </div>
      <Chain
        steps={[
          {
            label: 'Step 1',
            text: '确认 BTC / ETH 的基本面价值主张成立 → 同时明确：什么事发生 = 主张不成立（反面问）',
          },
          {
            label: 'Step 2',
            text: '确认安全边际够大 → 当前价格在历史中处于什么位置？即使跌到让自己肉疼的位置，还能平静拿住吗？',
            tooltip: (
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>安全边际不是在算它值多少钱：</div>
                <div>
                  · <b>价格维度</b>：不看「应该值多少」，看「已经跌了多少」。跌 60% 比跌 20%
                  安全边际大，这是事实不是预测。
                </div>
                <div style={{ marginTop: 6 }}>
                  · <b>承受维度</b>：即使跌到让你肉疼的位置，仍能平静拿住 → 安全边际够；会焦虑 →
                  要么仓位太大，要么价格不够低。
                </div>
                <div style={{ marginTop: 6 }}>
                  · <b>最差情景</b>：仓位不会毁掉你，即使判断全错。
                </div>
                <div style={{ marginTop: 6, color: '#8c8c8c', fontStyle: 'italic' }}>
                  不设固定百分比。肉疼的位置只有自己知道。
                </div>
              </div>
            ),
          },
          {
            label: 'Step 3',
            text: '两步都通过 → 确定仓位上限（对最坏情况的容忍度），值得重仓做多',
            highlight: true,
          },
          {
            label: 'Step 4',
            text: 'K 线确认入场时机——趋势明显企稳后逐步建仓。战术层，不影响能否进的决定',
          },
        ]}
      />
      <div
        style={{
          background: '#fff7e6',
          border: '1px solid #ffd591',
          borderRadius: 6,
          padding: '10px 14px',
          marginTop: 8,
          fontSize: 12,
          color: '#874d00',
        }}
      >
        ⚠ 不能因为「做多系统预设了重仓」，就在基本面分析含糊时也往里冲。
        分析结论不够硬就不进，或轻仓观察。
      </div>
      <div
        style={{
          background: '#fff1f0',
          border: '1px solid #ffa39e',
          borderRadius: 6,
          padding: '10px 14px',
          marginTop: 8,
          fontSize: 12,
          color: '#a8071a',
        }}
      >
        🛑 持仓铁律：价值主张不变 → 拿住，不管账面浮亏；价值主张被证伪 → 无条件退出，不管账面盈亏。
      </div>
    </div>

    {/* 与做空系统对比 */}
    <div>
      <Title>三、与做空系统的对比</Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div
          style={{
            background: '#fff1f0',
            border: '1px solid #ffa39e',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 12,
            color: '#434343',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#cf1322' }}>
            做空系统（系统一）
          </div>
          <div>仓位：轻仓（总资金 2% 以内）</div>
          <div>依据：K 线形态 + 缩量横盘信号</div>
          <div>持仓：短期，触发止损即出</div>
          <div>目标：稳定累积，控制单笔风险</div>
        </div>
        <div
          style={{
            background: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 12,
            color: '#434343',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#1d39c4' }}>
            做多系统（系统二）
          </div>
          <div>仓位：重仓（待定义上限）</div>
          <div>依据：基本面价值 + 估值判断</div>
          <div>持仓：中长期，价值不变则拿住</div>
          <div>目标：资金量级跨越</div>
        </div>
      </div>
    </div>
  </div>
);

export default Background;
