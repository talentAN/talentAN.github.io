import React from 'react';
import { Divider, Table, Tag, Typography } from 'antd';
import {
  SUCCESS_V01,
  UNIVERSE_V01,
  BASE_RATE_V01,
  SOIL_V01,
} from './patternV01';

const { Title, Paragraph, Text } = Typography;
const pct = value => `${(value * 100).toFixed(0)}%`;

const Rules = () => (
  <div style={{ padding: '8px 4px 24px', maxWidth: 920 }}>
    <Typography>
      <Title level={3} style={{ marginBottom: 4 }}>横盘抬头 · 研究框架</Title>
      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        状态：<Tag color="green">关键结论已冻结</Tag>
        {' '}
        <Text code>{UNIVERSE_V01.version}</Text>
        {' · '}
        <Text code>{SUCCESS_V01.version}</Text>
        {' · '}
        <Text code>{BASE_RATE_V01.version}</Text>
        {' · '}
        <Text code>{SOIL_V01.version}</Text>
      </Paragraph>
      <Paragraph style={{ borderLeft: '4px solid #389e0d', paddingLeft: 12, color: '#595959' }}>
        流程：<Text code>{SOIL_V01.workflow}</Text>
        （土壤只进观察池；开仓触发另定；回测只评开仓日）。
        成功标签与做空 <Text code>pump100 / high100</Text> 脱钩。
      </Paragraph>

      <Divider />

      <Title level={4}>〇、关键结论（已冻结）</Title>
      <Paragraph>
        <Text strong>1. 合约池</Text>
      </Paragraph>
      <ul>
        <li>{UNIVERSE_V01.contractType} · 状态 <Text code>{UNIVERSE_V01.status}</Text></li>
        <li>
          上市 ≥ <Text code>{UNIVERSE_V01.minListingDays}</Text> 天
        </li>
        <li>
          流动性：<Text type="secondary">本版暂不设 quoteVolume 门槛（已知缺口）</Text>
        </li>
      </ul>

      <Paragraph>
        <Text strong>2. 成功事件与可交易性</Text>
      </Paragraph>
      <ul>
        <li>开仓价 = 判定日 <Text code>close</Text></li>
        <li>
          主标签：其后 {SUCCESS_V01.primaryHorizon} 日
          {' '}<Text code>max(high)/entry − 1 ≥ {pct(SUCCESS_V01.primaryThreshold)}</Text>
          （摸到）
        </li>
        <li>
          并列必报：同窗先触及 <Text code>{pct(SUCCESS_V01.stopLossRet)}</Text> 止损比例
          （同日双触保守计先止损）
        </li>
        <li>样本起点 ≥ <Text code>{SUCCESS_V01.triggerStartDate}</Text></li>
      </ul>

      <Paragraph>
        <Text strong>3. 基率</Text>
        {' '}
        <Text code>{BASE_RATE_V01.version}</Text>
      </Paragraph>
      <ul>
        <li>单位：合格币对 × 判定日，等权</li>
        <li>
          实测主基率 ≈ <Text strong>{pct(BASE_RATE_V01.measuredBaseRate)}</Text>
          （模式纯度须相对此值比较）
        </li>
      </ul>

      <Paragraph>
        <Text strong>4. 观察土壤三型</Text>
        {' '}
        <Text code>{SOIL_V01.version}</Text>
        {' '}
        <Tag color="blue">只观察，不开仓</Tag>
      </Paragraph>
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        style={{ marginBottom: 8 }}
        columns={[
          { title: '代码', dataIndex: 'key', width: 180, render: key => <Text code>{key}</Text> },
          { title: '名称', dataIndex: 'label', width: 140 },
          { title: '类别', dataIndex: 'kind', width: 120, render: kind => (kind === 'base_build' ? '打底/修复' : '续行观察') },
          { title: '含义', dataIndex: 'oneLiner' },
        ]}
        dataSource={SOIL_V01.types}
      />
      <ul>
        <li>
          主土壤：
          {SOIL_V01.types.map(t => (
            <Text code key={t.key} style={{ marginRight: 8 }}>{t.key}</Text>
          ))}
        </li>
        <li>
          <Text strong>BOX / RECOVERING</Text> 与 <Text strong>EXTENDED</Text> 机制不同：
          观察名单可合并，开仓触发与回测须分列统计
        </li>
        <li>
          不进主土壤：
          {SOIL_V01.excludedAsPrimarySoil.map(key => (
            <Text code key={key} style={{ marginRight: 6 }}>{key}</Text>
          ))}
        </li>
      </ul>

      <Divider />

      <Title level={4}>一、使用约定</Title>
      <ul>
        <li>K 线：Binance USDT 永续 · 日线 · UTC</li>
        <li>成交额：<Text code>quoteVolume</Text> = USDT 成交额</li>
        <li>禁止未来函数：土壤/触发判定只用当日及之前</li>
        <li>土壤日 ≠ 开仓日；人工偏好是「抬头/突破确认」后再谈入场</li>
      </ul>

      <Title level={4}>二、本版明确不做</Title>
      <ul>
        <li>旧 v0.1～v0.4 故事主干与 hit 公式（已撤出本页）</li>
        <li>把土壤日直接当开仓触发做纯度验收</li>
        <li>入场细则 / 止损止盈 / 自动下单（下一阶段）</li>
      </ul>

      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        样例抽检见「候选分型」页；数据在
        {' '}
        <Text code>src/data/market/binance/bullish-base-rate/</Text>
      </Paragraph>
    </Typography>
  </div>
);

export default Rules;
