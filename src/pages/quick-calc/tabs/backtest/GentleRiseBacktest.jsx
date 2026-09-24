import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getAllFutureDailyKlines, getTradingPairs, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import ResultList from './_ResultList';
import {
  GENTLE_RISE_V01,
  GENTLE_RISE_REF,
  GENTLE_RISE_SUBSETS,
  GENTLE_RISE_SUBSET_BASE,
  scanGentleRiseSegments,
  evaluateReferenceWindow,
  isReferenceSegment,
  resolveGentleRiseSubset,
  filterByGentleRiseSubset,
} from './_gentleRiseRules';
import * as s from './backtest.module.less';
import { navigate } from 'gatsby';

const cx = (...names) => names.filter(Boolean).join(' ');

const DEFAULT_START_DATE = '2022-01-01';
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_STORAGE_KEY = 'qc-backtest-gentle-rise-v1';

/** 规则指纹：改阈值会自动失效旧缓存，纯 UI 迭代可复用当日结果 */
const rulesFingerprint = (rules = GENTLE_RISE_V01) =>
  [
    rules.version,
    rules.minDays,
    rules.maxDays,
    (rules.windowLengths || []).join(','),
    rules.r2Min,
    rules.dailyLogSlopeMin,
    rules.dailyLogSlopeMax,
    rules.retWindowMin,
    rules.retWindowMax,
    rules.rangeMax,
    rules.maxDayRetMax,
    rules.mddMin,
    rules.upFracMin,
    (rules.forwardHorizons || []).join(','),
  ].join('|');

const todayLocal = () => moment().format('YYYY-MM-DD');

const readCache = () => {
  try {
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
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    message.warning(`本地缓存写入失败（可能超配额）：${error?.message || error}`);
    return false;
  }
};

const clearCache = () => {
  try {
    localStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
};

const cacheMatches = (cached, startDateValue) =>
  cached
  && cached.day === todayLocal()
  && cached.fingerprint === rulesFingerprint()
  && cached.startDate === startDateValue
  && Array.isArray(cached.rows);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const startDateToTs = dateStr => {
  const ts = moment.utc(dateStr, 'YYYY-MM-DD', true).startOf('day').valueOf();
  return Number.isFinite(ts) ? ts : null;
};

const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;

const fmtNum = (value, digits = 3) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);

/** 后30日摸高（相对窗末日收盘）分档 */
const FWD30_BUCKETS = [
  { key: 'lt0', label: '<0%', match: g => g < 0 },
  { key: 'b0_10', label: '0–10%', match: g => g >= 0 && g < 0.1 },
  { key: 'b10_20', label: '10–20%', match: g => g >= 0.1 && g < 0.2 },
  { key: 'b20_30', label: '20–30%', match: g => g >= 0.2 && g < 0.3 },
  { key: 'b30_50', label: '30–50%', match: g => g >= 0.3 && g < 0.5 },
  { key: 'b50_100', label: '50–100%', match: g => g >= 0.5 && g < 1 },
  { key: 'gte100', label: '≥100%', match: g => g >= 1 },
];

const summarizeFwd30 = rows => {
  const complete = [];
  let incomplete = 0;
  rows.forEach(row => {
    const cell = row.forward?.fwd30;
    if (!cell?.complete || !Number.isFinite(cell.maxHighRet)) {
      incomplete += 1;
      return;
    }
    complete.push(cell.maxHighRet);
  });

  const total = complete.length;
  const buckets = FWD30_BUCKETS.map(bucket => {
    const count = complete.filter(bucket.match).length;
    return {
      ...bucket,
      count,
      pct: total ? (count / total) * 100 : 0,
    };
  });

  return { total, incomplete, buckets };
};

/**
 * 回测5：AGT 式缓坡稳定上行扫描（Binance 现存 U 本位）。
 * 先量化锚点包络 → 扫历史命中段 → 表内附前向 10/20/30 日供人工验证。
 * 子 tab 为高精度子集规则，共用同一次扫描/当日缓存。
 */
const GentleRiseBacktest = ({ location }) => {
  const subset = useMemo(
    () => resolveGentleRiseSubset(location?.pathname),
    [location?.pathname],
  );
  const [startDate, setStartDate] = useState(DEFAULT_START_DATE);
  const [keyword, setKeyword] = useState('');
  const [fwd30BucketKey, setFwd30BucketKey] = useState(null);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, symbol: '', page: 0 });
  const [scannedAt, setScannedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const abortRef = useRef(null);
  const startDateRef = useRef(startDate);
  const cacheBootstrapped = useRef(false);
  startDateRef.current = startDate;

  useEffect(() => {
    const cached = readCache();
    if (cacheMatches(cached, startDate)) {
      setRows(cached.rows);
      setScannedAt(cached.scannedAt || null);
      setFromCache(true);
      setFwd30BucketKey(null);
      if (!cacheBootstrapped.current) {
        message.info(
          `已加载今日缓存 ${cached.rows.length} 段（${moment(cached.scannedAt).format('HH:mm:ss')}）`,
          3,
        );
      }
    } else if (cacheBootstrapped.current) {
      // 起始日切走且无对应缓存：清空，避免串口径
      setRows([]);
      setScannedAt(null);
      setFromCache(false);
      setFwd30BucketKey(null);
    }
    cacheBootstrapped.current = true;
  }, [startDate]);

  // 切子集 tab 时清空档位过滤，避免串口径
  useEffect(() => {
    setFwd30BucketKey(null);
  }, [subset.key]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const persistRows = (nextRows, meta = {}) => {
    const scanned = meta.scannedAt || Date.now();
    const ok = writeCache({
      day: todayLocal(),
      fingerprint: rulesFingerprint(),
      startDate: meta.startDate || startDateRef.current,
      scannedAt: scanned,
      incomplete: Boolean(meta.incomplete),
      rows: nextRows,
    });
    return ok;
  };

  const discardCache = () => {
    clearCache();
    setRows([]);
    setScannedAt(null);
    setFromCache(false);
    setFwd30BucketKey(null);
    message.success('已清除本地缓存');
  };

  const fmtCopyPct = value =>
    value == null || !Number.isFinite(Number(value)) ? '' : (Number(value) * 100).toFixed(1);

  const copyFiltered = async () => {
    if (!displayRows.length) {
      message.warning('当前没有可复制的行');
      return;
    }
    const bucketLabel = fwd30BucketKey
      ? FWD30_BUCKETS.find(b => b.key === fwd30BucketKey)?.label || fwd30BucketKey
      : '全部';
    const header = [
      'symbol',
      'from',
      'to',
      'days',
      'r2',
      'retWindow%',
      'slopeRet%',
      'range%',
      'mdd%',
      'maxDay%',
      'upFrac%',
      'fwd10%',
      'fwd20%',
      'fwd30%',
      'fwd20close%',
      'isReference',
    ].join('\t');
    const lines = displayRows.map(row =>
      [
        row.symbol,
        row.from,
        row.to,
        row.days,
        row.r2 == null ? '' : Number(row.r2).toFixed(3),
        fmtCopyPct(row.retWindow),
        fmtCopyPct(row.slopeRet),
        fmtCopyPct(row.rangePct),
        fmtCopyPct(row.mdd),
        fmtCopyPct(row.maxDayRet),
        fmtCopyPct(row.upFrac),
        fmtCopyPct(row.forward?.fwd10?.complete ? row.forward.fwd10.maxHighRet : null),
        fmtCopyPct(row.forward?.fwd20?.complete ? row.forward.fwd20.maxHighRet : null),
        fmtCopyPct(row.forward?.fwd30?.complete ? row.forward.fwd30.maxHighRet : null),
        fmtCopyPct(row.forward?.fwd20?.complete ? row.forward.fwd20.closeRet : null),
        row.isReference ? '1' : '0',
      ].join('\t'),
    );
    const text = [
      `# gentle-rise copy · ${GENTLE_RISE_V01.version} · subset=${subset.key}`,
      `# subset: ${subset.label} · ${subset.ruleText}`,
      `# filter: fwd30=${bucketLabel}; keyword=${keyword.trim() || '—'}; rows=${displayRows.length}/${rows.length}`,
      `# startDate=${startDate}; scannedAt=${scannedAt ? moment(scannedAt).format('YYYY-MM-DD HH:mm:ss') : '—'}`,
      header,
      ...lines,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制当前过滤 ${displayRows.length} 行（TSV）`);
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  };

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const startTs = startDateToTs(startDate);
    if (startTs == null) {
      message.error('起始日期无效，请使用 YYYY-MM-DD');
      return;
    }

    setRunning(true);
    setRows([]);
    setFromCache(false);
    setFwd30BucketKey(null);
    setProgress({ done: 0, total: 0, symbol: '', page: 0 });

    let symbols = [];
    try {
      const pairs = await getTradingPairs({}, 'binance');
      symbols = (pairs || [])
        .map(item => String(item?.symbol || item || '').trim())
        .filter(symbol => symbol.endsWith('USDT'));
      if (!symbols.length) throw new Error('未获取到 Binance 合约币对');
    } catch (error) {
      message.error(error?.message || '获取币对失败');
      setRunning(false);
      return;
    }

    setProgress(prev => ({ ...prev, total: symbols.length }));
    const matched = [];
    let failed = 0;
    const P = GENTLE_RISE_V01;

    for (let index = 0; index < symbols.length; index += 1) {
      if (controller.signal.aborted) break;
      const symbol = symbols[index];
      setProgress({
        done: index,
        total: symbols.length,
        symbol,
        page: 0,
      });

      try {
        const candles = await getAllFutureDailyKlines(
          {
            symbol,
            signal: controller.signal,
            onPage: ({ page }) => setProgress(prev => ({ ...prev, page })),
          },
          'binance',
        );
        const segments = scanGentleRiseSegments(candles, { startTs, rules: P });

        // 锚点币：强制保留精确日期窗，避免被邻近更长窗去重挤掉
        if (symbol === GENTLE_RISE_REF.symbol) {
          const refEval = evaluateReferenceWindow(candles);
          if (refEval.ok && refEval.pass && refEval.metrics) {
            const already = segments.some(
              seg =>
                seg.metrics.from === refEval.metrics.from && seg.metrics.to === refEval.metrics.to,
            );
            if (!already) {
              segments.unshift({
                startIdx: refEval.startIdx,
                endIdx: refEval.endIdx,
                metrics: refEval.metrics,
                forward: refEval.forward,
              });
            }
          }
        }

        segments.forEach(seg => {
          const ref = isReferenceSegment(symbol, seg.metrics);
          matched.push({
            key: `${symbol}:${seg.metrics.from}:${seg.metrics.to}`,
            symbol,
            exchange: 'binance',
            isReference: ref,
            ...seg.metrics,
            forward: seg.forward,
            listingDays: Math.floor(
              (seg.metrics.fromTs - Number(candles[0]?.[0] || seg.metrics.fromTs)) / DAY_MS,
            ),
          });
        });
        if (segments.length) setRows([...matched]);
      } catch (error) {
        if (error?.name === 'AbortError') break;
        failed += 1;
      }

      setProgress(prev => ({ ...prev, done: index + 1 }));

      const banRemaining = getBinanceBanRemaining();
      if (banRemaining > 0) {
        message.warning(`Binance 限频，暂停 ${Math.ceil(banRemaining / 1000)}s 后继续`, 3);
        await sleep(banRemaining + 1000);
      }
      await sleep(120);
    }
    matched.sort((a, b) => {
      if (a.isReference !== b.isReference) return a.isReference ? -1 : 1;
      return (b.r2 ?? 0) - (a.r2 ?? 0);
    });
    const finishedAt = Date.now();
    setRows(matched);
    setScannedAt(finishedAt);
    setFromCache(false);
    setRunning(false);
    abortRef.current = null;

    const aborted = controller.signal.aborted;
    if (matched.length) {
      const saved = persistRows(matched, {
        scannedAt: finishedAt,
        startDate,
        incomplete: aborted,
      });
      if (saved && !aborted) message.success(`扫描完成并已缓存：命中 ${matched.length} 段`);
      else if (saved && aborted) message.info(`已停止并缓存当前 ${matched.length} 段`);
      else if (aborted) message.info(`已停止：当前命中 ${matched.length} 段（未写入缓存）`);
      else {
        message.success(
          `扫描完成：${symbols.length - failed}/${symbols.length} 币对，命中 ${matched.length} 段（未写入缓存）`,
        );
      }
    } else if (aborted) {
      message.info('已停止，无命中可缓存');
    } else {
      message.success(
        `扫描完成：${symbols.length - failed}/${symbols.length} 币对，命中 0 段`,
      );
    }
  };

  const stop = () => abortRef.current?.abort();

  const keywordRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    if (!query) return rows;
    return rows.filter(row => row.symbol.includes(query));
  }, [rows, keyword]);

  /** 当前子 tab 形态过滤后的母体（分布分母） */
  const subsetRows = useMemo(
    () => filterByGentleRiseSubset(keywordRows, subset),
    [keywordRows, subset],
  );

  /** 分布相对当前子集（+搜币），不随 fwd30 档位收缩 */
  const fwd30Dist = useMemo(() => summarizeFwd30(subsetRows), [subsetRows]);

  const displayRows = useMemo(() => {
    if (!fwd30BucketKey) return subsetRows;
    const bucket = FWD30_BUCKETS.find(item => item.key === fwd30BucketKey);
    if (!bucket) return subsetRows;
    return subsetRows.filter(row => {
      const cell = row.forward?.fwd30;
      if (!cell?.complete || !Number.isFinite(cell.maxHighRet)) return false;
      return bucket.match(cell.maxHighRet);
    });
  }, [subsetRows, fwd30BucketKey]);

  const toggleFwd30Bucket = key => {
    setFwd30BucketKey(prev => (prev === key ? null : key));
  };

  const subsetHitRate = rows.length ? (subsetRows.length / rows.length) * 100 : 0;
  const ge100Share = fwd30Dist.total
    ? ((fwd30Dist.buckets.find(b => b.key === 'gte100')?.count || 0) / fwd30Dist.total) * 100
    : null;

  const percent = progress.total ? (progress.done / progress.total) * 100 : 0;
  const ref = GENTLE_RISE_REF;
  const P = GENTLE_RISE_V01;

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
            href={getTradeUrl(row.symbol, 'binance')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.symbol.replace('USDT', '')}
          </a>
          {row.isReference && <span className={cx(s.badge, s.badgeGreen)}>锚点</span>}
        </>
      ),
    },
    {
      key: 'from',
      title: '起点',
      width: 100,
      sortBy: row => row.fromTs,
      render: row => <span className={s.muted}>{row.from}</span>,
    },
    {
      key: 'to',
      title: '终点',
      width: 100,
      sortBy: row => row.toTs,
      render: row => <span className={s.muted}>{row.to}</span>,
    },
    {
      key: 'days',
      title: '天数',
      width: 56,
      align: 'right',
      sortBy: row => row.days,
      render: row => row.days,
    },
    {
      key: 'r2',
      title: 'R²',
      width: 64,
      align: 'right',
      sortBy: row => row.r2,
      render: row => fmtNum(row.r2, 2),
    },
    {
      key: 'retWindow',
      title: '窗涨幅',
      width: 72,
      align: 'right',
      sortBy: row => row.retWindow,
      render: row => fmtPct(row.retWindow),
    },
    {
      key: 'slopeRet',
      title: '斜率≈收益',
      width: 80,
      align: 'right',
      sortBy: row => row.slopeRet,
      render: row => fmtPct(row.slopeRet),
    },
    {
      key: 'rangePct',
      title: '振幅',
      width: 64,
      align: 'right',
      sortBy: row => row.rangePct,
      render: row => fmtPct(row.rangePct),
    },
    {
      key: 'mdd',
      title: '最大回撤',
      width: 72,
      align: 'right',
      sortBy: row => row.mdd,
      render: row => fmtPct(row.mdd),
    },
    {
      key: 'maxDayRet',
      title: '最大单日',
      width: 72,
      align: 'right',
      sortBy: row => row.maxDayRet,
      render: row => fmtPct(row.maxDayRet),
    },
    {
      key: 'fwd10',
      title: '后10摸高',
      width: 76,
      align: 'right',
      sortBy: row => row.forward?.fwd10?.maxHighRet,
      render: row => {
        const cell = row.forward?.fwd10;
        if (!cell?.complete) return <span className={s.muted}>—</span>;
        return fmtPct(cell.maxHighRet);
      },
    },
    {
      key: 'fwd20',
      title: '后20摸高',
      width: 76,
      align: 'right',
      sortBy: row => row.forward?.fwd20?.maxHighRet,
      render: row => {
        const cell = row.forward?.fwd20;
        if (!cell?.complete) return <span className={s.muted}>—</span>;
        return fmtPct(cell.maxHighRet);
      },
    },
    {
      key: 'fwd30',
      title: '后30摸高',
      width: 76,
      align: 'right',
      sortBy: row => row.forward?.fwd30?.maxHighRet,
      render: row => {
        const cell = row.forward?.fwd30;
        if (!cell?.complete) return <span className={s.muted}>—</span>;
        return fmtPct(cell.maxHighRet);
      },
    },
    {
      key: 'fwd20c',
      title: '后20收',
      width: 72,
      align: 'right',
      sortBy: row => row.forward?.fwd20?.closeRet,
      render: row => {
        const cell = row.forward?.fwd20;
        if (!cell?.complete) return <span className={s.muted}>—</span>;
        return fmtPct(cell.closeRet);
      },
    },
  ];

  return (
    <div>
      <div className={s.pillGroup} style={{ marginBottom: 8 }}>
        {GENTLE_RISE_SUBSETS.map(tab => {
          const href = tab.slug
            ? `${GENTLE_RISE_SUBSET_BASE}/${tab.slug}`
            : GENTLE_RISE_SUBSET_BASE;
          return (
            <span
              key={tab.key}
              onClick={() => navigate(href)}
              className={cx(s.pill, subset.key === tab.key && s.pillActive)}
              title={tab.oneLiner}
            >
              {tab.label}
            </span>
          );
        })}
      </div>

      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>子集</span>
          <span>{subset.label} · {subset.kind === 'path' ? '路径确认' : '窗内形态'}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>规则</span>
          <span>{subset.ruleText}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>说明</span>
          <span>{subset.oneLiner}</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>口径</span>
          <span>{P.version} · 锚点 {ref.symbol}</span>
        </div>
        {rows.length > 0 && (
          <div className={s.statItem}>
            <span className={s.statLabel}>子集占比</span>
            <span>
              {subsetRows.length}/{rows.length}（{subsetHitRate.toFixed(1)}%）
              {ge100Share != null ? ` · 后30≥100% 占完整样本 ${ge100Share.toFixed(1)}%` : ''}
            </span>
          </div>
        )}
      </div>

      <div className={s.metaRow}>
        <span className={s.ruleText}>
          子 tab 共用同一次扫描与当日缓存；只改形态过滤与顶部后30摸高分布。
          路径类（D/E）需 fwd10 完整，未满 10 日前向的段不会进子集。
          改筛选阈值会让缓存指纹失效。
        </span>
        <div className={s.actions}>
          {rows.length > 0 && (
            <span className={s.countBadge}>
              {subset.key === 'all'
                ? `命中 ${displayRows.length}/${rows.length}`
                : `子集 ${displayRows.length}/${subsetRows.length} · 母体 ${rows.length}`}
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
            disabled={!displayRows.length || running}
            onClick={copyFiltered}
            title="复制当前过滤结果（含子集/档位/搜币）为 TSV"
          >
            复制当前
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<ReloadOutlined />}
            onClick={run}
            loading={running}
          >
            {running ? '扫描中...' : rows.length ? '重新扫描' : '开始扫描'}
          </Button>
          {running && (
            <Button size="small" onClick={stop}>停止</Button>
          )}
        </div>
      </div>

      <div className={s.filterRow}>
        <span className={s.muted}>起始日(UTC)</span>
        <input
          className={s.search}
          type="date"
          value={startDate}
          disabled={running}
          onChange={e => setStartDate(e.target.value || DEFAULT_START_DATE)}
          style={{ width: 140 }}
        />
        <span className={s.muted}>|</span>
        <input
          className={s.search}
          placeholder="搜币对"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: 120 }}
        />
      </div>

      {progress.total > 0 && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div className={s.progressBar} style={{ width: `${Math.round(percent)}%` }} />
          </div>
          <span className={s.progressText}>
            {progress.done}/{progress.total}
            {progress.symbol ? ` · ${progress.symbol}` : ''}
            {progress.page ? ` · p${progress.page}` : ''}
          </span>
        </div>
      )}

      <div className={s.statBar}>
        <span className={s.distTitle}>后30日摸高分布 · {subset.label}</span>
        <span className={s.muted}>
          完整样本 {fwd30Dist.total.toLocaleString()}
          {fwd30Dist.incomplete > 0 ? ` · 未满30日 ${fwd30Dist.incomplete}` : ''}
          {ge100Share != null ? ` · ≥100% 占比 ${ge100Share.toFixed(1)}%` : ''}
          {fwd30BucketKey
            ? ` · 已筛 ${FWD30_BUCKETS.find(b => b.key === fwd30BucketKey)?.label || ''}（${displayRows.length}）`
            : ' · 点击档位过滤表格'}
        </span>
        {fwd30Dist.buckets.map(bucket => (
          <span
            key={bucket.key}
            className={cx(s.distItem, fwd30BucketKey === bucket.key && s.distItemActive)}
            onClick={() => toggleFwd30Bucket(bucket.key)}
            title={fwd30BucketKey === bucket.key ? '再点取消过滤' : `只看后30摸高 ${bucket.label}`}
          >
            <span className={s.distLabel}>{bucket.label}</span>
            <span className={s.distCount}>{bucket.count.toLocaleString()}</span>
            <span className={s.distPct}>{bucket.pct.toFixed(1)}%</span>
          </span>
        ))}
        {fwd30BucketKey && (
          <span className={s.filterChip} onClick={() => setFwd30BucketKey(null)}>
            清除档位
          </span>
        )}
      </div>

      <ResultList
        columns={columns}
        rows={displayRows}
        empty={
          running
            ? '扫描中…'
            : rows.length
              ? `当前子集「${subset.label}」无命中（母体 ${rows.length} 段）`
              : '点击「开始扫描」按 AGT 缓坡口径扫 Binance 现存合约'
        }
        defaultSort={{ key: 'r2', dir: 'desc' }}
        highlightKey={displayRows.find(row => row.isReference)?.key}
      />
    </div>
  );
};

export default GentleRiseBacktest;