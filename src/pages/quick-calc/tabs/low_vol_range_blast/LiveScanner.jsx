import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, Modal, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getMergedTradingPairs, getFutureKlineData, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import DataList from '../system_1/_DataList';
import TradeUnlockPrompt from '../system_1/TradeUnlockPrompt';
import * as s from '../system_1/pairSelector.module.less';
import {
  LOW_VOL_RANGE_BLAST_V01,
  findActiveLowVolRanges,
} from '../backtest/_lowVolRangeBlastRules';
import { loadStockSymbolSet } from '../backtest/_tradFiSymbols';
import {
  BREAKOUT_NOTIONAL_USDT,
  placeBreakoutTriggerOrder,
  placeBreakoutTriggerOrdersBatch,
} from './_breakoutOrder';
import { SKIP_REASON_LABEL } from '../system_1/_autoOrderModel';

const LOOKBACK_DAYS = 200;
const RECENT_DAYS = 3;
/** Bitget candles：start+end 跨度不得超过 90 天 */
const BITGET_MAX_SPAN_MS = 90 * 24 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fmtPrice = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number >= 1000) return number.toFixed(2);
  if (number >= 1) return number.toFixed(4);
  return number.toPrecision(5);
};

/**
 * 拉取近 lookbackDays 根日 K。
 * Binance 可一次带 start/end；Bitget 必须分段（跨度 ≤90 天），与 PairSelector「避免 90 天限制」同一约束。
 */
const fetchLookbackCandles = async (pair, lookbackDays) => {
  const endTime = moment.utc().valueOf();
  const startTime = moment.utc().subtract(lookbackDays, 'days').startOf('day').valueOf();

  if (pair.exchange !== 'bitget') {
    const res = await getFutureKlineData(
      {
        symbol: pair.symbol,
        granularity: '1Dutc',
        limit: lookbackDays + 5,
        startTime,
        endTime,
      },
      pair.exchange
    );
    return (Array.isArray(res?.data) ? res.data : []).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
  }

  const byTs = new Map();
  let chunkEnd = endTime;
  while (chunkEnd > startTime) {
    const chunkStart = Math.max(startTime, chunkEnd - BITGET_MAX_SPAN_MS + 1);
    const res = await getFutureKlineData(
      {
        symbol: pair.symbol,
        granularity: '1Dutc',
        limit: 100,
        startTime: chunkStart,
        endTime: chunkEnd,
      },
      'bitget'
    );
    const chunk = Array.isArray(res?.data) ? res.data : [];
    chunk.forEach(c => byTs.set(Number(c[0]), c));
    if (!chunk.length || chunkStart <= startTime) break;
    chunkEnd = chunkStart - 1;
    await sleep(40);
  }
  return [...byTs.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
};

/**
 * 实盘：低波动横盘暴涨 · 币对筛选
 * 口径对齐回测横盘；只要最近 3 天里至少 1 天仍落在该横盘区间内。
 */
const LiveScanner = () => {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [rangeMultMax, setRangeMultMax] = useState(1.8);
  const [keyword, setKeyword] = useState('');
  /** 默认剔除股票 / ETF；集合加载前 checkbox 禁用 */
  const [excludeStocksOn, setExcludeStocksOn] = useState(true);
  const [stockSymbols, setStockSymbols] = useState(() => new Set());
  /** rowKey → busy；批量时用 '__batch__' */
  const [orderBusy, setOrderBusy] = useState({});
  const abortRef = useRef(false);
  const stockRef = useRef(stockSymbols);
  stockRef.current = stockSymbols;

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
    setRows([]);

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

    setProgress({ checked: 0, total: pairs.length });

    const matched = [];
    const rules = { ...LOW_VOL_RANGE_BLAST_V01, maxRangeMult: 2 };

    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const pair = pairs[i];
      try {
        const candles = await fetchLookbackCandles(pair, LOOKBACK_DAYS);
        matched.push(...findActiveLowVolRanges(candles, pair, rules, { recentDays: RECENT_DAYS }));
        if (matched.length && i % 8 === 0) setRows([...matched]);
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

    setRows([...matched]);
    setRunning(false);
    if (abortRef.current) message.info(`已停止，当前命中 ${matched.length} 条`);
    else message.success(`扫描完成：命中 ${matched.length} 条（近${RECENT_DAYS}日仍在区间）`);
  };

  const stop = () => {
    abortRef.current = true;
  };

  const stockHitCount = useMemo(() => {
    if (!stockSymbols.size || !rows.length) return 0;
    return rows.filter(row => stockSymbols.has(String(row.symbol).toUpperCase())).length;
  }, [rows, stockSymbols]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    const multMax = Number(rangeMultMax);
    return rows.filter(row => {
      if (query && !row.symbol.includes(query)) return false;
      if (Number.isFinite(multMax) && row.rangeMult > multMax) return false;
      if (excludeStocksOn && stockSymbols.has(String(row.symbol).toUpperCase())) return false;
      return true;
    });
  }, [rows, keyword, rangeMultMax, excludeStocksOn, stockSymbols]);

  const percent = progress.total ? (progress.checked / progress.total) * 100 : 0;
  const batchBusy = Boolean(orderBusy.__batch__);

  const explainOrderResult = (row, result) => {
    const tag = `${row.exchange === 'binance' ? 'BN' : 'BG'} ${row.symbol}`;
    if (result.ok) {
      return `${tag} 已挂：触及 ${fmtPrice(result.triggerPrice)} 市价开多 ~${BREAKOUT_NOTIONAL_USDT}U`;
    }
    const reason = result.detail || SKIP_REASON_LABEL[result.reason] || result.reason || '失败';
    return `${tag} ${result.skipped ? '跳过' : '失败'}：${reason}`;
  };

  const handleOrderOne = async row => {
    if (!row?.key || orderBusy[row.key] || batchBusy) return;
    setOrderBusy(prev => ({ ...prev, [row.key]: true }));
    try {
      const result = await placeBreakoutTriggerOrder(row);
      if (result.ok) message.success(explainOrderResult(row, result));
      else if (result.skipped) message.warning(explainOrderResult(row, result));
      else message.error(explainOrderResult(row, result));
    } catch (e) {
      message.error(`${row.symbol} 下单异常：${e?.message || e}`);
    } finally {
      setOrderBusy(prev => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
    }
  };

  const handleOrderBatch = () => {
    if (!displayRows.length || batchBusy) return;
    Modal.confirm({
      title: '批量一键下单',
      content: (
        <div>
          <p>
            对当前列表 <b>{displayRows.length}</b> 个币对挂计划/条件单：最新价触及
            <b>区间上沿</b> 后市价开多约 <b>{BREAKOUT_NOTIONAL_USDT}U</b>。
          </p>
          <p style={{ color: '#8c8c8c', marginBottom: 0 }}>
            已有持仓或未成交委托（含计划/条件单）的币对会跳过。需已解锁交易权限。
          </p>
        </div>
      ),
      okText: '确认下单',
      cancelText: '取消',
      onOk: async () => {
        setOrderBusy(prev => ({ ...prev, __batch__: true }));
        try {
          const summary = await placeBreakoutTriggerOrdersBatch(displayRows);
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
      title: `近${RECENT_DAYS}日在盒`,
      width: 90,
      align: 'center',
      sortBy: row => row.inBoxDays,
      render: row => `${row.inBoxDays}/${row.recentDays}`,
    },
    {
      key: 'order',
      title: '操作',
      width: 100,
      align: 'center',
      render: row => (
        <Button
          size="small"
          type="link"
          loading={Boolean(orderBusy[row.key]) || batchBusy}
          disabled={batchBusy && !orderBusy[row.key]}
          onClick={() => handleOrderOne(row)}
          title={`无持仓/无委托时：最新价触及上沿 ${fmtPrice(row.rangeHigh)} 后市价开多约 ${BREAKOUT_NOTIONAL_USDT}U`}
        >
          一键下单
        </Button>
      ),
    },
  ];

  return (
    <div className={s.panel}>
      <TradeUnlockPrompt active />
      <div className={s.metaRow}>
        <span className={s.ruleText}>
          {LOW_VOL_RANGE_BLAST_V01.label}：BN+BG 去重；横盘 &gt;{LOW_VOL_RANGE_BLAST_V01.minDaysExclusive}{' '}
          天且最高≤最低×2；近 {RECENT_DAYS} 天至少 1 天仍属该横盘。一键下单：无持仓/无委托时挂计划单，最新价触及
          上沿后市价开多约 {BREAKOUT_NOTIONAL_USDT}U。
        </span>
        <div className={s.actions}>
          {displayRows.length > 0 && (
            <span className={s.countBadge}>
              {displayRows.length}/{rows.length}
            </span>
          )}
          <Button
            size="small"
            disabled={!displayRows.length || running}
            loading={batchBusy}
            onClick={handleOrderBatch}
            title="对当前筛选列表批量挂突破开多计划单"
          >
            一键下单
          </Button>
          <Button size="small" type="primary" icon={<ReloadOutlined />} loading={running} onClick={run}>
            {running ? '扫描中...' : rows.length ? '重新扫描' : '开始扫描'}
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
        <span className={s.muted}>高低比 ≤</span>
        <InputNumber
          size="small"
          min={1}
          max={2}
          step={0.05}
          value={rangeMultMax}
          onChange={value => setRangeMultMax(value == null ? 2 : Number(value))}
          style={{ width: 80 }}
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
      </div>

      <DataList
        columns={columns}
        rows={displayRows}
        empty={running ? '扫描中...' : '点击「开始扫描」筛选近三日仍在横盘区间的币对'}
        defaultSort={{ key: 'days', dir: 'desc' }}
      />
    </div>
  );
};

export default LiveScanner;
