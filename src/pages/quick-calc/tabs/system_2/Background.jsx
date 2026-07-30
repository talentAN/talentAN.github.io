import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const Title = ({ children }) => (
  <div style={{
    fontSize: 13, fontWeight: 700, color: '#262626',
    borderLeft: '3px solid #1677ff', paddingLeft: 10, marginBottom: 14,
  }}>
    {children}
  </div>
);

const Chain = ({ steps }) => (
  <div style={{ marginBottom: 8 }}>
    {steps.map((step, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div style={{
          background: step.highlight ? '#e6f7ff' : '#fafafa',
          border: `1px solid ${step.highlight ? '#91d5ff' : '#e8e8e8'}`,
          borderRadius: 6, padding: '8px 14px',
          fontSize: 13, color: step.highlight ? '#003a8c' : '#434343',
          lineHeight: 1.7, maxWidth: 560,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {step.label && (
            <span style={{ fontWeight: 600, color: '#8c8c8c', fontSize: 11, marginRight: 6 }}>
              {step.label}
            </span>
          )}
          <span>{step.text}</span>
          {step.tooltip && (
            <Tooltip
              title={step.tooltip}
              placement="right"
              overlayStyle={{ maxWidth: 360 }}
            >
              <InfoCircleOutlined style={{ color: '#bfbfbf', cursor: 'pointer', fontSize: 12 }} />
            </Tooltip>
          )}
        </div>
        {i < steps.length - 1 && (
          <div style={{ paddingLeft: 20, color: '#bfbfbf', fontSize: 16, lineHeight: '22px' }}>↓</div>
        )}
      </div>
    ))}
  </div>
);

const Background = () => (
  <div style={{ maxWidth: 640, padding: '4px 0' }}>

    {/* 系统定位 */}
    <div style={{
      background: 'linear-gradient(135deg, #f0f5ff 0%, #e6fffb 100%)',
      border: '1px solid #adc6ff', borderRadius: 8,
      padding: '12px 16px', marginBottom: 28,
      fontSize: 12, color: '#0050b3',
    }}>
      做多系统 · 重仓 · 基本面驱动 · K 线辅助入场时机
    </div>

    {/* 逻辑链一：我为什么要这样做 */}
    <div style={{ marginBottom: 32 }}>
      <Title>一、我为什么要这样做（推导路径）</Title>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 14 }}>
        这是我发现这套方法的思路，解释了「为什么重仓」「为什么研究基本面」。
      </div>
      <Chain steps={[
        { text: '做空系统 = 每笔最大亏损 ≤ 总资金 2%，K 线择时，快进快出 → 实测资金增速慢' },
        { text: '要实现更快增长，需要更大的仓位规模' },
        { text: '我选择重仓这条路——不是唯一的路，是我的选择',
          tooltip: (
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>重仓 vs 轻仓的定义（System 2）</div>
              <div>System 2 没有止损，无法用「单笔最大亏损」反推仓位。仓位定义改为：占总可投资资金的比例。</div>
              <div style={{ marginTop: 8 }}>
                <div>· <b>轻仓</b> ≤ 10%：基本面通过但信念不够硬，或成长资产试水</div>
                <div>· <b>中仓</b> 10–30%：基本面清晰，仍有待观察的条件</div>
                <div>· <b>重仓</b> 30–60%：基本面极度清晰，准入两问都答得很硬</div>
                <div>· <b>单资产硬上限</b>：自定义，超过即修剪，防单点失误不可承受</div>
              </div>
              <div style={{ marginTop: 8, color: '#8c8c8c', fontStyle: 'italic' }}>
                其他路径及为什么不选：提高单笔回报率（有天花板）、提高交易频率（降低标准）、复利（太慢）、杠杆（多一层爆仓风险）。
                结论：轻仓模式的上限就是慢，要突破量级只能换仓位量级。
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
        { text: 'K 线只负责判断「什么时候进」——两件事不能混淆',
          tooltip: (
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>不在框架内的指标：</div>
              <div>· <b>挖矿成本</b>：「成本撑住价格」因果反了。价格跌 → 高成本矿机关机 → 难度调整 → 存活矿工成本自动降低。成本是价格的跟随者，不是支撑。</div>
              <div style={{ marginTop: 6 }}>· <b>链上数据</b>（交易所流入流出、巨鲸动向等）：本质是市场行为指标，告诉你别人在干什么，不是这东西值多少钱。同一数据可以看涨也可以看跌，是不了解的噪音源。</div>
              <div style={{ marginTop: 6, color: '#8c8c8c', fontStyle: 'italic' }}>
                结论：框架只需要两样——独立思考的基本面判断 + 客观独立的K线择时。不了解的东西不放进决策链路。
              </div>
            </div>
          ),
        },
      ]} />
    </div>

    {/* 逻辑链二：应有的执行顺序 */}
    <div style={{ marginBottom: 32 }}>
      <Title>二、应有的执行顺序（操作规程）</Title>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 14 }}>
        这是执行时的正确顺序。推导路径是从结果往回找原因，执行顺序必须反过来。
      </div>
      <Chain steps={[
        {
          label: 'Step 1',
          text: '两个问题都回答「是」才算通过：① 它解决的问题目前没有替代品能做得一样好；② 它在这个位置有主导优势，不是「也行」里的一个',
          tooltip: (
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>出场条件是 ①② 的反面，不用单独列：</div>
              <div>出现了能解决同样问题的替代品，并且开始动摇它的主导地位 → 出场</div>
              <div style={{ marginTop: 6, color: '#8c8c8c', fontStyle: 'italic' }}>
                有一个「不确定」→ 继续研究或轻仓观察；有一个「否」→ 不进
              </div>
            </div>
          ),
        },
        {
          label: 'Step 2',
          text: '确认安全边际够大 → 当前价格在历史中处于什么位置？即使跌到让自己肉疼的位置，还能平静拿住吗？',
          tooltip: (
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>安全边际不是在算它值多少钱：</div>
              <div>· <b>价格维度</b>：不看「应该值多少」，看「已经跌了多少」。跌 60% 比跌 20% 安全边际大，这是事实不是预测。</div>
              <div style={{ marginTop: 6 }}>· <b>承受维度</b>：即使跌到让你肉疼的位置，仍能平静拿住 → 安全边际够；会焦虑 → 要么仓位太大，要么价格不够低。</div>
              <div style={{ marginTop: 6 }}>· <b>最差情景</b>：仓位不会毁掉你，即使判断全错。</div>
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
      ]} />
      <div style={{
        background: '#fff7e6', border: '1px solid #ffd591',
        borderRadius: 6, padding: '10px 14px', marginTop: 8,
        fontSize: 12, color: '#874d00',
      }}>
        ⚠ 不能因为「做多系统预设了重仓」，就在基本面分析含糊时也往里冲。
        分析结论不够硬就不进，或轻仓观察。
      </div>
      <div style={{
        background: '#fff1f0', border: '1px solid #ffa39e',
        borderRadius: 6, padding: '10px 14px', marginTop: 8,
        fontSize: 12, color: '#a8071a',
      }}>
        🛑 持仓铁律：价值主张不变 → 拿住，不管账面浮亏；价值主张被证伪 → 无条件退出，不管账面盈亏。
      </div>
    </div>

    {/* 系统原则骨架 */}
    <div style={{ marginBottom: 32 }}>
      <Title>三、系统原则（持续共建中）</Title>
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 14 }}>
        五条基本原则，覆盖资产准入、入场、仓位、出场、纪律。规则在入场前写好，持仓期间不改。
      </div>

      {/* 原则一 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#595959', marginBottom: 6 }}>原则一：资产准入</div>
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343', lineHeight: 1.8 }}>
          两个问题都回答「是」才进入考虑范围：<br />
          ① 它解决的问题，目前没有替代品做得一样好<br />
          ② 它在这个位置有主导优势，不是「也行」里的一个<br />
          <span style={{ color: '#8c8c8c' }}>有一个「不确定」→ 轻仓观察；有一个「否」→ 不进</span>
        </div>
      </div>

      {/* 原则二 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#595959', marginBottom: 6 }}>原则二：入场触发（同一系统，两条轨道）</div>
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343', lineHeight: 1.8 }}>
          <div style={{ color: '#8c8c8c', marginBottom: 8 }}>准入原则、仓位定义、出场规则、系统纪律完全共用。只有入场信号因资产成熟度不同而分轨。</div>
          <div><span style={{ fontWeight: 600 }}>轨道一 · 成熟资产</span>（BTC / ETH，有足够长历史数据）</div>
          <div style={{ paddingLeft: 12, color: '#595959' }}>链上估值处于历史低位 + 周线企稳结构 → 分批建仓</div>
          <div style={{ marginTop: 8 }}><span style={{ fontWeight: 600 }}>轨道二 · 成长资产</span>（早期资产，历史数据有限）</div>
          <div style={{ paddingLeft: 12, color: '#595959' }}>真实使用数据增长（收入 / TVL / 开发者）+ 准入通过 + 周线趋势确认 → 入场</div>
        </div>
      </div>

      {/* 原则三 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#595959', marginBottom: 6 }}>原则三：仓位规模</div>
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343', lineHeight: 1.8 }}>
          <div>由信念深度决定，不是固定比例。准入问题答得越硬 → 仓位越重；答得模糊 → 轻仓观察</div>
          <div style={{ marginTop: 8 }}>
            <div><span style={{ fontWeight: 600 }}>轨道一上限（成熟资产）</span>：单资产不超过 System 2 总资金的 80%</div>
            <div><span style={{ fontWeight: 600 }}>轨道二上限（成长资产）</span>：单资产不超过 System 2 总资金的 20%</div>
          </div>
          <div style={{ marginTop: 8, color: '#8c8c8c' }}>
            两条轨道独立触发，不强行同步。有机会就建仓，没有机会就空着，不因「预算没用完」而降低标准。超过各自上限无论理由都修剪。
          </div>
        </div>
      </div>

      {/* 原则四 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#595959', marginBottom: 6 }}>原则四：出场</div>
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343', lineHeight: 1.8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>轨道一 · 成熟资产（低频，主要考验拿得住）</div>
          <div style={{ paddingLeft: 12 }}>
            ① 基本面破裂：准入条件①或②不再成立 → 无条件出，不管盈亏<br />
            ② 集中度超上限（超 80%）→ 修剪回上限以内<br />
            ③ 不设保本触发，不设倍数兑现——基本面驱动，让它跑
          </div>
          <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>轨道二 · 成长资产（保本优先，剩余基本面驱动）</div>
          <div style={{ paddingLeft: 12 }}>
            <div style={{ fontWeight: 600, color: '#1677ff', marginBottom: 2 }}>第一阶段：先保本</div>
            均价涨至 1.5 倍 → 卖出 2/3，收回原始本金。本金到手是真实财务事件，不是心理技巧。<br />
            <div style={{ fontWeight: 600, color: '#1677ff', margin: '6px 0 2px' }}>第二阶段：剩余 1/3 自由运行</div>
            本金已收回后，剩余仓位只看基本面：<br />
            · 基本面变化（竞争对手抢份额 / 使用数据持续下滑）→ 出<br />
            · 重大代币解锁节点前 → 主动评估，视情况减仓<br />
            · 集中度超上限（超 20%）→ 修剪<br />
            · 以上都没有 → 拿住，不管价格涨跌
          </div>
          <div style={{ marginTop: 10, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#874d00' }}>
            ⚠ 当前规则为初版，保守优先。1.5 倍保本触发点会在真实交易中验证和迭代，跑通几个完整周期后再调整。
          </div>
        </div>
      </div>

      {/* 原则五 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#595959', marginBottom: 6 }}>原则五：系统纪律</div>
        <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343', lineHeight: 1.8 }}>
          · 所有规则在入场前写好，持仓期间不临时修改<br />
          · K 线只用于判断入场时机，不用于持仓期间的出场决策<br />
          · System 1 和 System 2 逻辑严格隔离，不混用
        </div>
      </div>
    </div>

    {/* 与做空系统对比 */}
    <div>
      <Title>四、与做空系统的对比</Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{
          background: '#fff1f0', border: '1px solid #ffa39e',
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#cf1322' }}>做空系统（系统一）</div>
          <div>仓位：每笔最大亏损 ≤ 总资金 2%</div>
          <div>依据：K 线形态 + 缩量横盘信号</div>
          <div>持仓：短期，触发止损即出</div>
          <div>目标：稳定累积，控制单笔风险</div>
        </div>
        <div style={{
          background: '#f0f5ff', border: '1px solid #adc6ff',
          borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#434343',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#1d39c4' }}>做多系统（系统二）</div>
          <div>仓位：占总可投资资金比例（轻 ≤10% / 中 10–30% / 重 30–60%）</div>
          <div>依据：基本面准入 + 入场时机</div>
          <div>持仓：基本面不变则拿住，无固定止损</div>
          <div>目标：资金量级跨越</div>
        </div>
      </div>
    </div>

  </div>
);

export default Background;
