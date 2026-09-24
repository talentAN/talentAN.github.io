import React, { useState } from 'react';
import { getPositionRisk, getPositionMode } from '@root/src/container/binance/api/query';
import { getContracts } from '@root/src/container/binance/api';
import { placeFutureQtyTakeProfitAlgo } from '@root/src/container/binance/api/order';

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

const TakeProfitCalculator = ({ docked = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState(loadPos);
  const [symbol, setSymbol] = useState('');
  const [open, setOpen] = useState('');
  const [status, setStatus] = useState('输入币对和标记日开仓价');
  const [orders, setOrders] = useState([]);
  const [drag, setDrag] = useState(null);

  const startDrag = event => {
    if (docked) return;
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
    const cleanSymbol = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const openPrice = Number(open);
    if (!cleanSymbol || !(openPrice > 0)) {
      setStatus('请填写币对和有效的标记日开仓价');
      return;
    }
    setStatus('查询仓位中…');
    try {
      const [positions, mode, rules] = await Promise.all([
        getPositionRisk({ symbol: cleanSymbol }),
        getPositionMode(),
        getRules(cleanSymbol),
      ]);
      if (!positions?.ok) {
        const msg =
          positions?.response?.msg ||
          positions?.response?.message ||
          positions?.error ||
          `HTTP ${positions?.httpStatus ?? '?'}`;
        setStatus(`查询仓位失败：${msg}`);
        setOrders([]);
        return;
      }
      const list = Array.isArray(positions.response) ? positions.response : [];
      const short = list.find(item => {
        const amt = Number(item.positionAmt || 0);
        return item.symbol === cleanSymbol && (item.positionSide === 'SHORT' || amt < 0);
      });
      const qty = Math.abs(Number(short?.positionAmt || 0));
      if (!(qty > 0)) {
        const long = list.find(item => {
          const amt = Number(item.positionAmt || 0);
          return item.symbol === cleanSymbol && (item.positionSide === 'LONG' || amt > 0);
        });
        if (long && Math.abs(Number(long.positionAmt || 0)) > 0) {
          setStatus(`找到 ${cleanSymbol} 多仓，本工具只挂空仓止盈`);
        } else {
          const sides = list
            .filter(item => item.symbol === cleanSymbol)
            .map(item => `${item.positionSide || '?'}:${item.positionAmt}`)
            .join(', ');
          setStatus(
            sides
              ? `未找到空仓（接口返回：${sides}）`
              : `未找到 ${cleanSymbol} 持仓（接口无该币对仓位）`
          );
        }
        setOrders([]);
        return;
      }
      const hedgeMode = Boolean(mode?.response?.dualSidePosition);
      const planned = TARGETS.map(target => {
        const price = quantizePrice(openPrice * target.mult, rules.tickSize, rules.pricePrecision);
        const quantity = quantizeDown(qty * target.ratio, rules.stepSize, rules.quantityPrecision);
        return { ...target, price, quantity };
      }).filter(item => item.quantity > 0 && !(rules.minQty > 0 && item.quantity < rules.minQty));
      if (!planned.length) {
        setStatus('按合约精度换算后没有可提交档位');
        setOrders([]);
        return;
      }
      setStatus('提交止盈条件单…');
      const results = [];
      for (const target of planned) {
        try {
          const result = await placeFutureQtyTakeProfitAlgo({
            symbol: cleanSymbol,
            side: 'BUY',
            quantity: target.quantity,
            triggerPrice: target.price,
            ...(hedgeMode ? { positionSide: 'SHORT' } : {}),
            clientAlgoId: `tp${Date.now()}${String(target.mult).replace('.', '')}`,
          });
          results.push({
            ...target,
            status: result.ok ? 'submitted' : 'rejected',
            error: result.response?.msg || result.response?.message || result.error,
          });
        } catch (error) {
          results.push({ ...target, status: 'unknown', error: error.message });
        }
      }
      setOrders(results);
      setStatus(
        `${results.filter(item => item.status === 'submitted').length}/${results.length} 档止盈条件单已提交，剩余20%不挂单`
      );
    } catch (error) {
      setStatus(`查询或提交失败：${error.message}`);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="qc-tool-chip qc-tool-chip--tp"
        onClick={() => setExpanded(true)}
        title="打开止盈计算器"
        style={docked ? undefined : {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1001,
          height: 40,
          padding: '0 14px',
          borderRadius: 20,
          fontSize: 13,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}
      >
        止盈
        <span className="qc-tool-chip__muted">计算器</span>
      </button>
    );
  }

  return (
    <>
      {docked && (
        <button
          type="button"
          className="qc-tool-chip qc-tool-chip--tp is-open"
          onClick={() => setExpanded(false)}
          title="收起止盈计算器"
        >
          止盈
          <span className="qc-tool-chip__muted">计算器</span>
        </button>
      )}
      <div
        className={docked ? 'qc-tool-panel qc-tool-panel--tp' : undefined}
        style={docked ? undefined : {
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: PANEL_W,
          maxHeight: '70vh',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: '#fff',
          border: '1px solid #91caff',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
      <div
        onPointerDown={startDrag}
        style={{
          background: '#e6f4ff',
          padding: '10px 12px',
          fontSize: 11,
          color: '#0958d9',
          lineHeight: 1.5,
          borderBottom: '1px solid #91caff',
          cursor: docked ? 'default' : 'grab',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>止盈计算器</div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#8c8c8c',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
            title="收起"
          >
            −
          </button>
        </div>
        <div style={{ color: '#595959', fontSize: 11 }}>Binance 空仓市价止盈 · 25% / 30% / 25%</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px', maxHeight: 'calc(70vh - 72px)', touchAction: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <input
            value={symbol}
            onChange={event => setSymbol(event.target.value)}
            placeholder="币对"
            style={{
              width: 78,
              minWidth: 0,
              height: 28,
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              padding: '0 7px',
              fontSize: 12,
              color: '#262626',
              outline: 'none',
            }}
          />
          <input
            value={open}
            onChange={event => setOpen(event.target.value)}
            placeholder="标记日开仓价"
            type="number"
            style={{
              flex: 1,
              width: 0,
              height: 28,
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              padding: '0 7px',
              fontSize: 12,
              color: '#262626',
              outline: 'none',
            }}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          style={{
            width: '100%',
            height: 30,
            border: '1px solid #91caff',
            borderRadius: 4,
            background: '#e6f4ff',
            color: '#0958d9',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          查询并挂止盈条件单
        </button>
        <div
          style={{
            marginTop: 6,
            padding: '6px 8px',
            borderRadius: 4,
            background: '#fafafa',
            color: '#8c8c8c',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {status}
        </div>
        {orders.map(order => (
          <div
            key={order.mult}
            style={{
              marginTop: 6,
              padding: '6px 8px',
              border: `1px solid ${order.status === 'submitted' ? '#b7eb8f' : '#ffa39e'}`,
              borderRadius: 6,
              background: order.status === 'submitted' ? '#f6ffed' : '#fff1f0',
              fontSize: 11,
              color: order.status === 'submitted' ? '#389e0d' : '#cf1322',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <strong>
                {order.mult}O · {order.ratio * 100}%
              </strong>
              <span>
                {order.status === 'submitted'
                  ? '已提交'
                  : order.status === 'skipped'
                    ? '已跳过'
                    : order.status === 'unknown'
                      ? '待确认'
                      : '失败'}
              </span>
            </div>
            <div style={{ marginTop: 2, color: '#595959' }}>
              价格 {order.price} · 数量 {order.quantity}
            </div>
            {order.error && <div style={{ marginTop: 2 }}>{order.error}</div>}
          </div>
        ))}
      </div>
      </div>
    </>
  );
};

export default TakeProfitCalculator;
