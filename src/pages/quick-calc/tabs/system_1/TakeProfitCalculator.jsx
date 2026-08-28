import React, { useState } from 'react';
import { getPositionRisk, getPositionMode } from '@root/src/container/binance/api/query';
import { getContracts } from '@root/src/container/binance/api';
import { placeFutureLimitOrder } from '@root/src/container/binance/api/order';

const PANEL_W = 220;
const POS_KEY = 'take-profit-calculator-pos';
const TARGETS = [
  { mult: 1.6, ratio: 0.25 },
  { mult: 1.4, ratio: 0.30 },
  { mult: 1.0, ratio: 0.25 },
];

const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
const quantizeDown = (value, step, digits = 8) => {
  if (!(value > 0)) return 0;
  if (!(step > 0)) return round(value, digits);
  return round(Math.floor(value / step + 1e-10) * step, digits);
};
const quantizePrice = (value, tick, digits = 8) => {
  if (!(value > 0)) return 0;
  if (!(tick > 0)) return round(value, digits);
  return round(Math.floor(value / tick + 1e-10) * tick, digits);
};

const loadPos = () => {
  if (typeof window === 'undefined') return { x: 16, y: 410 };
  try {
    const value = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) return value;
  } catch (_) {
    /* ignore */
  }
  return { x: 16, y: 410 };
};

const getRules = async symbol => {
  const contracts = await getContracts();
  const contract = contracts.find(item => item.symbol === symbol);
  const filters = Array.isArray(contract?.filters) ? contract.filters : [];
  const find = type => filters.find(item => item.filterType === type);
  const price = find('PRICE_FILTER');
  const lot = find('LOT_SIZE');
  return {
    tickSize: Number(price?.tickSize) || null,
    stepSize: Number(lot?.stepSize) || null,
    minQty: Number(lot?.minQty) || null,
    pricePrecision: contract?.pricePrecision ?? 8,
    quantityPrecision: contract?.quantityPrecision ?? 8,
  };
};

const clamp = (x, y) => ({
  x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - PANEL_W)),
  y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 80)),
});

const TakeProfitCalculator = () => {
  const [expanded, setExpanded] = useState(true);
  const [pos, setPos] = useState(loadPos);
  const [symbol, setSymbol] = useState('');
  const [open, setOpen] = useState('');
  const [status, setStatus] = useState('输入币对和标记日开仓价');
  const [orders, setOrders] = useState([]);
  const [drag, setDrag] = useState(null);

  const startDrag = event => {
    if (event.target.closest('input,button')) return;
    event.preventDefault();
    const origin = { ...pos, x0: event.clientX, y0: event.clientY };
    setDrag(origin);
    const move = next => setPos(clamp(origin.x + next.clientX - origin.x0, origin.y + next.clientY - origin.y0));
    const up = () => {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const submit = async () => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const markerOpen = Number(open);
    if (!normalizedSymbol || !(markerOpen > 0)) {
      setStatus('请输入有效的币对和开仓价');
      return;
    }
    setStatus('查询持仓和交易规则…');
    setOrders([]);
    try {
      const [{ response: positionResponse }, [rules, modeResult]] = await Promise.all([
        getPositionRisk({ symbol: normalizedSymbol }),
        Promise.all([getRules(normalizedSymbol), getPositionMode()]),
      ]);
      const positions = Array.isArray(positionResponse) ? positionResponse : [];
      const position = positions.find(item => Math.abs(Number(item.positionAmt || 0)) > 0);
      if (!position) {
        setStatus('当前没有持仓，未提交止盈委托');
        return;
      }
      const amount = Number(position.positionAmt);
      if (!(amount < 0)) {
        setStatus('当前是多仓，本计算器只处理空仓止盈');
        return;
      }
      const totalQty = Math.abs(amount);
      const hedgeMode = modeResult?.response?.dualSidePosition === true;
      const plan = TARGETS.map(target => ({
        ...target,
        price: quantizePrice(markerOpen * target.mult, rules.tickSize, rules.pricePrecision),
        quantity: quantizeDown(totalQty * target.ratio, rules.stepSize, rules.quantityPrecision),
      })).map(target => ({
        ...target,
        valid: target.quantity > 0 && (!rules.minQty || target.quantity >= rules.minQty),
      }));
      const results = [];
      for (const target of plan) {
        if (!target.valid) {
          results.push({ ...target, status: 'skipped', error: '数量低于交易所最小下单量' });
          continue;
        }
        try {
          const result = await placeFutureLimitOrder({
            symbol: normalizedSymbol,
            side: 'BUY',
            price: target.price,
            quantity: target.quantity,
            timeInForce: 'GTX',
            reduceOnly: !hedgeMode,
            ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
            newClientOrderId: `tp${Date.now()}${target.mult}`,
          });
          results.push({ ...target, status: result.ok ? 'submitted' : 'rejected', error: result.response?.msg });
        } catch (error) {
          results.push({ ...target, status: 'unknown', error: error.message });
        }
      }
      setOrders(results);
      setStatus(`${results.filter(item => item.status === 'submitted').length}/${results.length} 档止盈委托已提交，剩余20%不挂单`);
    } catch (error) {
      setStatus(`查询或提交失败：${error.message}`);
    }
  };

  const header = (
      <div onPointerDown={startDrag} style={{ background: '#e6f4ff', padding: '10px 12px', fontSize: 11, color: '#0958d9', lineHeight: 1.5, borderBottom: '1px solid #91caff', cursor: 'grab' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>止盈计算器</div>
          <button type="button" onClick={() => setExpanded(value => !value)} style={{ border: 'none', background: 'transparent', color: '#595959', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }} title={expanded ? '收起' : '展开'}>{expanded ? '−' : '+'}</button>
        </div>
        {expanded && <div style={{ color: '#595959', fontSize: 11 }}>Binance 空仓 · 25% / 30% / 25%</div>}
      </div>
  );

  return (
    <div style={{ position: 'fixed', left: pos.x, top: pos.y, width: PANEL_W, maxHeight: '70vh', zIndex: 1001, display: 'flex', flexDirection: 'column', gap: 8, background: '#fff', border: '1px solid #91caff', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', overflow: 'hidden', userSelect: 'none', touchAction: 'none' }}>
      {header}
      {expanded && <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px', maxHeight: 'calc(70vh - 72px)', touchAction: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="币对" style={{ width: 78, minWidth: 0, height: 28, border: '1px solid #d9d9d9', borderRadius: 4, padding: '0 7px', fontSize: 12, color: '#262626', outline: 'none' }} />
          <input value={open} onChange={event => setOpen(event.target.value)} placeholder="标记日开仓价" type="number" style={{ flex: 1, width: 0, height: 28, border: '1px solid #d9d9d9', borderRadius: 4, padding: '0 7px', fontSize: 12, color: '#262626', outline: 'none' }} />
        </div>
        <button type="button" onClick={submit} style={{ width: '100%', height: 30, border: '1px solid #91caff', borderRadius: 4, background: '#e6f4ff', color: '#0958d9', fontSize: 12, cursor: 'pointer' }}>查询并挂止盈</button>
        <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: '#fafafa', color: '#8c8c8c', fontSize: 11, lineHeight: 1.4 }}>{status}</div>
        {orders.map(order => <div key={order.mult} style={{ marginTop: 6, padding: '6px 8px', border: `1px solid ${order.status === 'submitted' ? '#b7eb8f' : '#ffa39e'}`, borderRadius: 6, background: order.status === 'submitted' ? '#f6ffed' : '#fff1f0', fontSize: 11, color: order.status === 'submitted' ? '#389e0d' : '#cf1322' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><strong>{order.mult}O · {order.ratio * 100}%</strong><span>{order.status === 'submitted' ? '已提交' : order.status === 'skipped' ? '已跳过' : order.status === 'unknown' ? '待确认' : '失败'}</span></div>
          <div style={{ marginTop: 2, color: '#595959' }}>价格 {order.price} · 数量 {order.quantity}</div>
          {order.error && <div style={{ marginTop: 2 }}>{order.error}</div>}
        </div>)}
      </div>}
    </div>
  );
};

export default TakeProfitCalculator;
