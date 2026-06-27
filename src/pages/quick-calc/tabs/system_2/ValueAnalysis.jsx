import React, { useState } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

// ── 样式工具 ──────────────────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div style={{ marginBottom: 24 }}>
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: '#262626',
        borderLeft: '3px solid #1677ff',
        paddingLeft: 10,
        marginBottom: 12,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const Block = ({ label, children, color = '#f5f5f5', borderColor = '#d9d9d9' }) => (
  <div
    style={{
      background: color,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: '10px 14px',
      marginBottom: 10,
    }}
  >
    {label && (
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#8c8c8c',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
    )}
    <div style={{ fontSize: 13, color: '#262626', lineHeight: 1.8 }}>{children}</div>
  </div>
);

const Conclusion = ({ children }) => (
  <div
    style={{
      background: '#e6f7ff',
      border: '1px solid #91d5ff',
      borderLeft: '3px solid #1677ff',
      borderRadius: 6,
      padding: '10px 14px',
      marginBottom: 10,
      fontSize: 13,
      color: '#003a8c',
      lineHeight: 1.8,
    }}
  >
    {children}
  </div>
);

const Pending = ({ label }) => (
  <div
    style={{
      background: '#fafafa',
      border: '1px dashed #d9d9d9',
      borderRadius: 6,
      padding: '10px 14px',
      marginBottom: 10,
      fontSize: 12,
      color: '#bfbfbf',
      fontStyle: 'italic',
    }}
  >
    {label}（待补充）
  </div>
);

// ── BTC 价值分析 ──────────────────────────────────────────────────────
const BTCAnalysis = () => (
  <div>
    <div
      style={{
        background: 'linear-gradient(135deg, #fff7e6 0%, #fffbe6 100%)',
        border: '1px solid #ffd591',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 12,
        color: '#874d00',
      }}
    >
      比特币 · 价值分析框架 · 持续更新中
    </div>

    <Section title="核心主张（你在买什么）">
      <Block color="#fff7e6" borderColor="#ffd591">
        数量固定（2100 万枚上限），不受任何人控制，可以跨境转移的硬通货。
        价格上涨的唯一来源是：后来的买家愿意付更高的价。
      </Block>
    </Section>

    <Section title="需求来源（为什么有人买）">
      <Block label="需求 1：抗通胀">
        政府持续印钱，法币购买力长期下降。BTC 数量固定，成为部分人对冲法币贬值的工具。
        只要政府印钱的动机不消失，这类需求就存在。
      </Block>
      <Block label="需求 2：财富跨境转移">
        在主权管控之外转移财富，BTC 是目前最有效的工具之一。 这类需求在全球范围内持续存在。
      </Block>
      <Block label="需求 3：机构配置">
        部分机构和国家主权基金将 BTC 作为另类资产配置（类黄金逻辑）。 ETF
        通过之后，这类需求已有实质性进入。
      </Block>
    </Section>

    <Section title="价值基础什么时候会动摇">
      <Block label="真实风险" color="#fff1f0" borderColor="#ffa39e">
        <div>· 出现更好的替代品（固定上限 + 更低能耗 + 更好安全性），且发生大规模迁移</div>
        <div>· 主要经济体协调禁止持有和交易（历史上单国禁止无效，协调禁止未发生过）</div>
        <div>· 量子计算突破导致私钥安全性崩溃（目前时间表不明确）</div>
      </Block>
      <Block label="不是真实风险" color="#f6ffed" borderColor="#b7eb8f">
        <div>· 价格下跌本身不是风险——主张没变，市场情绪悲观是机会</div>
        <div>· 某个名人或机构看空——不改变底层需求</div>
      </Block>
    </Section>

    <Section title="退出条件（什么时候卖）">
      <Pending label="价格跌到多少不是退出条件" />
      <Pending label="什么事情发生说明主张失效" />
    </Section>

    <Section title="关键结论">
      <Pending label="第一次讨论结论" />
    </Section>
  </div>
);

// ── ETH 价值分析 ──────────────────────────────────────────────────────
const ETHAnalysis = () => (
  <div>
    <div
      style={{
        background: 'linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)',
        border: '1px solid #adc6ff',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 20,
        fontSize: 12,
        color: '#0050b3',
      }}
    >
      以太坊 · 价值分析框架 · 持续更新中
    </div>

    <Section title="核心主张（你在买什么）">
      <Block color="#f0f5ff" borderColor="#adc6ff">
        一台全球共享的计算机，任何人都可以在上面运行不可篡改的程序（智能合约）。 ETH
        是这台计算机的燃料——使用这台机器就必须消耗 ETH。
      </Block>
    </Section>

    <Section title="需求来源（为什么有人买）">
      <Block label="需求 1：链上应用的燃料消耗">
        DeFi（去中心化金融）、NFT、链上合约运行，都需要消耗 ETH 作为 Gas 费。
        使用越多，消耗越多，供给越稀缺（EIP-1559 销毁机制）。
      </Block>
      <Block label="需求 2：质押收益">
        ETH 转向 PoS 后，持有者可以质押获得网络收益。 这让 ETH 有了类似「生息资产」的属性。
      </Block>
      <Block label="需求 3：链上经济的储备货币">
        在以太坊生态内，ETH 是最基础的结算单位，类似链上的美元。
      </Block>
    </Section>

    <Section title="ETH 比 BTC 多一个关键变量">
      <Block label="额外需要相信的一件事" color="#fff7e6" borderColor="#ffd591">
        链上应用会持续存在且增长。如果没有人在以太坊上建应用，ETH 就没有燃料消耗，价值主张就变弱。
        这是 ETH 和 BTC 最本质的区别：BTC 的主张不依赖使用量，ETH 的主张依赖。
      </Block>
    </Section>

    <Section title="价值基础什么时候会动摇">
      <Block label="真实风险" color="#fff1f0" borderColor="#ffa39e">
        <div>· 竞争链（Solana、Sui 等）大规模抢走开发者和用户，以太坊生态萎缩</div>
        <div>· Layer2 的发展导致主链 Gas 消耗大幅下降，ETH 销毁减少</div>
        <div>· 监管打击 DeFi 等链上应用，使用场景被摧毁</div>
      </Block>
      <Block label="不是真实风险" color="#f6ffed" borderColor="#b7eb8f">
        <div>· ETH 涨得比 BTC 慢——不代表主张失效</div>
        <div>· 短期价格下跌——主张没变时是机会</div>
      </Block>
    </Section>

    <Section title="退出条件（什么时候卖）">
      <Pending label="价格跌到多少不是退出条件" />
      <Pending label="什么事情发生说明主张失效" />
    </Section>

    <Section title="关键结论">
      <Pending label="第一次讨论结论" />
    </Section>
  </div>
);

// ── 主组件 ────────────────────────────────────────────────────────────
const TABS = [
  { key: 'btc', label: 'BTC', icon: '₿', color: '#f7931a' },
  { key: 'eth', label: 'ETH', icon: 'Ξ', color: '#627eea' },
];

const ValueAnalysis = () => {
  const [active, setActive] = useState('btc');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TABS.map(tab => (
          <div
            key={tab.key}
            onClick={() => setActive(tab.key)}
            style={{
              cursor: 'pointer',
              padding: '8px 20px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              border: `1px solid ${active === tab.key ? tab.color : '#d9d9d9'}`,
              background: active === tab.key ? tab.color : '#fff',
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
        <Text type="secondary" style={{ fontSize: 11, alignSelf: 'center', marginLeft: 8 }}>
          持续讨论，持续更新
        </Text>
      </div>

      {active === 'btc' && <BTCAnalysis />}
      {active === 'eth' && <ETHAnalysis />}
    </div>
  );
};

export default ValueAnalysis;
