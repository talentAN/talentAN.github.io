import React from 'react';
import { Typography } from 'antd';
import { Section, Callout, RuleCard, CodeBlock } from '../system_1/retrospective/_components';

const { Text } = Typography;

const Volatility = () => (
  <div>
    <Section title="一、波动率会「传染」">
      <p style={{ fontSize: 13, lineHeight: 1.8, color: '#444' }}>
        观察 BTC 的日线就能直观感受到：一旦某天出现大阳线或大阴线，接下来几天大概率也是大幅波动。
        反过来，一段时间行情窄幅震荡，后面几天大概率也继续磨。
      </p>
      <Callout type="info">
        波动率在时间上是<Text strong>自相关</Text>的——今天的波动率对明天的波动率有预测力。 这是
        GARCH 类模型的核心假设，也是实盘中"缩量横盘后等信号"逻辑的理论基础。
      </Callout>
    </Section>

    <Section title="二、波动率会「回家」">
      <p style={{ fontSize: 13, lineHeight: 1.8, color: '#444' }}>
        BTC 的波动率不管飙得多高或压得多低，最终都会往一个中间水平靠拢。
      </p>
      <Callout type="warning">
        波动率的中间态存在，但<Text strong>不是一个固定数值</Text>，而是一个会缓慢漂移的区间。
        实操上，看最近 3-6 个月的波动率中位数作为"当前中间态"的近似值，比拿全历史数据更靠谱。
      </Callout>
    </Section>

    <Section title="三、波动率窗口的确定方式">
      <p style={{ fontSize: 13, lineHeight: 1.8, color: '#444', marginBottom: 12 }}>
        核心思路：检验不同时间段的波动率分布是否还属于同一个"群体"。
      </p>

      <RuleCard no="大币" title="变点检测（BTC 等数据充足的币）">
        直接告诉你"上次结构变化是什么时候"，然后只用那之后的数据。比滚动窗口更精准。
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li>
            <Text strong>多变点：</Text>
            如果一次渐变被识别成两三个相邻变点（比如第 45 天和第 60 天各一个），
            两点之间就是过渡区间——告诉你结构变化大约用了两周完成，这是有用的信息
          </li>
          <li>
            <Text strong>置信区间（贝叶斯 BOCPD）：</Text>
            不只给一个点，而是给每个时间点"发生变化的概率"。
            概率从低升到高再回落的那段区间，就是过渡期
          </li>
        </ul>
      </RuleCard>

      <RuleCard no="小币" title="滚动窗口对比（数据不足时）">
        数据量不够时，退回到滚动窗口对比就够用了。 取最近 N 天的波动率与前 N
        天对比，判断是否发生结构性变化。
      </RuleCard>
    </Section>

    <Section title="四、数据来源">
      <RuleCard no="免费" title="CoinGecko API">
        免费版可以拿到 BTC 完整历史日线数据，不限时间范围，不需要注册就能用基础接口。
        <CodeBlock>{`# 获取 BTC 历史价格（天级别，最多 365 天）
GET https://api.coingecko.com/api/v3/coins/bitcoin/market_chart
  ?vs_currency=usd
  &days=365
  &interval=daily

# 返回字段：prices / market_caps / total_volumes
# prices[i] = [timestamp_ms, price]`}</CodeBlock>
      </RuleCard>
    </Section>
  </div>
);

export default Volatility;
