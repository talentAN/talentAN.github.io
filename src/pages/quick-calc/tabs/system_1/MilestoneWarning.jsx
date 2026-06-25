import React, { useState } from 'react';

// ── 样式工具 ──────────────────────────────────────────────────────────
const COLORS = {
  red: '#ff4d4f',
  orange: '#fa8c16',
  yellow: '#faad14',
  green: '#52c41a',
  blue: '#1677ff',
  gray: '#8c8c8c',
};

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 28 }}>
    <div
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: '#262626',
        borderLeft: '3px solid #1677ff',
        paddingLeft: 10,
        marginBottom: 14,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const WarningCard = ({ level = 'orange', icon, title, children, evidence }) => {
  const color = COLORS[level];
  const bg =
    level === 'red'
      ? '#fff1f0'
      : level === 'orange'
        ? '#fff7e6'
        : level === 'yellow'
          ? '#fffbe6'
          : '#f6ffed';
  const border =
    level === 'red'
      ? '#ffa39e'
      : level === 'orange'
        ? '#ffd591'
        : level === 'yellow'
          ? '#ffe58f'
          : '#b7eb8f';
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: evidence || children ? 8 : 0,
        }}
      >
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{title}</span>
      </div>
      {children && (
        <div
          style={{
            fontSize: 12,
            color: '#595959',
            lineHeight: 1.8,
            marginBottom: evidence ? 8 : 0,
          }}
        >
          {children}
        </div>
      )}
      {evidence && (
        <div
          style={{
            background: 'rgba(0,0,0,0.04)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 11,
            color: '#8c8c8c',
            lineHeight: 1.7,
          }}
        >
          {evidence}
        </div>
      )}
    </div>
  );
};

const MilestoneTag = ({ label, active }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 12px',
      borderRadius: 12,
      marginRight: 8,
      marginBottom: 8,
      background: active ? '#1677ff' : '#f5f5f5',
      border: `1px solid ${active ? '#1677ff' : '#d9d9d9'}`,
      color: active ? '#fff' : '#595959',
      fontSize: 12,
      fontWeight: active ? 600 : 400,
    }}
  >
    {active && <span style={{ fontSize: 10 }}>▶</span>}
    {label}
  </div>
);

// ── 维度一：交易笔数 ──────────────────────────────────────────────────
const TradeCountDimension = () => (
  <div>
    <div style={{ marginBottom: 16 }}>
      <MilestoneTag label="1-6 笔（阶段1）" />
      <MilestoneTag label="7-12 笔（现在）" active />
      <MilestoneTag label="13-30 笔" />
      <MilestoneTag label="31-100 笔" />
      <MilestoneTag label="100+ 笔" />
    </div>

    <Section title="现在（7-12 笔）：小样本过度自信期">
      <WarningCard
        level="orange"
        icon="⚠️"
        title="E02 已经被你连续突破 2 次"
        evidence="SYNUSDT（260623）备注：「连续两次没有严格遵循缩量两天以上开仓规则了，警醒」；HUSDT 第二笔：缩量一天扛单，靠价格暴跌90%出局"
      >
        你在备注里已经写过两次"警醒"，但下一次照样发生。这不是认知问题，是执行问题——信号稀少时大脑会主动找理由降低标准。
      </WarningCard>
      <WarningCard
        level="yellow"
        icon="📊"
        title="12 笔 100% 胜率不代表系统已被证明"
        evidence="统计学：12 笔 100% 胜率的置信区间下限约 74%，真实胜率可能只有 75%"
      >
        第二阶段零亏损是真实的执行质量提升，但也有市场顺风的成分。在看到连亏之前，不能确认系统在不利环境下同样有效。
      </WarningCard>
    </Section>

    <Section title="13-30 笔：第一次真正考验">
      <WarningCard
        level="red"
        icon="🔴"
        title="你将遇到第一次连续亏损"
        evidence="概率估算：若真实胜率 75%，30 笔内出现连亏 2 笔的概率 >40%，几乎不可避免"
      >
        这不是"如果"，是"什么时候"。关键是你在亏损发生时的行为——历史上你的模式是：亏损 → 不接受 →
        追加保证金 → 扩大损失（ZBTUSDT双笔、HUSDT扛单）。
      </WarningCard>
      <WarningCard
        level="orange"
        icon="⚠️"
        title="市场环境可能切换，系统信号质量下降"
        evidence="你所有系统期交易均在 2025年8月至2026年6月，未经历完整牛熊周期检验"
      >
        当前盈利可能有市场顺风因素。如果进入阶段性熊市，「暴涨缩量横盘」的标的减少，信号干燥期延长，E02降标压力会显著增大。
      </WarningCard>
      <WarningCard
        level="yellow"
        icon="💡"
        title="规则「合理化」开始出现"
        evidence="历史样本：MAGMAUSDT「尽管盈利，但跟系统无关」，GWEIUSDT阶段5那笔「不符合系统的交易」"
      >
        亏损后大脑会主动寻找例外理由，让下一笔「看起来符合系统」。每次在备注里写"这笔不符合"就是在记录一次规则侵蚀。
      </WarningCard>
    </Section>

    <Section title="31-100 笔：纪律慢性侵蚀期">
      <WarningCard
        level="orange"
        icon="🔄"
        title="每条规则都会积累一次「特殊情况」例外"
        evidence="历史轨迹：E02从「2天以上」被调整为「至少3天」，说明规则一直在被真实违规倒逼修改"
      >
        这不一定是坏事（规则应该进化），但要区分「数据驱动的修改」和「情绪驱动的妥协」。前者留在变更历史，后者是系统腐化。
      </WarningCard>
      <WarningCard
        level="red"
        icon="🎯"
        title="B类事件（真实基本面驱动）首次命中概率升高"
        evidence="你的交易都在市值100名外，但样本只有12笔，小概率事件在更多笔数后必然出现"
      >
        你的时间止损（X02）是为此准备的。问题是：当持仓浮亏且超过50天时，你能执行强制平仓吗？历史上你在扛单时很难主动认亏。
      </WarningCard>
    </Section>

    <Section title="100+ 笔：成熟期隐性风险">
      <WarningCard
        level="yellow"
        icon="😌"
        title="自满导致步骤跳过"
        evidence="你在阶段1早期曾说「感觉不对就先跑」——这是直觉替代系统的典型表现"
      >
        稳定盈利后容易觉得「这个我看一眼就知道」，不再执行入场检查清单。系统的价值在于替代当下情绪决策，一旦开始凭感觉走捷径，系统就开始失效。
      </WarningCard>
    </Section>
  </div>
);

// ── 维度二：资金规模 ──────────────────────────────────────────────────
const CapitalDimension = () => (
  <div>
    <div style={{ marginBottom: 16 }}>
      <MilestoneTag label="500U 起点" />
      <MilestoneTag label="920U（+84%）" />
      <MilestoneTag label="历史最低 451U" />
      <MilestoneTag label="当前 ~577U" active />
      <MilestoneTag label="1000U（翻倍目标）" />
    </div>

    <Section title="当前（577U）：你正处于历史最高系统化收益区">
      <WarningCard
        level="green"
        icon="✅"
        title="当前风险敞口（1% 单笔）是合理的"
        evidence="1R = 10U = 本金 1%，历史记录中你在系统期从未出现超过 1R 的单笔亏损（除了执行违规的 BOBUSDT）"
      >
        这个阶段不需要提高风险。继续用 1%，把样本积累到 30 笔再重新评估。
      </WarningCard>
      <WarningCard
        level="orange"
        icon="⚠️"
        title="资金超过 700U 时你有加大单笔风险的历史前科"
        evidence="阶段1：500→920 期间，你开始使用 30-80U 保证金做大单，「为了求稳，加保证金使预估强平达到10块」——那笔 ALPINE 一次 -300U"
      >
        当账户盈利让你感到「稳了」时，大脑会产生加大仓位的冲动。1R 的绝对值增大（从 10U 到
        20U）会让止损的心理重量翻倍，进而产生扛单冲动。
      </WarningCard>
    </Section>

    <Section title="首次大回撤（-150U 以上）">
      <WarningCard
        level="red"
        icon="🚨"
        title="你经历过 3 次大回撤，每次模式相同"
        evidence="阶段1：920→632（-288U），一次 ALPINE 爆仓 -300U；阶段2：632→547（-85U），1011黑天鹅四多头同日爆；阶段3：547→451（-96U），做多失败集中亏损"
      >
        你的大回撤不是由连续小亏损累积的，而是由**单次大事件**触发的：一笔巨鬼、一次黑天鹅、一次逆势追加保证金。当前系统的
        1R 硬约束是防止这个模式的核心机制——任何理由导致单笔超过 1R 都是在重演历史。
      </WarningCard>
      <WarningCard
        level="red"
        icon="🔄"
        title="回撤后你的历史反应是：加大风险「扳回来」"
        evidence="阶段1爆仓后接着开了 SQDUSDT +116U 这笔（成功），但同期也有 ZBTUSDT 双笔追加保证金爆仓（失败）。两种行为都是回撤后的情绪反应"
      >
        在大亏损后，做对了会强化「我应该大仓」的错误认知，做错了会进一步亏损。最安全的规则是：单月亏损超过
        50U，强制暂停 3 天，不做任何交易。
      </WarningCard>
    </Section>

    <Section title="资金翻倍（1000U+）：未知领域">
      <WarningCard
        level="yellow"
        icon="❓"
        title="你从未在系统化状态下持续管理过 1000U 以上的资金"
        evidence="历史最高 920U，但是在非系统化、高杠杆、扛单模式下达到的，不具有参考性"
      >
        1R = 10U 在 1000U 本金下是 1%，在 2000U 本金下是
        0.5%。随着本金增大，系统的绝对盈利数字增大，但你的心理参考点（「10U
        的利润归零很难受」）会产生更强的干预冲动。建议在本金翻倍前，先做一次完整的「首次连亏」经历。
      </WarningCard>
    </Section>
  </div>
);

// ── 维度三：历史数据规律 ─────────────────────────────────────────────
const HistoryDimension = () => (
  <div>
    <Section title="模式一：止损不执行（出现频率最高）">
      <WarningCard
        level="red"
        icon="🔴"
        title="你有至少 5 次明确的止损未执行记录"
        evidence={
          <>
            <div>· INUSDT（早期）：-29U 爆仓，「没及时止盈，被探针了」</div>
            <div>· ZBTUSDT 第一笔：-9.9U，「开空价格已经证明错误，还逆势追加开仓，最后全被爆」</div>
            <div>· ZBTUSDT 第二笔：-6.9U，「上头了，还追加保证金，活该」</div>
            <div>· BOBUSDT（系统期）：止损位设在前高以下，被精确触发</div>
            <div>· HUSDT 扛单那笔：没设止损，靠暴跌90%才出局</div>
          </>
        }
      >
        每一次你都在事后复盘里写清楚了原因，但下一次遇到浮亏扩大时，同样的冲动还是会出现。这不是知识问题，是在压力下的行为模式问题。
      </WarningCard>
      <WarningCard
        level="orange"
        icon="💡"
        title="触发止损不执行的共同前置状态"
        evidence="ZBTUSDT、HUSDT、INUSDT 三笔均有一个共同点：开仓后价格立刻反向，且仓位较大（相对当时本金）"
      >
        当止损线被触及时，「再等一下」的冲动来自于「损失金额让你无法接受」。解法不是意志力，而是把单笔风险设得更小——1%
        的约束正是为此存在的。
      </WarningCard>
    </Section>

    <Section title="模式二：遇「鬼」（B类事件）爆仓">
      <WarningCard
        level="red"
        icon="👻"
        title="你遇过 6 次以上的「鬼」事件，每次在此之前账户都表现良好"
        evidence={
          <>
            <div>· SAPIEN：新币第三天，半夜爆仓 -29U</div>
            <div>· SIGN：看空遇鬼，半夜被爆 -29U</div>
            <div>· XPL（第一次）：看空遇鬼，半夜被爆 -39U</div>
            <div>· ALPINE（大鬼）：加保证金求稳，半夜被爆 -300U</div>
            <div>· 1011 黑天鹅：4 个多头同日爆 -150U</div>
            <div>· XPINUSDT：破新高做空被爆 -49U</div>
          </>
        }
      >
        你在市值100名外的策略大幅降低了这个风险，但没有消除。当前系统的 1R 硬约束 +
        禁止隔夜委托单是核心防线。不要因为「这个币感觉稳」而绕过这两条。
      </WarningCard>
      <WarningCard
        level="orange"
        icon="🌙"
        title="你的「鬼」爆仓 100% 发生在夜间委托"
        evidence="SAPIEN、SIGN、XPL、ALPINE 均为「半夜被爆」——你本人在 BOBUSDT 复盘后已经写入规则：开仓委托单不过夜"
      >
        E04「入场前确认失效价」+
        SL01「止损设在前高以上」是目前防止这个模式的规则。但这两条都依赖执行，不是自动保护。
      </WarningCard>
    </Section>

    <Section title="模式三：「好交易」之后放松标准">
      <WarningCard
        level="orange"
        icon="📈"
        title="你的大盈利笔（+100U 级别）之后往往跟着规则违规"
        evidence={
          <>
            <div>· SQDUSDT +116U 之后：ZBTUSDT 两笔追加保证金爆仓</div>
            <div>· TREEUSDT +82U 之后：ALPINE 加保证金求稳，-300U 爆仓</div>
            <div>· GWEIUSDT +31U 之后：SYNUSDT E02 违规（近期）</div>
          </>
        }
      >
        大盈利触发「我判断对了」的自信感，进而降低下一笔的入场标准或提高风险敞口。SYNUSDT
        发生在你第二阶段最好的两笔之后，这不是巧合。
      </WarningCard>
    </Section>

    <Section title="模式四：E02「横盘 ≥ 3 天」被信号干燥期侵蚀">
      <WarningCard
        level="red"
        icon="⚡"
        title="E02 是你整个系统期触发频率最高的违规项"
        evidence={
          <>
            <div>· BOBUSDT：「横盘期间实体仍在上移未识别」</div>
            <div>· SKYAIUSDT：「横盘不充分」</div>
            <div>· HUSDT（第二笔，0.16入场）：缩量一天就挂委托</div>
            <div>· SYNUSDT：「没等至少横盘两天才开仓，赌博心态明显」</div>
          </>
        }
      >
        这条规则触发的心理机制是：「看到一个很好的币，等不了 3
        天」。越是好看的信号，越容易触发焦虑。解法是物理隔离：开仓委托单只在确认天数满足后才允许提交，没有例外。
      </WarningCard>
    </Section>

    <Section title="你现在需要预先设定的锚点">
      <div
        style={{
          background: '#f6ffed',
          border: '1px solid #b7eb8f',
          borderRadius: 6,
          padding: '14px 16px',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 12 }}>
          在情绪平静时写下，等真正遇到时才能信任这些规则：
        </div>
        {[
          { label: '连亏 3 笔时', placeholder: '停止交易 X 天，做一次完整复盘，不急于找机会' },
          { label: '月度亏损超过 ___U 时', placeholder: '强制暂停，不做任何操作' },
          { label: '持仓超过 50 天浮亏仍扩大', placeholder: '启动减仓，不扛单（X02 时间止损）' },
          {
            label: '遇到 B 类：持仓 30 天价格反向创新高',
            placeholder: '承认系统失效，直接平仓，不追加保证金',
          },
          {
            label: '大盈利（+30U 单笔）后下一笔',
            placeholder: '额外检查 E02，确认满 3 天才提交委托',
          },
        ].map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 8,
              fontSize: 12,
            }}
          >
            <span
              style={{
                background: '#1677ff',
                color: '#fff',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <div>
              <span style={{ fontWeight: 600, color: '#262626' }}>{item.label}：</span>
              <span style={{ color: '#8c8c8c', fontStyle: 'italic' }}>{item.placeholder}</span>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 8 }}>
          * 以上是模板，请用你自己的判断填入具体数字和行动
        </div>
      </div>
    </Section>
  </div>
);

// ── 主组件 ────────────────────────────────────────────────────────────
const TABS = [
  { key: 'count', label: '交易笔数', icon: '📊' },
  { key: 'capital', label: '资金规模', icon: '💰' },
  { key: 'history', label: '历史数据', icon: '📋' },
];

const MilestoneWarning = () => {
  const [active, setActive] = useState('count');

  return (
    <div>
      {/* 标题 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #fff2e8 0%, #fff7e6 100%)',
          border: '1px solid #ffd591',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>🪞</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#d46b08' }}>
            给未来的自己：阶段性预警地图
          </div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
            基于你从 2025-08 至今的完整交易数据归纳，在情绪平静时阅读，在关键时刻回顾
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TABS.map(tab => (
          <div
            key={tab.key}
            onClick={() => setActive(tab.key)}
            style={{
              cursor: 'pointer',
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: `1px solid ${active === tab.key ? '#1677ff' : '#d9d9d9'}`,
              background: active === tab.key ? '#1677ff' : '#fff',
              color: active === tab.key ? '#fff' : '#595959',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </div>
        ))}
      </div>

      {/* 内容 */}
      <div>
        {active === 'count' && <TradeCountDimension />}
        {active === 'capital' && <CapitalDimension />}
        {active === 'history' && <HistoryDimension />}
      </div>
    </div>
  );
};

export default MilestoneWarning;
