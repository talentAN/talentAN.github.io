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
import {
  PNL_MAX_HOLD_DAYS,
  PNL_NOTIONAL_USDT,
  PNL_DEFAULT_INTERVAL,
  PNL_DEFAULT_EXECUTION_MODE,
  isValidPnlPlan,
  normalizePnlPlan,
  runBreakoutPnlBacktestMulti,
} from './_breakoutPnlSim';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const CACHE_STORAGE_KEY = 'qc-backtest-low-vol-range-blast-v1';
const CACHE_META_KEY = 'qc-backtest-low-vol-range-blast-meta-v1';
const IDB_NAME = 'qc-backtest-cache';
const IDB_STORE = 'kv';

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

const openCacheDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  });

const idbGet = async key => {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
};

const idbSet = async (key, value) => {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};

const idbDel = async key => {
  try {
    const db = await openCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
};

const readCacheSync = () => {
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

/** 同步可读 localStorage；大数据可能在 IndexedDB，需 await readCacheAsync */
const readCacheAsync = async () => {
  const local = readCacheSync();
  if (local?.rows?.length) return local;
  try {
    if (typeof localStorage === 'undefined') return null;
    const metaRaw = localStorage.getItem(CACHE_META_KEY);
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    if (!meta || meta.storage !== 'idb') return null;
    const payload = await idbGet(CACHE_STORAGE_KEY);
    if (!payload || !Array.isArray(payload.rows)) return null;
    return payload;
  } catch {
    return null;
  }
};

const writeCache = async payload => {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = JSON.stringify(payload);
    try {
      localStorage.setItem(CACHE_STORAGE_KEY, raw);
      localStorage.removeItem(CACHE_META_KEY);
      await idbDel(CACHE_STORAGE_KEY);
      return true;
    } catch {
      // localStorage 配额不够 → IndexedDB，meta 仍放 localStorage
      await idbSet(CACHE_STORAGE_KEY, payload);
      localStorage.removeItem(CACHE_STORAGE_KEY);
      localStorage.setItem(
        CACHE_META_KEY,
        JSON.stringify({
          storage: 'idb',
          day: payload.day,
          fingerprint: payload.fingerprint,
          scannedAt: payload.scannedAt,
          incomplete: payload.incomplete,
          rowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
        })
      );
      return true;
    }
  } catch (error) {
    message.warning(`本地缓存写入失败（可能超配额）：${error?.message || error}`);
    return false;
  }
};

const clearCache = async () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CACHE_STORAGE_KEY);
      localStorage.removeItem(CACHE_META_KEY);
    }
    await idbDel(CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
};

/** 有 rows 即可用；指纹不符仍加载（提示口径可能已变） */
const cacheHasRows = cached => cached && Array.isArray(cached.rows) && cached.rows.length > 0;

/**
 * 10 组默认：#1/#2 = 用户锚；#3–#10 = 对立派系（不是在锚上拧旋钮）。
 *
 * 用户锚假说：三档兑现（20/50/100）+ 涨20%挪保本 + 中/晚追踪收尾。
 * 对立假说要能被数据打脸：若锚显著优于对立派系，才支持「这套结构本身」而非「某个参数碰巧」。
 */
const DEFAULT_PNL_PARAM_ROWS = [
  // #1 用户锚：晚追踪
  { tp1Gain: 20, tp1Close: 25, tp2Gain: 50, tp2Close: 30, tp3Gain: 100, tp3Close: 25, slArm: 20, slPrice: 0, trailArm: 100, trailCb: 15 },
  // #2 用户锚：中追踪
  { tp1Gain: 20, tp1Close: 25, tp2Gain: 50, tp2Close: 30, tp3Gain: 100, tp3Close: 25, slArm: 20, slPrice: 0, trailArm: 50, trailCb: 15 },
  // #3 奔跑派：少兑现，大半仓交给追踪（检验「分档兑现是否必要」）
  { tp1Gain: 20, tp1Close: 10, tp2Gain: 50, tp2Close: 10, tp3Gain: 100, tp3Close: 10, slArm: 20, slPrice: 0, trailArm: 40, trailCb: 12 },
  // #4 落袋派：早期大量兑现，关闭追踪（检验「要不要让利润奔跑」）
  { tp1Gain: 15, tp1Close: 40, tp2Gain: 35, tp2Close: 40, tp3Gain: 60, tp3Close: 20, slArm: 15, slPrice: 0, trailArm: 0, trailCb: 15 },
  // #5 单目标派：前面点缀，主仓压在一档大目标（检验「多档阶梯是否多余」）
  { tp1Gain: 25, tp1Close: 10, tp2Gain: 50, tp2Close: 10, tp3Gain: 80, tp3Close: 60, slArm: 25, slPrice: 0, trailArm: 80, trailCb: 15 },
  // #6 早追踪派：第一档附近就武装追踪（检验「等 50%/100% 再追踪是否太晚」）
  { tp1Gain: 20, tp1Close: 15, tp2Gain: 50, tp2Close: 15, tp3Gain: 100, tp3Close: 10, slArm: 20, slPrice: 0, trailArm: 20, trailCb: 12 },
  // #7 硬锁利、不追踪：只靠止损上移锁利润（检验「追踪是否比固定锁利更值钱」）
  { tp1Gain: 20, tp1Close: 25, tp2Gain: 50, tp2Close: 30, tp3Gain: 100, tp3Close: 25, slArm: 30, slPrice: 15, trailArm: 0, trailCb: 15 },
  // #8 宽阶梯：忽略小波动，目标整体外推（检验「20% 第一档是否过密/过噪」）
  { tp1Gain: 40, tp1Close: 25, tp2Gain: 80, tp2Close: 30, tp3Gain: 150, tp3Close: 25, slArm: 40, slPrice: 0, trailArm: 80, trailCb: 15 },
  // #9 密阶梯：更密的三档等权兑现（检验「你的 20/50/100 + 不等权」是否优于均匀梯」）
  { tp1Gain: 20, tp1Close: 25, tp2Gain: 40, tp2Close: 25, tp3Gain: 60, tp3Close: 25, slArm: 20, slPrice: 0, trailArm: 40, trailCb: 15 },
  // #10 中追踪+极紧回撤：结构近 #2，但回撤 8%（检验「15% 回撤是否偏松」——此条是锚的尖锐对照，不是微调全家桶）
  { tp1Gain: 20, tp1Close: 25, tp2Gain: 50, tp2Close: 30, tp3Gain: 100, tp3Close: 25, slArm: 20, slPrice: 0, trailArm: 50, trailCb: 8 },
];

/** 当前回测样本下综合表现最好的参数组（奔跑派 #3） */
const BEST_PNL_PARAM_ID = 3;

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
  const [dropDownBreakOn, setDropDownBreakOn] = useState(true);
  /** 高低比上限：勾选后 rangeMult > 阈值的过滤掉 */
  const [rangeMultOn, setRangeMultOn] = useState(true);
  const [rangeMultMax, setRangeMultMax] = useState(1.5);
  /** 收盘确认：勾选后要求标记日收盘站稳突破侧（上破收盘>上沿）——信号在收盘才可知 */
  const [closeConfirmOn, setCloseConfirmOn] = useState(true);
  /** 突破前位置：勾选后要求区间末日收盘相对位置 ≥ 阈值（靠近上沿） */
  const [prePosOn, setPrePosOn] = useState(false);
  const [prePosMin, setPrePosMin] = useState(0.7);
  /** 时间外样本：标记日 ≥ 该日期 */
  const [markerStartOn, setMarkerStartOn] = useState(true);
  const [markerStartDate, setMarkerStartDate] = useState('2024-01-01');
  /** 默认剔除股票 / ETF（个股、非美上市、杠杆与指数/板块 ETF；不含商品外汇 Pre-IPO） */
  const [excludeStocksOn, setExcludeStocksOn] = useState(true);
  const [stockSymbols, setStockSymbols] = useState(() => new Set());
  const [fromCache, setFromCache] = useState(false);
  /** 10 组收益回测参数，一次开跑全部对比 */
  const [pnlParamRows, setPnlParamRows] = useState(() =>
    DEFAULT_PNL_PARAM_ROWS.map((row, index) => ({ id: index + 1, ...row }))
  );
  const [pnlRunning, setPnlRunning] = useState(false);
  const [pnlProgress, setPnlProgress] = useState({ done: 0, total: 0, symbol: '' });
  const [pnlResults, setPnlResults] = useState(null);
  const [pnlInterval, setPnlInterval] = useState(PNL_DEFAULT_INTERVAL);
  const [pnlExecutionMode, setPnlExecutionMode] = useState(PNL_DEFAULT_EXECUTION_MODE);
  const abortRef = useRef(null);
  const pnlAbortRef = useRef(null);
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
    let cancelled = false;
    (async () => {
      const cached = await readCacheAsync();
      if (cancelled) return;
      if (!cacheHasRows(cached)) {
        cacheBootstrapped.current = true;
        return;
      }
      setRows(cached.rows);
      setErrors(Array.isArray(cached.errors) ? cached.errors : []);
      setScannedAt(cached.scannedAt || null);
      setFromCache(true);
      if (!cacheBootstrapped.current) {
        const when = cached.scannedAt
          ? moment(cached.scannedAt).format('MM-DD HH:mm:ss')
          : cached.day || '';
        const fpMismatch = cached.fingerprint && cached.fingerprint !== rulesFingerprint();
        message.info(
          `已加载本地缓存 ${cached.rows.length} 条${
            cached.incomplete ? '（未扫完）' : ''
          }${fpMismatch ? '（规则指纹已变，仍展示）' : ''}${when ? ` · ${when}` : ''}`,
          4
        );
      }
      cacheBootstrapped.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      pnlAbortRef.current?.abort();
    },
    []
  );

  const persistRows = async (nextRows, meta = {}) => {
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
  const discardCache = async () => {
    await clearCache();
    setRows([]);
    setErrors([]);
    setScannedAt(null);
    setFromCache(false);
    message.success('已清除本地缓存');
  };

  const reloadCache = async () => {
    const cached = await readCacheAsync();
    if (!cacheHasRows(cached)) {
      message.warning('没有可加载的本地缓存');
      return;
    }
    setRows(cached.rows);
    setErrors(Array.isArray(cached.errors) ? cached.errors : []);
    setScannedAt(cached.scannedAt || null);
    setFromCache(true);
    message.success(`已重新加载缓存 ${cached.rows.length} 条`);
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

    const saved = await persistRows(nextRows, {
      scannedAt: scanned,
      incomplete: aborted,
      errors: nextErrors,
    });

    if (aborted) {
      message.info(`已停止，保留当前 ${nextRows.length} 条${saved ? '并写入本地缓存' : ''}`);
    } else {
      message.success(
        `扫描完成：${pairs.length - failed.length}/${pairs.length} 币对，命中 ${found.length} 条${
          saved ? '（已写入本地缓存）' : ''
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

  const updatePnlParam = (id, key, value) => {
    setPnlParamRows(prev =>
      prev.map(row => (row.id === id ? { ...row, [key]: value == null ? row[key] : Number(value) } : row))
    );
  };

  const runPnlBacktest = async () => {
    const upCount = displayRows.filter(r => r.breakDir === 'up').length;
    if (!upCount) {
      message.warning('当前过滤结果中没有上破样本，无法做多收益回测');
      return;
    }
    const invalid = pnlParamRows.find(row => !isValidPnlPlan(normalizePnlPlan(row)));
    if (invalid) {
      message.warning(
        `第 ${invalid.id} 行参数无效：三档涨幅须递增、止盈%＞0；若填止损/追踪武装涨幅，须同时给出止损价% / 回撤%`
      );
      return;
    }

    pnlAbortRef.current?.abort();
    const controller = new AbortController();
    pnlAbortRef.current = controller;
    setPnlRunning(true);
    setPnlResults(null);
    setPnlProgress({ done: 0, total: upCount, symbol: '' });

    try {
      const multi = await runBreakoutPnlBacktestMulti(displayRows, pnlParamRows, {
        signal: controller.signal,
        dataInterval: pnlInterval,
        executionMode: pnlExecutionMode,
        onProgress: p => setPnlProgress(p),
      });
      if (controller.signal.aborted) {
        message.info('收益回测已停止');
        return;
      }
      setPnlResults(multi);
      const best = [...(multi.results || [])].sort((a, b) => b.totalPnl - a.totalPnl)[0];
      message.success(
        `10 组回测完成：上破 ${multi.sampleUp} · 最佳组#${best?.params?.id ?? '—'} 累计 ${(
          best?.totalPnl ?? 0
        ).toFixed(2)}U`
      );
    } catch (e) {
      message.error(`收益回测失败：${e?.message || e}`);
    } finally {
      setPnlRunning(false);
      pnlAbortRef.current = null;
    }
  };

  const copyPnlParams = async () => {
    if (!pnlParamRows.length) {
      message.warning('暂无回测条件可复制');
      return;
    }
    const header = [
      '组',
      '涨幅达到%止盈%仓位(1)',
      '涨幅达到%止盈%仓位(2)',
      '涨幅达到%止盈%仓位(3)',
      '涨幅达到%设置全仓止损价%',
      '涨幅达到%设置回撤%追踪止盈',
    ].join('\t');
    const tsvBody = pnlParamRows.map(row =>
      [
        row.id,
        `${row.tp1Gain}/${row.tp1Close}`,
        `${row.tp2Gain}/${row.tp2Close}`,
        `${row.tp3Gain}/${row.tp3Close}`,
        Number(row.slArm) > 0 ? `${row.slArm}/${row.slPrice}` : '关',
        Number(row.trailArm) > 0 ? `${row.trailArm}/${row.trailCb}` : '关',
      ].join('\t')
    );
    const readable = pnlParamRows.map(row => {
      const sl =
        Number(row.slArm) > 0
          ? `涨幅达到${row.slArm}%时，设置全仓止损价${row.slPrice}%`
          : '全仓止损：关';
      const trail =
        Number(row.trailArm) > 0
          ? `涨幅达到${row.trailArm}%时，设置回撤${row.trailCb}%追踪止盈`
          : '追踪止盈：关';
      return [
        `#${row.id}`,
        `涨幅达到${row.tp1Gain}%时，止盈${row.tp1Close}%仓位`,
        `涨幅达到${row.tp2Gain}%时，止盈${row.tp2Close}%仓位`,
        `涨幅达到${row.tp3Gain}%时，止盈${row.tp3Close}%仓位`,
        sl,
        trail,
      ].join('；');
    });
    const lines = [
      `${LOW_VOL_RANGE_BLAST_V01.label} 收益回测条件`,
      `时间\t${moment().format('YYYY-MM-DD HH:mm:ss')}`,
      `固定规则\t入场=上沿 · ${PNL_NOTIONAL_USDT}U·1x · 第${PNL_MAX_HOLD_DAYS}日收盘强平 · 出场用${pnlInterval}K · ${
        pnlExecutionMode === 'conservative' ? '保守顺序' : '乐观顺序'
      } · 止盈%占开仓总量（非剩余）`,
      '',
      '—— 语义化 ——',
      ...readable,
      '',
      '—— TSV（便于粘贴表格）——',
      header,
      ...tsvBody,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success(`已复制 ${pnlParamRows.length} 组回测条件`);
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  };

  const copyPnlResult = async () => {
    if (!pnlResults?.results?.length) {
      message.warning('暂无收益回测结果可复制');
      return;
    }
    const header = [
      '组',
      '止盈1(涨幅%/平仓占开仓%)',
      '止盈2',
      '止盈3',
      '止损(武装涨幅%/止损价%)',
      '追踪(武装涨幅%/回撤%)',
      '数据粒度',
      '触发模式',
      '歧义K线数',
      '上破',
      '成交',
      '失败',
      '开仓次',
      '平仓次',
      '开平合计',
      '累计收益U',
      '平均每笔U',
    ].join('\t');
    const body = pnlResults.results.map(r => {
      const p = r.params;
      const avg =
        r.avgPnlPerTrade == null
          ? ''
          : `${r.avgPnlPerTrade >= 0 ? '+' : ''}${r.avgPnlPerTrade.toFixed(4)}`;
      return [
        p.id,
        `${p.tp1Gain}/${p.tp1Close}`,
        `${p.tp2Gain}/${p.tp2Close}`,
        `${p.tp3Gain}/${p.tp3Close}`,
        p.slArm != null && p.slArm > 0 ? `${p.slArm}/${p.slPrice}` : '关',
        p.trailArm != null && p.trailArm > 0 ? `${p.trailArm}/${p.trailCb}` : '关',
        r.dataInterval,
        r.executionMode,
        r.ambiguousBars,
        r.sampleUp,
        r.traded,
        r.failed,
        r.openCount,
        r.closeCount,
        r.openCloseCount,
        `${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(4)}`,
        avg,
      ].join('\t');
    });
    const lines = [
      `${LOW_VOL_RANGE_BLAST_V01.label} 收益回测（多参数对比）`,
      `时间\t${moment().format('YYYY-MM-DD HH:mm:ss')}`,
      `固定规则\t入场=上沿 · ${PNL_NOTIONAL_USDT}U·1x · 第${PNL_MAX_HOLD_DAYS}日收盘强平 · 出场用${pnlResults.results[0]?.dataInterval || pnlInterval}K · ${
        (pnlResults.results[0]?.executionMode || pnlExecutionMode) === 'conservative' ? '保守顺序' : '乐观顺序'
      } · 止盈%占开仓总量`,
      `样本过滤\t当前 UI 过滤后上破 ${pnlResults.sampleUp}`,
      '',
      header,
      ...body,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success(`已复制 ${pnlResults.results.length} 组回测结果`);
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  }; 
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
            <span className={s.filterChip} onClick={discardCache} title="清除本地缓存并清空列表">
              清除缓存
            </span>
          )}
          <span className={s.filterChip} onClick={reloadCache} title="从 localStorage / IndexedDB 重新加载">
            加载缓存
          </span>
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

      <div style={{ marginBottom: 10 }}>
        <div className={s.filterRow} style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span
            className={s.muted}
            title="仅上破；入场=上沿。常规出场按细粒度K；日K仅用于持仓周期和第30日收盘强平。"
          >
            收益回测（10 组参数并行对比）
          </span>
          <span className={s.muted}>
            {PNL_NOTIONAL_USDT}U·1x · 第{PNL_MAX_HOLD_DAYS}日收盘强平 · 出场用{pnlInterval} K ·
            {pnlExecutionMode === 'conservative' ? '保守顺序' : '乐观顺序'} · 止盈%占开仓总量
          </span>
          <select value={pnlInterval} onChange={e => setPnlInterval(e.target.value)} disabled={pnlRunning}>
            <option value="5m">5m 主回测</option>
            <option value="1m">1m 精度验证</option>
          </select>
          <select value={pnlExecutionMode} onChange={e => setPnlExecutionMode(e.target.value)} disabled={pnlRunning}>
            <option value="conservative">保守模式</option>
            <option value="optimistic">乐观模式</option>
          </select>
          <Button
            size="small"
            type="primary"
            loading={pnlRunning}
            disabled={running || !displayRows.length}
            onClick={runPnlBacktest}
          >
            {pnlRunning ? '回测中…' : '开始回测'}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!pnlParamRows.length}
            onClick={copyPnlParams}
            title="一键复制当前 10 组回测条件参数"
          >
            复制回测条件
          </Button>
          {pnlRunning && (
            <Button
              size="small"
              onClick={() => {
                pnlAbortRef.current?.abort();
              }}
            >
              停止
            </Button>
          )}
          {pnlRunning && (
            <span className={s.muted}>
              {pnlProgress.done}/{pnlProgress.total}
              {pnlProgress.symbol ? ` · ${pnlProgress.symbol}` : ''}
            </span>
          )}
          {pnlResults?.results?.length > 0 && !pnlRunning && (
            <Button size="small" icon={<CopyOutlined />} onClick={copyPnlResult} title="复制全部 10 组结果（TSV）">
              复制全部结果
            </Button>
          )}
        </div>
        {pnlParamRows.map(row => {
          const result = pnlResults?.results?.find(r => r.params.id === row.id);
          const isBest = row.id === BEST_PNL_PARAM_ID;
          const numProps = { size: 'small', disabled: pnlRunning };
          const tpGain = (key, title) => (
            <InputNumber
              {...numProps}
              min={1}
              max={500}
              step={5}
              value={row[key]}
              onChange={v => updatePnlParam(row.id, key, v)}
              style={{ width: 56 }}
              title={title}
            />
          );
          const tpClose = (key, title) => (
            <InputNumber
              {...numProps}
              min={1}
              max={100}
              step={5}
              value={row[key]}
              onChange={v => updatePnlParam(row.id, key, v)}
              style={{ width: 52 }}
              title={title}
            />
          );
          return (
            <div
              key={row.id}
              title={isBest ? '当前回测数据下综合表现最好的参数组合（奔跑派）' : undefined}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 6px',
                alignItems: 'center',
                marginBottom: 8,
                fontSize: 12,
                lineHeight: '24px',
                ...(isBest
                  ? {
                      padding: '6px 8px',
                      marginLeft: -8,
                      marginRight: -8,
                      borderRadius: 6,
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      boxShadow: 'inset 3px 0 0 #52c41a',
                    }
                  : null),
              }}
            >
              <span
                className={s.muted}
                style={{
                  width: isBest ? 'auto' : 28,
                  minWidth: 28,
                  flexShrink: 0,
                  fontWeight: 600,
                  color: isBest ? '#389e0d' : undefined,
                }}
              >
                #{row.id}
                {isBest ? (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: '0 6px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#389e0d',
                      background: '#d9f7be',
                      borderRadius: 4,
                      lineHeight: '18px',
                      display: 'inline-block',
                      verticalAlign: 'middle',
                    }}
                  >
                    当前最优
                  </span>
                ) : null}
              </span>
              <span className={s.muted}>涨幅达到</span>
              {tpGain('tp1Gain', '第1档：价格相对入场涨幅达到该%时触发')}
              <span className={s.muted}>%时，止盈</span>
              {tpClose('tp1Close', '平掉开仓总量的该%（不是剩余仓）')}
              <span className={s.muted}>%仓位</span>
              <span className={s.muted}>；</span>
              <span className={s.muted}>涨幅达到</span>
              {tpGain('tp2Gain', '第2档：价格相对入场涨幅达到该%时触发')}
              <span className={s.muted}>%时，止盈</span>
              {tpClose('tp2Close', '平掉开仓总量的该%')}
              <span className={s.muted}>%仓位</span>
              <span className={s.muted}>；</span>
              <span className={s.muted}>涨幅达到</span>
              {tpGain('tp3Gain', '第3档：价格相对入场涨幅达到该%时触发')}
              <span className={s.muted}>%时，止盈</span>
              {tpClose('tp3Close', '平掉开仓总量的该%')}
              <span className={s.muted}>%仓位</span>
              <span className={s.muted}>｜</span>
              <span className={s.muted}>涨幅达到</span>
              <InputNumber
                {...numProps}
                min={0}
                max={500}
                step={5}
                value={row.slArm}
                onChange={v => updatePnlParam(row.id, 'slArm', v == null ? 0 : v)}
                style={{ width: 56 }}
                title="填 0 表示关闭全仓止损"
              />
              <span className={s.muted}>%时，设置全仓止损价</span>
              <InputNumber
                {...numProps}
                min={-50}
                max={500}
                step={5}
                value={row.slPrice}
                onChange={v => updatePnlParam(row.id, 'slPrice', v == null ? 0 : v)}
                style={{ width: 56 }}
                title="止损价=入场×(1+该%)；0=保本"
              />
              <span className={s.muted}>%</span>
              <span className={s.muted}>｜</span>
              <span className={s.muted}>涨幅达到</span>
              <InputNumber
                {...numProps}
                min={0}
                max={500}
                step={5}
                value={row.trailArm}
                onChange={v => updatePnlParam(row.id, 'trailArm', v == null ? 0 : v)}
                style={{ width: 56 }}
                title="填 0 表示关闭追踪止盈"
              />
              <span className={s.muted}>%时，设置回撤</span>
              <InputNumber
                {...numProps}
                min={0}
                max={80}
                step={1}
                value={row.trailCb}
                onChange={v => updatePnlParam(row.id, 'trailCb', v == null ? 0 : v)}
                style={{ width: 52 }}
                title="自峰值回撤该%则平掉剩余仓位"
              />
              <span className={s.muted}>%追踪止盈</span>
              {result && !pnlRunning && (
                <span style={{ marginLeft: 4 }}>
                  开平{result.openCloseCount}
                  <span className={s.muted}> · </span>
                  累计{' '}
                  <span style={{ color: result.totalPnl >= 0 ? '#389e0d' : '#cf1322', fontWeight: 600 }}>
                    {result.totalPnl >= 0 ? '+' : ''}
                    {result.totalPnl.toFixed(2)}U
                  </span>
                  <span className={s.muted}> · </span>
                  均笔{' '}
                  {result.avgPnlPerTrade == null
                    ? '—'
                    : `${result.avgPnlPerTrade >= 0 ? '+' : ''}${result.avgPnlPerTrade.toFixed(2)}U`}
                  {result.dataInterval} · {result.executionMode === 'conservative' ? '保守' : '乐观'} · 歧义{result.ambiguousBars || 0}K
                  <span className={s.muted}> · 成交{result.traded}
                    {result.failed ? `/失败${result.failed}` : ''}
                  </span>
                </span>
              )}
            </div>
          );
        })}
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
