import React, { useState } from 'react';
import { Button, Alert, Typography } from 'antd';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const { Text } = Typography;

// ─── 数据获取（Bitget 合约历史K线，日线，最大查询 90 天，分 5 批拉取 365 天）────────────────
const fetchBtcOhlc = async () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const batchDays = 80;
  const batches = Math.ceil(365 / batchDays);

  const requests = Array.from({ length: batches }, (_, i) => {
    const endTime   = now - i * batchDays * day;
    const startTime = endTime - batchDays * day;
    return fetch(
      `https://api.bitget.com/api/v2/mix/market/history-candles` +
      `?symbol=BTCUSDT&granularity=1D&limit=200&productType=usdt-futures` +
      `&startTime=${startTime}&endTime=${endTime}`
    ).then(r => r.json());
  });

  const results = await Promise.all(requests);
  const rows = results.flatMap(res => res.data || []);

  const seen = new Set();
  return rows
    .filter(r => { if (seen.has(r[0])) return false; seen.add(r[0]); return true; })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(r => ({
      date:  new Date(Number(r[0])).toISOString().slice(0, 10),
      open:  parseFloat(r[1]),
      high:  parseFloat(r[2]),
      low:   parseFloat(r[3]),
      close: parseFloat(r[4]),
    }));
};

// ─── Garman-Klass 单日方差 ───────────────────────────────────────────────────
// σ²_GK = 0.5·(ln H/L)² - (2·ln2 - 1)·(ln C/O)²
const gkVariance = ({ open, high, low, close }) => {
  const hl = Math.log(high / low);
  const co = Math.log(close / open);
  return 0.5 * hl * hl - (2 * Math.LN2 - 1) * co * co;
};

// ─── 滚动波动率（同时返回年化和日波动率）────────────────────────────────────
const rollingGkVol = (candles, window) =>
  candles.map((_, i) => {
    if (i < window - 1) return null;
    const slice = candles.slice(i - window + 1, i + 1);
    const avgVar = slice.reduce((s, c) => s + gkVariance(c), 0) / window;
    return {
      annual: parseFloat((Math.sqrt(avgVar * 252) * 100).toFixed(2)), // 年化 %
      daily:  parseFloat((Math.sqrt(avgVar) * 100).toFixed(2)),       // 日 %
    };
  });

// ─── BOCPD（Normal-Gamma 共轭先验，输入 GK 日方差）──────────────────────────
const bocpd = (data, hazard = 1 / 250) => {
  const n = data.length;
  const kappa0 = 1, alpha0 = 2;

  // 初始先验用前 30 天均值
  const initMu = data.slice(0, Math.min(30, n)).reduce((a, b) => a + b, 0) / Math.min(30, n);
  const initBeta = initMu * 0.5;

  let R = [1.0];
  let muArr = [initMu], kappaArr = [kappa0], alphaArr = [alpha0], betaArr = [initBeta];
  const cpProbs = new Array(n).fill(0);

  for (let t = 0; t < n; t++) {
    const x = data[t];
    const lenR = R.length;

    const predProbs = R.map((_, l) => {
      const kl = kappaArr[l], al = alphaArr[l], bl = betaArr[l], ml = muArr[l];
      const nu = 2 * al;
      const scale2 = bl * (kl + 1) / (al * kl);
      const diff = x - ml;
      const logp =
        lgamma(nu / 2 + 0.5) - lgamma(nu / 2) -
        0.5 * Math.log(Math.PI * nu * scale2) -
        (nu / 2 + 0.5) * Math.log(1 + diff * diff / (nu * scale2));
      return Math.exp(Math.max(logp, -700));
    });

    const newR = new Array(lenR + 1).fill(0);
    for (let l = 0; l < lenR; l++) {
      const mass = R[l] * predProbs[l];
      newR[l + 1] += mass * (1 - hazard);
      newR[0]     += mass * hazard;
    }
    const norm = newR.reduce((a, b) => a + b, 0) || 1;
    for (let l = 0; l <= lenR; l++) newR[l] /= norm;

    // 先验均值用当前点前 30 天滚动均值，让先验贴近当前状态
    const lookback = Math.min(30, t + 1);
    const mu0 = data.slice(t - lookback + 1, t + 1).reduce((a, b) => a + b, 0) / lookback;
    const beta0 = mu0 * 0.5; // beta0 随均值自适应，避免固定先验
    const newMu = [mu0], newKappa = [kappa0], newAlpha = [alpha0], newBeta = [beta0];
    for (let l = 0; l < lenR; l++) {
      const kl = kappaArr[l], al = alphaArr[l], bl = betaArr[l], ml = muArr[l];
      const kn = kl + 1;
      newKappa.push(kn);
      newAlpha.push(al + 0.5);
      newMu.push((kl * ml + x) / kn);
      newBeta.push(bl + (kl * (x - ml) ** 2) / (2 * kn));
    }

    R = newR; muArr = newMu; kappaArr = newKappa; alphaArr = newAlpha; betaArr = newBeta;
    cpProbs[t] = newR[0];
  }
  return cpProbs;
};

const lgamma = x => {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────
const VolatilityCalc = () => {
  const [chartData, setChartData]       = useState([]);
  const [changepoints, setChangepoints] = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [stats, setStats]               = useState(null);

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const candles = await fetchBtcOhlc();
      if (candles.length < 30) throw new Error('K线数据不足，请稍后重试');

      const vols20 = rollingGkVol(candles, 20);
      const vols60 = rollingGkVol(candles, 60);
      const gkVars = candles.map(gkVariance);
      const cpProbs = bocpd(gkVars);

      const cpDates = candles
        .filter((_, i) => cpProbs[i] > 0.25)
        .map(c => c.date);
      setChangepoints(cpDates);

      const merged = candles.map((c, i) => ({
        date:         c.date,
        annual20:     vols20[i]?.annual ?? null,
        daily20:      vols20[i]?.daily  ?? null,
        annual60:     vols60[i]?.annual ?? null,
        daily60:      vols60[i]?.daily  ?? null,
        cp:           parseFloat((cpProbs[i] * 100).toFixed(2)),
        price:        parseFloat(c.close.toFixed(0)),
      })).filter(d => d.annual20 != null);

      setChartData(merged);

      const annuals = merged.map(d => d.annual20);
      const sorted  = [...annuals].sort((a, b) => a - b);
      const median  = sorted[Math.floor(sorted.length / 2)];
      const recent90 = annuals.slice(-90);
      const recentMedian = [...recent90].sort((a, b) => a - b)[Math.floor(recent90.length / 2)];
      const last = merged[merged.length - 1];

      setStats({
        annual20:     last.annual20.toFixed(1),
        daily20:      last.daily20.toFixed(2),
        annual60:     last.annual60?.toFixed(1) ?? '-',
        daily60:      last.daily60?.toFixed(2)  ?? '-',
        recentMedian: recentMedian.toFixed(1),
        median:       median.toFixed(1),
        cpCount:      cpDates.length,
        dataLen:      candles.length,
      });
    } catch (e) {
      setError('获取数据失败：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>BTC/USDT 波动率分析</span>
        <Button type="primary" onClick={run} loading={loading}>
          {chartData.length ? '重新计算' : '开始计算'}
        </Button>
        {stats && <span style={{ fontSize: 12, color: '#999' }}>共 {stats.dataLen} 根日K · Garman-Klass</span>}
      </div>

      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: '20日年化波动率', value: stats.annual20 + '%' },
            { label: '20日日波动率',   value: stats.daily20  + '%' },
            { label: '60日年化波动率', value: stats.annual60 + '%' },
            { label: '60日日波动率',   value: stats.daily60  + '%' },
            { label: '近3月年化中位数', value: stats.recentMedian + '%', hint: '当前中间态' },
            { label: '全年年化中位数',  value: stats.median + '%' },
            { label: 'BOCPD 变点数',   value: stats.cpCount + ' 个' },
          ].map((item, i) => (
            <div key={i} style={{
              background: '#fafafa', border: '1px solid #f0f0f0',
              borderRadius: 6, padding: '10px 18px', minWidth: 150,
            }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
                {item.label}
                {item.hint && <Text type="success" style={{ marginLeft: 4, fontSize: 11 }}>({item.hint})</Text>}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {changepoints.length > 0 && (
        <div style={{ marginBottom: 16, fontSize: 12, color: '#666' }}>
          <Text strong>变点日期（概率 {'>'} 25%）：</Text>
          {changepoints.map(d => (
            <span key={d} style={{
              display: 'inline-block', margin: '2px 4px', padding: '1px 8px',
              background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4,
            }}>{d}</span>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <>
          {/* 年化波动率图 */}
          <div style={{ marginBottom: 8, fontSize: 12, color: '#999' }}>年化波动率（GK）& BOCPD 变点概率</div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={8} tickFormatter={d => d.slice(5)} />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} unit="%" domain={['auto', 'auto']} />
              <YAxis yAxisId="cp" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
              <Tooltip labelFormatter={l => '日期: ' + l} formatter={(v, name) => [v + '%', name]} />
              <Legend />
              <Bar yAxisId="cp" dataKey="cp" name="变点概率" fill="#ffd591" opacity={0.5} />
              <Line yAxisId="vol" dataKey="annual20" name="20日年化" dot={false} stroke="#1890ff" strokeWidth={2} />
              <Line yAxisId="vol" dataKey="annual60" name="60日年化" dot={false} stroke="#722ed1" strokeWidth={1.5} strokeDasharray="4 2" />
              {changepoints.map(d => (
                <ReferenceLine key={d} yAxisId="vol" x={d} stroke="#f5222d" strokeDasharray="4 2" strokeWidth={1} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {/* 日波动率图 */}
          <div style={{ marginTop: 20, marginBottom: 8, fontSize: 12, color: '#999' }}>日波动率（GK）</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={8} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} unit="%" domain={['auto', 'auto']} />
              <Tooltip labelFormatter={l => '日期: ' + l} formatter={(v, name) => [v + '%', name]} />
              <Legend />
              <Line dataKey="daily20" name="20日日波动率" dot={false} stroke="#13c2c2" strokeWidth={2} />
              <Line dataKey="daily60" name="60日日波动率" dot={false} stroke="#fa8c16" strokeWidth={1.5} strokeDasharray="4 2" />
              {changepoints.map(d => (
                <ReferenceLine key={d} x={d} stroke="#f5222d" strokeDasharray="4 2" strokeWidth={1} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {/* 价格走势 */}
          <div style={{ marginTop: 20, marginBottom: 8, fontSize: 12, color: '#999' }}>BTC 价格走势</div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickCount={8} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
              <Tooltip formatter={v => ['$' + v.toLocaleString(), 'BTC']} labelFormatter={l => '日期: ' + l} />
              <Line dataKey="price" name="收盘价" dot={false} stroke="#52c41a" strokeWidth={2} />
              {changepoints.map(d => (
                <ReferenceLine key={d} x={d} stroke="#f5222d" strokeDasharray="4 2" strokeWidth={1} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
};

export default VolatilityCalc;
