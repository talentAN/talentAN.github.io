import React, { useEffect, useRef, useState } from 'react';

const POS_KEY = 'high100-flow-map-pos-v3';
const EXPANDED_KEY = 'high100-flow-map-expanded';
const PANEL_W = 360;
const COLLAPSED_W = 126;
const PANEL_H = 620;

const phases = [
  {
    title: '1. 全市场扫描',
    color: '#1677ff',
    steps: [
      '获取 Binance / Bitget 合约交易对列表。',
      '逐币对拉取完整日 K，分页扫描并处理限频、失败记录。',
      '逐根日 K 识别候选标记日。',
    ],
  },
  {
    title: '2. high100 筛选',
    color: '#d46b08',
    steps: [
      '日内最高价 high 严格大于开盘价 open × 2（涨幅严格超过 100%）。',
      '上市未满 30 天 → 排除。',
      '当日最高价属于历史新高突破 → 排除。',
      '保留标记日：记录 open、high、涨幅和成功线（open × 2）。',
    ],
  },
  {
    title: '3. 开仓前风控',
    color: '#531dab',
    steps: [
      '自动下单开关已开启且交易 session 已解锁。',
      '查询当前持仓和未成交委托；任一存在 → 跳过。',
      '查询资金费率：低于 -1% → 跳过；等于 -1% → 允许。',
      '资金费率缺失或查询失败 → 继续下单，仅记录查询异常。',
    ],
  },
  {
    title: '4. 阶梯挂空单',
    color: '#eb2f96',
    steps: [
      '按 open × 2.0 / 2.4 / 3.0 / 4.0 计算卖出限价空单。',
      '开仓价格按 tick 向上对齐，数量按 step 向下对齐。',
      '低于最小数量或最小名义金额的档位跳过。',
      '使用 post-only / GTX，避免订单主动吃单。',
      '按 clientOid 匹配 submitted、rejected、skipped、unknown、partial。',
    ],
  },
  {
    title: '5. 持仓管理与离场',
    color: '#389e0d',
    steps: [
      '止损：现价 ≥ open × 5.0。',
      '止盈：现价 ≤ open × 1.4。',
      '结构失效：现价重新突破触发时结构高点。',
      '触发后买入市价单平空，平仓数量按市场步长向下对齐。',
      '平仓成功才标记 closed；失败或未知保留风险状态。',
    ],
  },
];

const defaultPos = () => ({
  x: Math.max(0, window.innerWidth - COLLAPSED_W),
  y: 0,
});

const loadPos = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
  } catch (_) {
    /* ignore */
  }
  return defaultPos();
};

const clampPos = (x, y, width, height) => ({
  x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - width)),
  y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - height)),
});

const High100FlowMap = () => {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 16 });
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  useEffect(() => {
    setPos(loadPos());
    setExpanded(localStorage.getItem(EXPANDED_KEY) === '1');
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPos(current => {
        const next = clampPos(current.x, current.y, expanded ? PANEL_W : COLLAPSED_W, expanded ? PANEL_H : 42);
        localStorage.setItem(POS_KEY, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [expanded]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
    setPos(current => {
      const nextX = !expanded && current.x >= window.innerWidth - COLLAPSED_W - 4
        ? window.innerWidth - PANEL_W
        : current.x;
      const clamped = clampPos(nextX, current.y, next ? PANEL_W : COLLAPSED_W, next ? PANEL_H : 42);
      localStorage.setItem(POS_KEY, JSON.stringify(clamped));
      return clamped;
    });
  };

  const startDrag = event => {
    if (event.target.closest('button') && expanded) return;
    event.preventDefault();
    movedRef.current = false;
    const origin = { ...pos };
    dragRef.current = { startX: event.clientX, startY: event.clientY, x: origin.x, y: origin.y };
    const onMove = moveEvent => {
      if (!dragRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      const next = clampPos(
        dragRef.current.x + dx,
        dragRef.current.y + dy,
        expanded ? PANEL_W : COLLAPSED_W,
        expanded ? PANEL_H : 42
      );
      setPos(next);
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="展开 high100 路径图"
        onPointerDown={startDrag}
        onClick={() => !movedRef.current && toggleExpanded()}
        style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1001, height: 40, padding: '0 14px', border: '1px solid #91caff', borderRadius: 20, background: '#e6f4ff', color: '#0958d9', fontSize: 12, fontWeight: 700, cursor: 'grab', boxShadow: '0 4px 14px rgba(0,0,0,.14)', userSelect: 'none', touchAction: 'none' }}
      >
        high100 路径图
      </button>
    );
  }

  return (
    <section
      aria-label="high100 筛选与下单路径图"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1001, width: PANEL_W, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #91caff', borderRadius: 10, background: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.18)' }}
    >
      <header onPointerDown={startDrag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#e6f4ff', borderBottom: '1px solid #bae0ff', color: '#0958d9', cursor: 'grab', userSelect: 'none' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>high100 筛选 · 下单路径</div>
          <div style={{ marginTop: 2, color: '#597ef7', fontSize: 10 }}>涨幅超过开盘价 2 倍的策略流程</div>
        </div>
        <button type="button" aria-label="收起 high100 路径图" onClick={toggleExpanded} style={{ border: 0, background: 'transparent', color: '#1677ff', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>−</button>
      </header>
      <div style={{ overflowY: 'auto', padding: '10px 12px 14px' }}>
        {phases.map((phase, phaseIndex) => (
          <div key={phase.title} style={{ position: 'relative', padding: '0 0 12px 24px' }}>
            {phaseIndex < phases.length - 1 && <div style={{ position: 'absolute', left: 7, top: 20, bottom: 0, width: 2, background: '#d9d9d9' }} />}
            <div style={{ position: 'absolute', left: 0, top: 1, width: 16, height: 16, borderRadius: 8, background: phase.color, boxShadow: '0 0 0 3px #fff' }} />
            <div style={{ color: phase.color, fontSize: 12, fontWeight: 700 }}>{phase.title}</div>
            <ul style={{ margin: '5px 0 0', paddingLeft: 14, color: '#595959', fontSize: 11, lineHeight: 1.55 }}>
              {phase.steps.map(step => <li key={step} style={{ marginBottom: 3 }}>{step}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};

export default High100FlowMap;
