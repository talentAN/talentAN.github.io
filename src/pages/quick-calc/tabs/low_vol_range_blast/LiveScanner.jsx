import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, Modal, Select, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getMergedTradingPairs, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import DataList from '../system_1/_DataList';
import TradeUnlockPrompt from '../system_1/TradeUnlockPrompt';
import * as s from '../system_1/pairSelector.module.less';
import {
  LOW_VOL_RANGE_BLAST_V01,
  findActiveLowVolRanges,
} from '../backtest/_lowVolRangeBlastRules';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import { filterBlacklistedPairs } from '../_symbolBlacklist';
import {
  OPEN_NOTIONAL_MULT,
  fetchLiveOrderStatusMaps,
  placeBreakoutTriggerOrder,
  placeBreakoutTriggerOrdersBatch,
  resolveOpenNotionalUsdt,
} from './_breakoutOrder';
import {
  STRATEGY3_EXIT,
  fetchLongPosition,
  placeStrategy3ExitOrders,
  placeStrategy3ExitOrdersBatch,
} from './_strategy3ExitOrders';
import { isLiveOrderEnabled, SKIP_REASON_LABEL } from '../system_1/_autoOrderModel';
import {
  RANGE_LOOKBACK_DAYS,
  RANGE_RECENT_DAYS,
  fetchLookbackCandles,
} from './_rangeScan';
import { RANGE_MONITOR_SCAN_MAX_RANGE_MULT } from './_rangeMonitorParams';

// 等待指定毫秒，控制批量扫描和下单请求节奏。
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// 返回交易所与币对组成的唯一标识，用于去重和状态映射。
const pairIdOf = row => `${row.exchange}:${row.symbol}`;
// 按价格数量级格式化价格，异常值显示占位符。
const fmtPrice = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number >= 1000) return number.toFixed(2);
  if (number >= 1) return number.toFixed(4);
  return number.toPrecision(5);
};

/**
 * 实盘：低波动横盘暴涨 · 币对筛选
 * 口径对齐回测横盘；只要最近 3 天里至少 1 天仍落在该横盘区间内。
 * 高低比：改 UI 值时用缓存日 K 按新上限重算盒子（不是拿宽口径结果的 rangeMult 事后过滤）。
 */
const LiveScanner = () => {
  /** 扫描命中（≤ RANGE_MONITOR_SCAN_MAX_RANGE_MULT）的 { pair, candles }，供高低比重算 */
  const [candlePacks, setCandlePacks] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [rangeMultMax, setRangeMultMax] = useState(1.8);
  /** 仅展示预估开仓金额小于该值的币对；null/空 = 不限制 */
  const [maxOpenNotionalFilter, setMaxOpenNotionalFilter] = useState(null);
  /** 近三日在盒天数：'all' | 1 | 2 | 3 */
  const [inBoxDaysFilter, setInBoxDaysFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  /** 默认剔除股票 / ETF；集合加载前 checkbox 禁用 */
  const [excludeStocksOn, setExcludeStocksOn] = useState(true);
  const [stockSymbols, setStockSymbols] = useState(() => new Set());
  /** `${exchange}:${symbol}` → true 已有同向委托 */
  const [orderedMap, setOrderedMap] = useState({});
  /** `${exchange}:${symbol}` → true 已有多头持仓 */
  const [positionMap, setPositionMap] = useState({});
  const [orderStatusLoading, setOrderStatusLoading] = useState(false);
  /** 勾选后隐藏已有同向开多委托的币对 */
  const [hideOrdered, setHideOrdered] = useState(false);
  /** pairId → busy；批量时用 '__batch__' */
  const [orderBusy, setOrderBusy] = useState({});
  /** pairId → { minUsdt, openNotionalUsdt } */
  const [notionalMap, setNotionalMap] = useState({});
  const abortRef = useRef(false);
  const stockRef = useRef(stockSymbols);
  stockRef.current = stockSymbols;
  const orderStatusGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadStockSymbolSet()
      .then(symbols => {
        if (!cancelled) setStockSymbols(symbols);
      })
      .catch(() => {
        if (!cancelled) message.warning('拉取股票/ETF 列表失败，该过滤暂不可用');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const run = async () => {
    abortRef.current = false;
    setRunning(true);
    setCandlePacks([]);
    setOrderedMap({});
    setPositionMap({});
    setNotionalMap({});
    orderStatusGen.current += 1;

    let pairs = [];
    try {
      pairs = await getMergedTradingPairs();
      if (!pairs.length) throw new Error('未获取到合约币对');
    } catch (error) {
      message.error(error?.message || '获取合约币对失败');
      setRunning(false);
      return;
    }

    let stocks = stockRef.current;
    if (excludeStocksOn && !stocks.size) {
      try {
        stocks = await loadStockSymbolSet();
        setStockSymbols(stocks);
      } catch {
        message.warning('股票/ETF 列表未就绪，本次仍扫全市场');
      }
    }
    if (excludeStocksOn && stocks.size) {
      const before = pairs.length;
      pairs = pairs.filter(p => !stocks.has(String(p.symbol).toUpperCase()));
      message.info(`已跳过股票/ETF ${before - pairs.length} 个币对`, 2);
    }

    {
      const before = pairs.length;
      pairs = filterBlacklistedPairs(pairs);
      if (before !== pairs.length) {
        message.info(`已跳过黑名单 ${before - pairs.length} 个币对`, 2);
      }
    }

    setProgress({ checked: 0, total: pairs.length });

    const packs = [];
    const scanRules = { ...LOW_VOL_RANGE_BLAST_V01, maxRangeMult: RANGE_MONITOR_SCAN_MAX_RANGE_MULT };

    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const pair = pairs[i];
      try {
        const candles = await fetchLookbackCandles(pair, RANGE_LOOKBACK_DAYS);
        const hits = findActiveLowVolRanges(candles, pair, scanRules, { recentDays: RANGE_RECENT_DAYS });
        if (hits.length) {
          packs.push({
            pair: { exchange: pair.exchange, symbol: pair.symbol },
            candles,
          });
          if (packs.length % 8 === 0) setCandlePacks([...packs]);
        }
      } catch (error) {
        // 单币失败跳过
      }

      setProgress({ checked: i + 1, total: pairs.length });
      const banRemaining = getBinanceBanRemaining();
      if (banRemaining > 0) {
        message.warning(`Binance 限频，暂停 ${Math.ceil(banRemaining / 1000)}s`, 2);
        await sleep(banRemaining + 500);
      }
      if (i % 20 === 19) await sleep(80);
    }

    setCandlePacks([...packs]);
    setRunning(false);
    if (abortRef.current) message.info(`已停止，当前候选 ${packs.length} 个币对`);
    else message.success(`扫描完成：候选 ${packs.length} 个（≤${RANGE_MONITOR_SCAN_MAX_RANGE_MULT}x；列表按当前高低比重算）`);
    if (packs.length) {
      // 委托状态按币对查；先用宽口径命中行占位
      const probeRows = packs.flatMap(({ pair, candles }) =>
        findActiveLowVolRanges(candles, pair, scanRules, { recentDays: RANGE_RECENT_DAYS })
      );
      refreshOrderStatus(probeRows);
    }
  };

  const stop = () => {
    abortRef.current = true;
  };

  const refreshOrderStatus = async list => {
    if (!list?.length) {
      setOrderedMap({});
      setPositionMap({});
      return;
    }
    if (!isLiveOrderEnabled()) {
      setOrderedMap({});
      setPositionMap({});
      return;
    }
    const gen = ++orderStatusGen.current;
    setOrderStatusLoading(true);
    try {
      // 每所全量拉一次（非按币对扫），避免 BN openOrders/algo/positionRisk 打爆 429
      const { orderedMap: nextOrders, positionMap: nextPos, error } = await fetchLiveOrderStatusMaps(list);
      if (gen !== orderStatusGen.current) return;
      setOrderedMap(nextOrders);
      setPositionMap(nextPos);
      if (error) {
        message.warning(`委托状态部分失败：${error}`);
      }
    } catch (e) {
      if (gen === orderStatusGen.current) {
        message.error(`刷新委托状态失败：${e?.message || e}`);
      }
    } finally {
      if (gen === orderStatusGen.current) setOrderStatusLoading(false);
    }
  };

  /** 按当前高低比上限重算盒子（同一批缓存 K） */
  const activeRows = useMemo(() => {
    const mult = Number(rangeMultMax);
    const maxRangeMult =
      Number.isFinite(mult) && mult >= 1 ? Math.min(mult, RANGE_MONITOR_SCAN_MAX_RANGE_MULT) : RANGE_MONITOR_SCAN_MAX_RANGE_MULT;
    const rules = { ...LOW_VOL_RANGE_BLAST_V01, maxRangeMult };
    return candlePacks.flatMap(({ pair, candles }) =>
      findActiveLowVolRanges(candles, pair, rules, { recentDays: RANGE_RECENT_DAYS })
    );
  }, [candlePacks, rangeMultMax]);

  /** 按币对懒加载：最小开仓金额 × OPEN_NOTIONAL_MULT → 预估开仓金额（扫描结束后拉，避免中途反复取消） */
  useEffect(() => {
    if (running || !activeRows.length) return undefined;
    let cancelled = false;
    const run = async () => {
      const pending = [];
      const seen = new Set();
      activeRows.forEach(row => {
        const id = pairIdOf(row);
        if (!id || seen.has(id)) return;
        seen.add(id);
        pending.push(row);
      });
      const next = {};
      for (let i = 0; i < pending.length; i++) {
        if (cancelled) return;
        const row = pending[i];
        const id = pairIdOf(row);
        try {
          next[id] = await resolveOpenNotionalUsdt({
            symbol: row.symbol,
            exchange: row.exchange,
            price: row.rangeHigh,
          });
        } catch {
          next[id] = { minUsdt: null, openNotionalUsdt: null };
        }
        if (i % 20 === 19) {
          if (!cancelled) setNotionalMap(prev => ({ ...prev, ...next }));
          await sleep(40);
        }
      }
      if (!cancelled) setNotionalMap(prev => ({ ...prev, ...next }));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeRows, running]);

  const stockHitCount = useMemo(() => {
    if (!stockSymbols.size || !activeRows.length) return 0;
    return activeRows.filter(row => stockSymbols.has(String(row.symbol).toUpperCase())).length;
  }, [activeRows, stockSymbols]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    const maxNotional = Number(maxOpenNotionalFilter);
    const hasMaxNotional = Number.isFinite(maxNotional) && maxNotional > 0;
    return activeRows
      .map(row => {
        const meta = notionalMap[pairIdOf(row)];
        return {
          ...row,
          minOpenNotionalUsdt: meta?.minUsdt ?? null,
          openNotionalUsdt: meta?.openNotionalUsdt ?? null,
        };
      })
      .filter(row => {
        if (query && !row.symbol.includes(query)) return false;
        if (excludeStocksOn && stockSymbols.has(String(row.symbol).toUpperCase())) return false;
        if (hideOrdered && orderedMap[pairIdOf(row)]) return false;
        if (hasMaxNotional) {
          const open = Number(row.openNotionalUsdt);
          if (!(open > 0) || !(open < maxNotional)) return false;
        }
        if (inBoxDaysFilter !== 'all' && Number(row.inBoxDays) !== Number(inBoxDaysFilter)) {
          return false;
        }
        return true;
      });
  }, [
    activeRows,
    keyword,
    excludeStocksOn,
    stockSymbols,
    hideOrdered,
    orderedMap,
    notionalMap,
    maxOpenNotionalFilter,
    inBoxDaysFilter,
  ]);

  const orderedCount = useMemo(
    () => activeRows.filter(row => orderedMap[pairIdOf(row)]).length,
    [activeRows, orderedMap]
  );

  const percent = progress.total ? (progress.checked / progress.total) * 100 : 0;
  const batchBusy = Boolean(orderBusy.__batch__);

  const explainOrderResult = (row, result) => {
    const tag = `${row.exchange === 'binance' ? 'BN' : 'BG'} ${row.symbol}`;
    const notional = result.notional ?? row.openNotionalUsdt;
    if (result.ok) {
      return `${tag} 已挂：严格上破 ${fmtPrice(result.triggerPrice)}（上沿 ${fmtPrice(
        result.entryPrice ?? row.rangeHigh
      )}）后市价开多 ~${notional != null ? Number(notional).toFixed(2) : '—'}U`;
    }
    const reason = result.detail || SKIP_REASON_LABEL[result.reason] || result.reason || '失败';
    return `${tag} ${result.skipped ? '跳过' : '失败'}：${reason}`;
  };

  const markOrdered = id => {
    if (!id) return;
    setOrderedMap(prev => ({ ...prev, [id]: true }));
  };

  const handleOrderOne = async row => {
    const id = pairIdOf(row);
    if (!id || orderBusy[id] || batchBusy || orderedMap[id] || positionMap[id]) return;
    setOrderBusy(prev => ({ ...prev, [id]: true }));
    try {
      const result = await placeBreakoutTriggerOrder(row);
      if (result.ok) {
        markOrdered(id);
        message.success(explainOrderResult(row, result));
      } else if (result.skipped) {
        if (result.reason === 'has_orders') {
          markOrdered(id);
        }
        if (result.reason === 'has_position') {
          setPositionMap(prev => ({ ...prev, [id]: true }));
        }
        message.warning(explainOrderResult(row, result));
      } else message.error(explainOrderResult(row, result));
    } catch (e) {
      message.error(`${row.symbol} 下单异常：${e?.message || e}`);
    } finally {
      setOrderBusy(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleOrderBatch = () => {
    const targets = displayRows.filter(row => !orderedMap[pairIdOf(row)] && !positionMap[pairIdOf(row)]);
    if (!targets.length || batchBusy) {
      if (displayRows.length && !targets.length) {
        message.info('当前列表币对均已有持仓或同向委托');
      }
      return;
    }
    Modal.confirm({
      title: '批量一键下单',
      content: (
        <div>
          <p>
            对当前可下单的 <b>{targets.length}</b> 个币对挂计划/条件单：价
            <b>严格上破</b>各自区间上沿（触发价=上沿+1tick）后市价开多，名义按列表「预估开仓金额」（最小开仓×
            {OPEN_NOTIONAL_MULT}）
            {displayRows.length > targets.length
              ? `（已跳过 ${displayRows.length - targets.length} 个已有同向委托）`
              : ''}
            。
          </p>
          <p style={{ color: '#8c8c8c', marginBottom: 0 }}>
            突破条件 high&gt;上沿；入场参考价=上沿。已有同向开多委托或持仓会跳过。
          </p>
        </div>
      ),
      okText: '确认下单',
      cancelText: '取消',
      onOk: async () => {
        setOrderBusy(prev => ({ ...prev, __batch__: true }));
        try {
          const summary = await placeBreakoutTriggerOrdersBatch(targets);
          summary.results.forEach(({ row, result }) => {
            if (result?.ok || result?.reason === 'has_orders') {
              markOrdered(pairIdOf(row));
            }
          });
          message.info(
            `批量完成：成功 ${summary.ok} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`
          );
        } catch (e) {
          message.error(`批量下单异常：${e?.message || e}`);
        } finally {
          setOrderBusy(prev => {
            const next = { ...prev };
            delete next.__batch__;
            return next;
          });
        }
      },
    });
  };
const explainExitResult = (row, result) => {
    const tag = `${row.exchange === 'binance' ? 'BN' : 'BG'} ${row.symbol}`;
    if (result.ok) {
      const n = result.submitted?.length || 0;
      const skipN = result.skipped?.length || 0;
      const failN = result.failed?.length || 0;
      return `${tag} ${STRATEGY3_EXIT.label}：成功 ${n}${failN ? ` · 失败 ${failN}` : ''}${
        skipN ? ` · 跳过 ${skipN}` : ''
      }${result.detail ? `（${result.detail}）` : ''}`;
    }
    const reason = result.detail || SKIP_REASON_LABEL[result.reason] || result.reason || '失败';
    return `${tag} ${result.skipped ? '跳过' : '失败'}：${reason}`;
  };

  const handleExitOne = async row => {
    const id = pairIdOf(row);
    const busyKey = `${id}:exit`;
    if (!id || orderBusy[busyKey] || batchBusy || !positionMap[id]) return;
    setOrderBusy(prev => ({ ...prev, [busyKey]: true }));
    try {
      const result = await placeStrategy3ExitOrders(row);
      if (result.ok) {
        setPositionMap(prev => ({ ...prev, [id]: true }));
        message.success(explainExitResult(row, result));
      } else if (result.skipped) {
        if (result.reason === 'no_long_position') {
          setPositionMap(prev => ({ ...prev, [id]: false }));
        }
        message.warning(explainExitResult(row, result));
      } else message.error(explainExitResult(row, result));
    } catch (e) {
      message.error(`${row.symbol} 止盈委托异常：${e?.message || e}`);
    } finally {
      setOrderBusy(prev => {
        const next = { ...prev };
        delete next[busyKey];
        return next;
      });
    }
  };

  const handleExitBatch = () => {
    const targets = displayRows.filter(row => positionMap[pairIdOf(row)]);
    if (!targets.length || batchBusy) {
      message.warning(displayRows.length ? '当前列表没有已确认的多头持仓（可先点「刷新委托状态」）' : '当前列表为空');
      return;
    }
    Modal.confirm({
      title: '一键下止盈委托单',
      content: (
        <div>
          <p>
            对当前列表 <b>{targets.length}</b> 个币对中<strong>已有多头持仓</strong>的，按
            <b>{STRATEGY3_EXIT.label}</b>挂出场委托（无持仓会跳过）：
          </p>
          <ul style={{ margin: '8px 0', paddingLeft: 18, color: '#595959', fontSize: 12 }}>
            <li>
              止盈：涨 {STRATEGY3_EXIT.tpLegs.map(l => `${l.gainPct}%平${l.closePct}%`).join(' / ')}（占开仓总量）
            </li>
            <li>
              止损：涨幅达 {STRATEGY3_EXIT.slArmPct}% 后挂全仓止损价 {STRATEGY3_EXIT.slPricePct}%（保本）；未达武装点则跳过
            </li>
            <li>
              追踪：涨幅达 {STRATEGY3_EXIT.trailArmPct}% 后回撤 {STRATEGY3_EXIT.trailCbPct}% 平剩余（BN 回撤上限 10%）
            </li>
            <li>入场参考价优先用列表「上沿」，与回测口径一致</li>
          </ul>
        </div>
      ),
      okText: '确认挂单',
      cancelText: '取消',
      onOk: async () => {
        setOrderBusy(prev => ({ ...prev, __batch__: true }));
        try {
          const summary = await placeStrategy3ExitOrdersBatch(targets);
          message.info(
            `止盈委托完成：成功 ${summary.ok} · 部分成功 ${summary.partial} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`
          );
        } catch (e) {
          message.error(`批量止盈委托异常：${e?.message || e}`);
        } finally {
          setOrderBusy(prev => {
            const next = { ...prev };
            delete next.__batch__;
            return next;
          });
        }
      },
    });
  };

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 140,
      sortBy: row => row.symbol,
      render: row => (
        <>
          <a
            className={s.symbolLink}
            href={getTradeUrl(row.symbol, row.exchange)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.symbol.replace(/USDT$/, '')}
          </a>
          <span className={s.exchangeTag}>{row.exchange === 'binance' ? 'BN' : 'BG'}</span>
        </>
      ),
    },
    {
      key: 'rangeFrom',
      title: '区间起',
      width: 100,
      sortBy: row => row.rangeFrom,
      render: row => <span className={s.muted}>{row.rangeFrom}</span>,
    },
    {
      key: 'rangeTo',
      title: '区间止',
      width: 100,
      sortBy: row => row.rangeTo,
      render: row => <span className={s.muted}>{row.rangeTo}</span>,
    },
    {
      key: 'days',
      title: '天数',
      width: 70,
      align: 'right',
      sortBy: row => row.days,
      render: row => row.days,
    },
    {
      key: 'rangeLow',
      title: '下沿',
      width: 100,
      align: 'right',
      sortBy: row => row.rangeLow,
      render: row => fmtPrice(row.rangeLow),
    },
    {
      key: 'rangeHigh',
      title: '上沿',
      width: 100,
      align: 'right',
      sortBy: row => row.rangeHigh,
      render: row => fmtPrice(row.rangeHigh),
    },
    {
      key: 'rangeMult',
      title: '高低比',
      width: 80,
      align: 'right',
      sortBy: row => row.rangeMult,
      render: row => (row.rangeMult != null ? `${row.rangeMult.toFixed(2)}x` : '—'),
    },
    {
      key: 'lastClose',
      title: '最新收盘',
      width: 100,
      align: 'right',
      sortBy: row => row.lastClose,
      render: row => fmtPrice(row.lastClose),
    },
    {
      key: 'posInRange',
      title: '盒内位置',
      width: 80,
      align: 'right',
      sortBy: row => row.posInRange,
      render: row =>
        row.posInRange != null ? `${(row.posInRange * 100).toFixed(0)}%` : '—',
    },
    {
      key: 'inBoxDays',
      title: `近${RANGE_RECENT_DAYS}日在盒`,
      width: 90,
      align: 'center',
      sortBy: row => row.inBoxDays,
      render: row => `${row.inBoxDays}/${row.recentDays}`,
    },
    {
      key: 'openNotionalUsdt',
      title: '预估开仓金额',
      width: 110,
      align: 'right',
      sortBy: row => row.openNotionalUsdt,
      render: row =>
        row.openNotionalUsdt != null ? (
          <span title={`最小开仓 ${row.minOpenNotionalUsdt ?? '—'}U × ${OPEN_NOTIONAL_MULT}`}>
            {Number(row.openNotionalUsdt).toFixed(2)}U
          </span>
        ) : (
          <span className={s.muted}>…</span>
        ),
    },
    {
      key: 'order',
      title: '操作',
      width: 200,
      align: 'center',
      render: row => {
        const id = pairIdOf(row);
        const hasPos = Boolean(positionMap[id]);
        const already = Boolean(orderedMap[id]);
        const exitBusy = Boolean(orderBusy[`${id}:exit`]);
        const openDisabled = hasPos || already || batchBusy || !isLiveOrderEnabled();
        const exitDisabled = !hasPos || batchBusy || !isLiveOrderEnabled();
        const notionalHint =
          row.openNotionalUsdt != null ? `${Number(row.openNotionalUsdt).toFixed(2)}U` : '（金额加载中）';
        return (
          <span style={{ display: 'inline-flex', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Button
              size="small"
              type="link"
              loading={Boolean(orderBusy[id]) || batchBusy}
              disabled={openDisabled}
              onClick={() => handleOrderOne(row)}
              title={
                hasPos
                  ? '已有多头持仓，请用止盈委托'
                  : already
                    ? '已有同向开多委托，不可重复下单'
                    : `价严格上破上沿 ${fmtPrice(row.rangeHigh)} 后市价开多 ${notionalHint}`
              }
              style={{ padding: 0, margin: 0 }}
            >
              {already && !hasPos ? '已下单' : '一键下单'}
            </Button>
            <Button
              size="small"
              type="link"
              loading={exitBusy || batchBusy}
              disabled={exitDisabled}
              onClick={() => handleExitOne(row)}
              title={
                hasPos
                  ? `${STRATEGY3_EXIT.label}：对已有多仓挂止盈/保本止损/追踪`
                  : '无多头持仓，无法挂止盈委托'
              }
              style={{ padding: 0, margin: 0 }}
            >
              止盈委托
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <div className={s.panel}>
      <TradeUnlockPrompt active />
      <div className={s.metaRow}>
        <span className={s.ruleText}>
          {LOW_VOL_RANGE_BLAST_V01.label}：BN+BG 去重；横盘 &gt;{LOW_VOL_RANGE_BLAST_V01.minDaysExclusive}{' '}
          天；扫描按最高≤最低×{RANGE_MONITOR_SCAN_MAX_RANGE_MULT} 收候选，列表「高低比」按当前值重算盒子（近 {RANGE_RECENT_DAYS}{' '}
          天终点仍属该横盘）。一键下单：入场参考价=上沿；名义=币对最小开仓×{OPEN_NOTIONAL_MULT}（列表「预估开仓金额」）；触发价=上沿+1tick（严格
          high&gt;上沿）后市价开多。
        </span>
        <div className={s.actions}>
          <Button
            size="small"
            disabled={!displayRows.length || running || orderStatusLoading}
            loading={batchBusy}
            onClick={handleOrderBatch}
            title="对当前筛选列表中尚未有同向委托的币对批量挂单"
          >
            一键下单
          </Button>
          <Button
            size="small"
            disabled={!displayRows.length || running || batchBusy || !isLiveOrderEnabled()}
            loading={batchBusy}
            onClick={handleExitBatch}
            title={`${STRATEGY3_EXIT.label}：对列表内已有多仓批量挂止盈/止损/追踪`}
          >
            一键下止盈委托单
          </Button>
          <Button
            size="small"
            disabled={!activeRows.length || running || !isLiveOrderEnabled()}
            loading={orderStatusLoading}
            onClick={() => refreshOrderStatus(activeRows)}
            title="重新查询各币对：同向开多委托 + 多头持仓（用于按钮互斥）"
          >
            刷新委托状态
          </Button>
          <Button size="small" type="primary" icon={<ReloadOutlined />} loading={running} onClick={run}>
            {running ? '扫描中...' : candlePacks.length ? '重新扫描' : '开始扫描'}
          </Button>
          {running && (
            <Button size="small" onClick={stop}>
              停止
            </Button>
          )}
        </div>
      </div>

      {(running || progress.total > 0) && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div className={s.progressBar} style={{ width: `${percent}%` }} />
          </div>
          <span className={s.progressText}>
            {progress.checked}/{progress.total}
          </span>
        </div>
      )}

      <div className={s.filterRow}>
        <span className={s.muted} title="在扫描候选上按该上限重算最长合法盒子，不是过滤旧 rangeMult">
          高低比 ≤
        </span>
        <InputNumber
          size="small"
          min={1}
          max={RANGE_MONITOR_SCAN_MAX_RANGE_MULT}
          step={0.05}
          value={rangeMultMax}
          onChange={value => setRangeMultMax(value == null ? RANGE_MONITOR_SCAN_MAX_RANGE_MULT : Number(value))}
          style={{ width: 80 }}
          title={`按最高≤最低×该值重算横盘盒子（扫描候选上限 ${RANGE_MONITOR_SCAN_MAX_RANGE_MULT}）`}
        />
        <span className={s.muted} title={`按列表「预估开仓金额」（最小开仓×${OPEN_NOTIONAL_MULT}）过滤；金额未加载的行会被隐藏`}>
          开仓金额 &lt;
        </span>
        <InputNumber
          size="small"
          min={0}
          step={10}
          placeholder="不限"
          value={maxOpenNotionalFilter}
          onChange={value => setMaxOpenNotionalFilter(value == null || value === '' ? null : Number(value))}
          style={{ width: 88 }}
          addonAfter="U"
          title="仅保留预估开仓金额小于该值的币对；清空为不限制"
        />
        <Select
          size="small"
          value={inBoxDaysFilter}
          onChange={setInBoxDaysFilter}
          style={{ width: 110 }}
          title={`近 ${RANGE_RECENT_DAYS} 日里完全落在横盘盒内的天数`}
          options={[
            { value: 'all', label: '全部' },
            { value: 1, label: '1日在盒' },
            { value: 2, label: '2日在盒' },
            { value: 3, label: '3日在盒' },
          ]}
        />
        <input
          placeholder="筛选币对"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{
            width: 140,
            height: 24,
            padding: '0 8px',
            fontSize: 12,
            border: '1px solid #e8e8e8',
            borderRadius: 4,
          }}
        />
        <Checkbox
          checked={excludeStocksOn}
          disabled={!stockSymbols.size}
          onChange={e => setExcludeStocksOn(e.target.checked)}
          title="剔除：个股（美/港/韩/A）、个股杠杆 ETF、指数与板块 ETF。保留：原生加密、商品、外汇、Pre-IPO、加密指数。"
        >
          过滤股票 / ETF
          {stockSymbols.size
            ? `（${stockSymbols.size} 标的${stockHitCount ? ` · 本表命中 ${stockHitCount}` : ''}）`
            : '（加载中…）'}
        </Checkbox>
        <Checkbox
          checked={hideOrdered}
          onChange={e => setHideOrdered(e.target.checked)}
          title="隐藏已有同向开多委托（普通挂单或计划/条件单）的币对"
        >
          过滤已下单
          {orderedCount ? `（${orderedCount}）` : ''}
          {orderStatusLoading ? ' …' : ''}
        </Checkbox>
        <span
          className={s.countBadge}
          title="命中=当前高低比重算后的条数；表格=应用币对/股票/已下单/开仓金额等筛选后实际展示的条数"
        >
          命中 {activeRows.length} 条 · 表格 {displayRows.length} 条
        </span>
      </div>

      <DataList
        key={`mult-${rangeMultMax}`}
        columns={columns}
        rows={displayRows}
        empty={running ? '扫描中...' : '点击「开始扫描」筛选近三日仍在横盘区间的币对'}
        defaultSort={{ key: 'days', dir: 'desc' }}
      />
    </div>
  );
};

export default LiveScanner;
