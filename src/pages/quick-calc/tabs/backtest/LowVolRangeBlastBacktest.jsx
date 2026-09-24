import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, message } from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getAllFutureDailyKlines, getMergedTradingPairs, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import ResultList from './_ResultList';
import {
  LOW_VOL_RANGE_BLAST_V01,
  findLowVolRangeBlastMarkers,
  bucketFwdGainVsRangeHigh,
  summarizeLowVolRangeBlast,
} from './_lowVolRangeBlastRules';
import { loadStockSymbolSet } from './_tradFiSymbols';
import LowVolRangeBlastConclusion from './_LowVolRangeBlastConclusion';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const CACHE_STORAGE_KEY = 'qc-backtest-low-vol-range-blast-v1';

/** 规则指纹：改扫描口径会失效缓存；纯 UI 过滤不进指纹 */
const rulesFingerprint = (rules = LOW_VOL_RANGE_BLAST_V01) =>
  [
    rules.version,
    rules.defaultStartDate,
    rules.minDaysExclusive,
    rules.maxRangeMult,
    rules.followDays,
    rules.successMult,
  ].join('|');

const todayLocal = () => moment().format('YYYY-MM-DD');

const readCache = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = payload => {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    message.warning(`本地缓存写入失败（可能超配额）：${error?.message || error}`);
    return false;
  }
};

const clearCache = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
};

const cacheMatches = cached =>
  cached
  && cached.day === todayLocal()
  && cached.fingerprint === rulesFingerprint()
  && Array.isArray(cached.rows);

const EX_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'binance', label: 'BN' },
  { key: 'bitget', label: 'BG' },
];

const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'success', label: '成功' },
  { key: 'failed', label: '失败' },
  { key: 'pending', label: '待观察' },
];

const EMPTY_PROGRESS = { done: 0, total: 0, symbol: '', exchange: '', page: 0, candles: 0 };

const fmtPrice = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number >= 1000) return number.toFixed(2);
  if (number >= 1) return number.toFixed(4);
  return number.toPrecision(5);
};

const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;

const fmtPctPoints = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;

const statusTone = (status, styles) => {
  if (status === 'success') return styles.badgeGreen;
  if (status === 'failed') return styles.badgeRed;
  return styles.badgeGrey;
};

const statusLabel = status => {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return '待观察';
};

const SUCCESS_GAIN = LOW_VOL_RANGE_BLAST_V01.successMult - 1;

const breakLabel = dir => (dir === 'up' ? '上破' : dir === 'down' ? '下破' : '—');

/**
 * 回测：低波动横盘暴涨
 * 全市场扫描（Binance 优先去重）→ 横盘区间 → 突破标记日 → 后 30 日相对上沿涨幅
 */
const LowVolRangeBlastBacktest = () => {
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [scannedAt, setScannedAt] = useState(null);
  const [exFilter, setExFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  // 2026-09-24 探索结论：区间最高价 / 横盘天数过滤性价比差或无效 → 已禁用
  const [dropDownBreakOn, setDropDownBreakOn] = useState(false);
  /** 高低比上限：勾选后 rangeMult > 阈值的过滤掉 */
  const [rangeMultOn, setRangeMultOn] = useState(false);
  const [rangeMultMax, setRangeMultMax] = useState(1.5);
  /** 收盘确认：勾选后要求标记日收盘站稳突破侧（上破收盘>上沿）——信号在收盘才可知 */
  const [closeConfirmOn, setCloseConfirmOn] = useState(false);
  /** 突破前位置：勾选后要求区间末日收盘相对位置 ≥ 阈值（靠近上沿） */
  const [prePosOn, setPrePosOn] = useState(false);
  const [prePosMin, setPrePosMin] = useState(0.7);
  /** 时间外样本：标记日 ≥ 该日期 */
  const [markerStartOn, setMarkerStartOn] = useState(false);
  const [markerStartDate, setMarkerStartDate] = useState('2024-01-01');
  /** 默认剔除股票 / ETF（个股、非美上市、杠杆与指数/板块 ETF；不含商品外汇 Pre-IPO） */
  const [excludeStocksOn, setExcludeStocksOn] = useState(true);
  const [stockSymbols, setStockSymbols] = useState(() => new Set());
  const [fromCache, setFromCache] = useState(false);
  const abortRef = useRef(null);
  const cacheBootstrapped = useRef(false);

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
    const cached = readCache();
    if (cacheMatches(cached)) {
      setRows(cached.rows);
      setErrors(Array.isArray(cached.errors) ? cached.errors : []);
      setScannedAt(cached.scannedAt || null);
      setFromCache(true);
      if (!cacheBootstrapped.current) {
        message.info(
          `已加载今日缓存 ${cached.rows.length} 条${
            cached.incomplete ? '（未扫完）' : ''
          }（${moment(cached.scannedAt).format('HH:mm:ss')}）`,
          3
        );
      }
    }
    cacheBootstrapped.current = true;
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const persistRows = (nextRows, meta = {}) => {
    const scanned = meta.scannedAt || Date.now();
    return writeCache({
      day: todayLocal(),
      fingerprint: rulesFingerprint(),
      scannedAt: scanned,
      incomplete: Boolean(meta.incomplete),
      errors: meta.errors || [],
      rows: nextRows,
    });
  };

  const discardCache = () => {
    clearCache();
    setRows([]);
    setErrors([]);
    setScannedAt(null);
    setFromCache(false);
    message.success('已清除本地缓存');
  };

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setFromCache(false);
    setRows([]);
    setErrors([]);
    setProgress(EMPTY_PROGRESS);

    let pairs = [];
    try {
      pairs = await getMergedTradingPairs();
      if (!pairs.length) throw new Error('未获取到合约币对');
    } catch (error) {
      message.error(error?.message || '获取合约币对失败');
      setRunning(false);
      return;
    }

    setProgress(prev => ({ ...prev, total: pairs.length }));
    const found = [];
    const failed = [];

    for (let index = 0; index < pairs.length; index++) {
      if (controller.signal.aborted) break;
      const pair = pairs[index];
      setProgress({
        ...EMPTY_PROGRESS,
        done: index,
        total: pairs.length,
        symbol: pair.symbol,
        exchange: pair.exchange,
      });

      try {
        const candles = await getAllFutureDailyKlines(
          {
            symbol: pair.symbol,
            signal: controller.signal,
            onPage: ({ page, loaded }) => setProgress(prev => ({ ...prev, page, candles: loaded })),
          },
          pair.exchange
        );
        found.push(...findLowVolRangeBlastMarkers(candles, pair, LOW_VOL_RANGE_BLAST_V01));
        setRows([...found]);
      } catch (error) {
        if (error?.name === 'AbortError') break;
        if (pair.exchange === 'binance' && error?.status && error.status !== 200) {
          message.error(`Binance 接口异常（${error.status}）：${pair.symbol}`, 5);
        }
        failed.push({
          symbol: pair.symbol,
          exchange: pair.exchange,
          message: error?.message || String(error),
        });
        setErrors([...failed]);
      }

      setProgress(prev => ({ ...prev, done: index + 1 }));
      const banRemaining = getBinanceBanRemaining();
      if (banRemaining > 0) {
        message.warning(`Binance 限频，暂停 ${Math.ceil(banRemaining / 1000)}s 后继续`, 3);
        await sleep(banRemaining + 1000);
      }
      await sleep(120);
    }

    const aborted = Boolean(controller.signal.aborted);
    const nextRows = [...found];
    const nextErrors = [...failed];
    const scanned = Date.now();
    setRows(nextRows);
    setErrors(nextErrors);
    setScannedAt(scanned);
    setRunning(false);
    abortRef.current = null;

    const saved = persistRows(nextRows, {
      scannedAt: scanned,
      incomplete: aborted,
      errors: nextErrors,
    });

    if (aborted) {
      message.info(`已停止，保留当前 ${nextRows.length} 条${saved ? '并写入今日缓存' : ''}`);
    } else {
      message.success(
        `扫描完成：${pairs.length - failed.length}/${pairs.length} 币对，命中 ${found.length} 条${
          saved ? '（已缓存今日）' : ''
        }`
      );
    }
  };

  const stop = () => abortRef.current?.abort();

  const stockHitCount = useMemo(() => {
    if (!stockSymbols.size || !rows.length) return 0;
    return rows.filter(row => stockSymbols.has(String(row.symbol).toUpperCase())).length;
  }, [rows, stockSymbols]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    const multMax = Number(rangeMultMax);
    const posMin = Number(prePosMin);
    return rows.filter(row => {
      if (exFilter !== 'all' && row.exchange !== exFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (query && !row.symbol.includes(query)) return false;
      if (dropDownBreakOn && row.breakDir === 'down') return false;
      if (rangeMultOn && Number.isFinite(multMax) && row.rangeMult > multMax) return false;
      if (closeConfirmOn && !row.closeConfirm) return false;
      if (prePosOn && !(Number.isFinite(row.preBreakPos) && row.preBreakPos >= posMin)) return false;
      if (markerStartOn && markerStartDate && row.markerDate < markerStartDate) return false;
      if (excludeStocksOn && stockSymbols.has(String(row.symbol).toUpperCase())) return false;
      return true;
    });
  }, [
    rows,
    exFilter,
    statusFilter,
    keyword,
    dropDownBreakOn,
    rangeMultOn,
    rangeMultMax,
    closeConfirmOn,
    prePosOn,
    prePosMin,
    markerStartOn,
    markerStartDate,
    excludeStocksOn,
    stockSymbols,
  ]);

  const stats = useMemo(() => summarizeLowVolRangeBlast(displayRows), [displayRows]);
  const gainDist = useMemo(() => bucketFwdGainVsRangeHigh(displayRows), [displayRows]);
  const percent = progress.total ? (progress.done / progress.total) * 100 : 0;

  const copyStats = async () => {
    if (!stats.total) {
      message.warning('暂无统计可复制，请先扫描');
      return;
    }
    const filterBits = [
      statusFilter !== 'all' ? `结果=${statusFilter}` : null,
      exFilter !== 'all' ? `交易所=${exFilter}` : null,
      keyword.trim() ? `搜币=${keyword.trim().toUpperCase()}` : null,
      dropDownBreakOn ? '过滤向下突破' : null,
      rangeMultOn ? `高低比≤${rangeMultMax}` : null,
      closeConfirmOn ? '收盘确认' : null,
      prePosOn ? `突破前位置≥${prePosMin}` : null,
      markerStartOn && markerStartDate ? `标记日≥${markerStartDate}` : null,
      excludeStocksOn ? `过滤股票/ETF（剔除 ${stockHitCount}）` : null,
    ].filter(Boolean);

    const lines = [
      `${LOW_VOL_RANGE_BLAST_V01.label} ${LOW_VOL_RANGE_BLAST_V01.version}`,
      `时间\t${moment().format('YYYY-MM-DD HH:mm:ss')}`,
      `过滤\t${filterBits.length ? filterBits.join(' · ') : '无'}`,
      '',
      '【汇总】',
      `成功率\t${fmtPctPoints(stats.successRate)}`,
      `标记\t${stats.total}`,
      `成功\t${stats.success}`,
      `失败\t${stats.failed}`,
      `待观察\t${stats.pending}`,
      '',
      `【走出区间后 ${LOW_VOL_RANGE_BLAST_V01.followDays} 日最高 / 区间上沿】完整样本 ${gainDist.total}`,
      '档位\t数量\t占比',
      ...gainDist.buckets.map(
        bucket => `${bucket.label}\t${bucket.count}\t${bucket.pct.toFixed(1)}%`
      ),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success('已复制汇总 + 涨幅分布（含当前过滤）');
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  };

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 120,
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
      width: 90,
      align: 'right',
      sortBy: row => row.rangeLow,
      render: row => fmtPrice(row.rangeLow),
    },
    {
      key: 'rangeHigh',
      title: '上沿',
      width: 90,
      align: 'right',
      sortBy: row => row.rangeHigh,
      render: row => fmtPrice(row.rangeHigh),
    },
    {
      key: 'rangeMult',
      title: '高低比',
      width: 70,
      align: 'right',
      sortBy: row => row.rangeMult,
      render: row => (row.rangeMult != null ? `${row.rangeMult.toFixed(2)}x` : '—'),
    },
    {
      key: 'preBreakPos',
      title: '破前位',
      width: 70,
      align: 'right',
      sortBy: row => row.preBreakPos,
      render: row =>
        row.preBreakPos != null ? `${(row.preBreakPos * 100).toFixed(0)}%` : '—',
    },
    {
      key: 'closeConfirm',
      title: '收盘确认',
      width: 70,
      align: 'center',
      sortBy: row => (row.closeConfirm ? 1 : 0),
      render: row => (row.closeConfirm ? '是' : '否'),
    },
    {
      key: 'markerDate',
      title: '标记日',
      width: 100,
      sortBy: row => row.markerDate,
      render: row => <span className={s.muted}>{row.markerDate}</span>,
    },
    {
      key: 'breakDir',
      title: '突破',
      width: 60,
      align: 'center',
      sortBy: row => row.breakDir,
      render: row => breakLabel(row.breakDir),
    },
    {
      key: 'fwdHigh',
      title: '后30最高',
      width: 90,
      align: 'right',
      sortBy: row => row.fwdHigh,
      render: row => fmtPrice(row.fwdHigh),
    },
    {
      key: 'gainVsRangeHigh',
      title: '相对上沿',
      width: 90,
      align: 'right',
      sortBy: row => row.gainVsRangeHigh,
      render: row => (
        <span
          className={
            row.gainVsRangeHigh != null && row.gainVsRangeHigh >= SUCCESS_GAIN
              ? s.statRed
              : s.statGreen
          }
        >
          {fmtPct(row.gainVsRangeHigh)}
        </span>
      ),
    },
    {
      key: 'status',
      title: '结果',
      width: 70,
      align: 'center',
      sortBy: row => row.status,
      render: row => (
        <span className={cx(s.badge, statusTone(row.status, s))}>{statusLabel(row.status)}</span>
      ),
    },
  ];

  return (
    <div>
      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>成功率</span>
          <span className={cx(s.statValue, s.statBlue)}>{fmtPctPoints(stats.successRate)}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>标记</span>
          <span className={s.statValue}>{stats.total}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>成功</span>
          <span className={cx(s.statValue, s.statGreen)}>{stats.success}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>失败</span>
          <span className={cx(s.statValue, s.statRed)}>{stats.failed}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>待观察</span>
          <span className={s.statValue}>{stats.pending}</span>
        </div>
        {scannedAt && (
          <div className={s.statItem}>
            <span className={s.statLabel}>上次</span>
            <span>{moment(scannedAt).format('HH:mm:ss')}</span>
          </div>
        )}
        <LowVolRangeBlastConclusion />
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={copyStats}
          disabled={!stats.total}
          style={{ marginLeft: 'auto' }}
          title="复制汇总成功率与涨幅分布（含当前过滤条件）"
        >
          复制统计
        </Button>
      </div>

      <div className={s.metaRow}>
        <span className={s.ruleText}>
          {LOW_VOL_RANGE_BLAST_V01.label}（{LOW_VOL_RANGE_BLAST_V01.version}）：BN+BG 去重（BN
          优先），≥{LOW_VOL_RANGE_BLAST_V01.defaultStartDate} 日 K；横盘 &gt;
          {LOW_VOL_RANGE_BLAST_V01.minDaysExclusive} 天且最高≤最低×{LOW_VOL_RANGE_BLAST_V01.maxRangeMult}
          ；突破日为标记日；其后 {LOW_VOL_RANGE_BLAST_V01.followDays} 日最高 &gt; 上沿×
          {LOW_VOL_RANGE_BLAST_V01.successMult} 为成功。同标记日保留最长区间。扫描结果按天本地缓存，改扫描口径会失效；UI
          过滤不触发重扫。
        </span>
        <div className={s.actions}>
          {rows.length > 0 && (
            <span className={s.countBadge}>
              共 {displayRows.length}/{rows.length} 条
              {scannedAt ? ` · ${moment(scannedAt).format('HH:mm:ss')}` : ''}
              {fromCache ? ' · 本地缓存' : ''}
            </span>
          )}
          {rows.length > 0 && (
            <span className={s.filterChip} onClick={discardCache} title="清除今日本地缓存">
              清除缓存
            </span>
          )}
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            loading={running}
            onClick={run}
          >
            {running ? '扫描中...' : rows.length ? '重新扫描' : '开始全量扫描'}
          </Button>
          {running && (
            <Button size="small" onClick={stop}>
              停止
            </Button>
          )}
        </div>
      </div>

      {progress.total > 0 && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div className={s.progressBar} style={{ width: `${percent}%` }} />
          </div>
          <span className={s.progressText}>
            {progress.done}/{progress.total}
            {progress.symbol
              ? ` · ${progress.exchange === 'binance' ? 'BN' : 'BG'} ${progress.symbol}${
                  progress.page ? ` · ${progress.page}页/${progress.candles}根` : ''
                }`
              : ''}
          </span>
        </div>
      )}

      <div className={s.statBar}>
        <span className={s.distTitle}>走出区间后 {LOW_VOL_RANGE_BLAST_V01.followDays} 日最高 / 区间上沿</span>
        <span className={s.muted}>完整样本 {gainDist.total.toLocaleString()}</span>
        <div className={s.rowTipChips}>
          {gainDist.buckets.map(bucket => (
            <span key={bucket.key} className={cx(s.distItem, s.distItemStatic)}>
              <span className={s.distLabel}>{bucket.label}</span>
              <span className={s.distCount}>{bucket.count}</span>
              <span className={s.distPct}>{bucket.pct.toFixed(1)}%</span>
            </span>
          ))}
        </div>
      </div>

      <div className={s.filterRow}>
        {STATUS_FILTERS.map(item => (
          <span
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
            className={cx(s.filterChip, statusFilter === item.key && s.filterChipActive)}
          >
            {item.label}
          </span>
        ))}
        <span className={s.muted}>|</span>
        {EX_FILTERS.map(item => (
          <span
            key={item.key}
            onClick={() => setExFilter(item.key)}
            className={cx(s.filterChip, exFilter === item.key && s.filterChipActive)}
          >
            {item.label}
          </span>
        ))}
        <input
          className={s.search}
          placeholder="筛选币对"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
      </div>

      <div className={s.filterRow}>
        {/*
          已禁用（2026-09-24）：区间最高价性价比差；横盘天数无明显改善。
          不做「突破距区间结束间隔」：当前最长横盘定义下，区间止日的下一根几乎必然破盒子，间隔恒为 0。
        */}
        <span className={s.muted} title="已禁用：性价比差 / 无明显改善">
          区间最高价、横盘天数已禁用
        </span>
        <span className={s.muted}>|</span>
        <Checkbox checked={dropDownBreakOn} onChange={e => setDropDownBreakOn(e.target.checked)}>
          向下突破过滤掉
        </Checkbox>
        <span className={s.muted}>|</span>
        <Checkbox checked={rangeMultOn} onChange={e => setRangeMultOn(e.target.checked)}>
          高低比
        </Checkbox>
        <span className={s.muted}>≤</span>
        <InputNumber
          size="small"
          min={1}
          max={2}
          step={0.05}
          value={rangeMultMax}
          onChange={value => setRangeMultMax(value == null ? 1.5 : Number(value))}
          style={{ width: 72 }}
        />
        <span className={s.muted}>|</span>
        <Checkbox
          checked={closeConfirmOn}
          onChange={e => setCloseConfirmOn(e.target.checked)}
          title="上破要求收盘>上沿（下破要求收盘<下沿）。收盘后才可确认，实盘最早下一根开盘下单"
        >
          收盘确认突破
        </Checkbox>
        <span className={s.muted}>|</span>
        <Checkbox
          checked={prePosOn}
          onChange={e => setPrePosOn(e.target.checked)}
          title="区间末日收盘在 [下沿,上沿] 中的相对位置；越大越靠上沿"
        >
          破前位置
        </Checkbox>
        <span className={s.muted}>≥</span>
        <InputNumber
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={prePosMin}
          onChange={value => setPrePosMin(value == null ? 0 : Number(value))}
          style={{ width: 72 }}
        />
        <span className={s.muted}>|</span>
        <Checkbox checked={markerStartOn} onChange={e => setMarkerStartOn(e.target.checked)}>
          标记日起始
        </Checkbox>
        <input
          className={s.search}
          type="date"
          value={markerStartDate}
          onChange={e => setMarkerStartDate(e.target.value || '2024-01-01')}
          style={{ width: 140 }}
          title="只保留标记日 ≥ 该日的样本（时间外对照）"
        />
        <span className={s.muted}>|</span>
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

      {errors.length > 0 && (
        <div className={s.errorBox}>
          {errors.length} 个币对拉取失败（不计入统计）：
          {errors
            .slice(0, 6)
            .map(item => `${item.exchange === 'binance' ? 'BN' : 'BG'} ${item.symbol}`)
            .join('、')}
          {errors.length > 6 ? ` 等 ${errors.length} 个` : ''}
        </div>
      )}

      <ResultList
        key={`${statusFilter}-${exFilter}-${dropDownBreakOn}-${rangeMultOn}-${rangeMultMax}-${closeConfirmOn}-${prePosOn}-${prePosMin}-${markerStartOn}-${markerStartDate}-${excludeStocksOn}`}
        columns={columns}
        rows={displayRows}
        empty={running ? '扫描中...' : '点击「开始全量扫描」获取数据'}
        defaultSort={{ key: 'days', dir: 'desc' }}
      />
    </div>
  );
};

export default LowVolRangeBlastBacktest;
