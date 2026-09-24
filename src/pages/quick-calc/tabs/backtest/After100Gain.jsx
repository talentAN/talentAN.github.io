import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getAllFutureDailyKlines, getMergedTradingPairs, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import ResultList from './_ResultList';
import { DEFAULT_LADDER, daysToLadderBreakeven } from './_ladderRules';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_DAYS = 3;
const DEFAULT_MIN_LISTING_DAYS = 30;
/** 默认只统计该 UTC 日起的日 K，避开早期极端行情 */
const DEFAULT_START_DATE = '2022-01-01';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const startDateToTs = dateStr => {
  const ts = moment.utc(dateStr, 'YYYY-MM-DD', true).startOf('day').valueOf();
  return Number.isFinite(ts) ? ts : null;
};

const fmtPrice = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (number >= 1000) return number.toFixed(2);
  if (number >= 1) return number.toFixed(4);
  return number.toPrecision(5);
};

const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(2)}%`;

const EX_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'binance', label: 'Binance' },
  { key: 'bitget', label: 'Bitget' },
];

/** 后3日最高价相对标记日开盘价的涨幅区间（入选样本当日已 >100%，故主指标通常 ≥100%） */
const AFTER_BUCKETS = [
  { key: 'b100_200', label: '100–200%', match: g => g >= 100 && g < 200 },
  { key: 'b200_300', label: '200–300%', match: g => g >= 200 && g < 300 },
  { key: 'b300_500', label: '300–500%', match: g => g >= 300 && g < 500 },
  { key: 'b500_1000', label: '500–1000%', match: g => g >= 500 && g < 1000 },
  { key: 'gte1000', label: '≥1000%', match: g => g >= 1000 },
  { key: 'lt100', label: '<100%', match: g => g < 100 },
];

/** 阶梯回本天数分桶（成交当日不计入，故无 0d） */
const RECOVER_BUCKETS = [
  { key: 'd1', label: '1d', match: d => d === 1 },
  { key: 'd2_3', label: '2–3d', match: d => d >= 2 && d <= 3 },
  { key: 'd4_7', label: '4–7d', match: d => d >= 4 && d <= 7 },
  { key: 'd8_14', label: '8–14d', match: d => d >= 8 && d <= 14 },
  { key: 'd15_30', label: '15–30d', match: d => d >= 15 && d <= 30 },
  { key: 'd31_60', label: '31–60d', match: d => d >= 31 && d <= 60 },
  { key: 'd61_90', label: '61–90d', match: d => d >= 61 && d <= 90 },
];

const emptyAfterCounts = () =>
  AFTER_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = 0;
    return acc;
  }, {});

const bumpAfterBucket = (counts, afterHighPct) => {
  if (!Number.isFinite(afterHighPct)) return;
  for (let i = 0; i < AFTER_BUCKETS.length; i++) {
    if (AFTER_BUCKETS[i].match(afterHighPct)) {
      counts[AFTER_BUCKETS[i].key] += 1;
      return;
    }
  }
};

const medianOf = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * 遍历单币全量日 K：筛「单日最高涨幅 >100%」且后续至少 1 根日 K，
 * 计算后最多 3 日最高价相对标记日开盘价的涨幅。
 */
const ingestPairCandles = (candles, pair, rows, scanFilter, afterCounts) => {
  const sorted = [...(candles || [])]
    .filter(c => Array.isArray(c) && c.length >= 5)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!sorted.length) return 0;

  const listedAt = Number(sorted[0][0]);
  if (!Number.isFinite(listedAt)) return 0;

  const startTs = Number.isFinite(scanFilter?.startTs) ? scanFilter.startTs : null;
  const filterOn = Boolean(scanFilter?.listingOn);
  const minDays = Number(scanFilter?.minDays) || 0;
  let sampled = 0;

  for (let i = 0; i < sorted.length; i++) {
    const candle = sorted[i];
    const open = Number(candle[1]);
    const high = Number(candle[2]);
    const close = Number(candle[4]);
    const ts = Number(candle[0]);
    if (!(open > 0) || !(high > 0) || !Number.isFinite(ts)) continue;
    if (startTs != null && ts < startTs) continue;

    const listingDays = Math.floor((ts - listedAt) / DAY_MS);
    if (filterOn && listingDays < minDays) continue;

    const gainPct = ((high - open) / open) * 100;
    if (!(gainPct > 100)) continue;

    let nextMaxHigh = null;
    let followDays = 0;
    for (let j = 1; j <= FOLLOW_DAYS; j++) {
      const next = sorted[i + j];
      if (!next) break;
      const nh = Number(next[2]);
      if (!(nh > 0)) continue;
      followDays += 1;
      nextMaxHigh = nextMaxHigh == null ? nh : Math.max(nextMaxHigh, nh);
    }
    if (followDays === 0 || nextMaxHigh == null) continue;

    const afterHighPct = ((nextMaxHigh - open) / open) * 100;

    const ladderCandles = sorted.slice(i, i + 1 + DEFAULT_LADDER.windowDays);
    const breakeven = daysToLadderBreakeven(open, ladderCandles, DEFAULT_LADDER);

    bumpAfterBucket(afterCounts, afterHighPct);
    sampled += 1;

    rows.push({
      key: `${pair.exchange}:${pair.symbol}:${ts}`,
      symbol: pair.symbol,
      exchange: pair.exchange,
      open,
      high,
      close: Number.isFinite(close) && close > 0 ? close : high,
      gainPct,
      nextMaxHigh,
      afterHighPct,
      followDays,
      candleTs: ts,
      date: moment.utc(ts).format('YYYY-MM-DD'),
      listingDays,
      listedAt,
      ladderFilled: breakeven.filled,
      ladderRecoverDays: breakeven.days,
      ladderRecoverStatus: breakeven.status,
    });
  }

  return sampled;
};

const withRank = list => list.map((row, index) => ({ ...row, rank: index + 1 }));

const After100Gain = () => {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({
    done: 0,
    total: 0,
    symbol: '',
    exchange: '',
    page: 0,
    candles: 0,
  });
  const [exFilter, setExFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [startDate, setStartDate] = useState(DEFAULT_START_DATE);
  const [listingFilterOn, setListingFilterOn] = useState(true);
  const [minListingDays, setMinListingDays] = useState(DEFAULT_MIN_LISTING_DAYS);
  const [scannedAt, setScannedAt] = useState(null);
  const [scannedCandles, setScannedCandles] = useState(0);
  const [afterCounts, setAfterCounts] = useState(emptyAfterCounts);
  const [appliedStartDate, setAppliedStartDate] = useState(DEFAULT_START_DATE);
  const [appliedListing, setAppliedListing] = useState({
    on: true,
    minDays: DEFAULT_MIN_LISTING_DAYS,
  });
  const abortRef = useRef(null);
  const scanFilterRef = useRef({
    startTs: startDateToTs(DEFAULT_START_DATE),
    listingOn: true,
    minDays: DEFAULT_MIN_LISTING_DAYS,
  });

  scanFilterRef.current = {
    startTs: startDateToTs(startDate),
    listingOn: listingFilterOn,
    minDays: minListingDays,
  };

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const scanFilter = { ...scanFilterRef.current };
    if (scanFilter.startTs == null) {
      message.error('起始日期无效，请使用 YYYY-MM-DD');
      return;
    }

    setRunning(true);
    setRows([]);
    setScannedCandles(0);
    setAfterCounts(emptyAfterCounts());
    setAppliedStartDate(startDate);
    setAppliedListing({
      on: Boolean(scanFilter.listingOn),
      minDays: Number(scanFilter.minDays) || 0,
    });
    setProgress({ done: 0, total: 0, symbol: '', exchange: '', page: 0, candles: 0 });

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
    const collected = [];
    const counts = emptyAfterCounts();
    let candleTotal = 0;
    let failed = 0;

    for (let index = 0; index < pairs.length; index++) {
      if (controller.signal.aborted) break;
      const pair = pairs[index];
      setProgress({
        done: index,
        total: pairs.length,
        symbol: pair.symbol,
        exchange: pair.exchange,
        page: 0,
        candles: 0,
      });

      try {
        const candles = await getAllFutureDailyKlines(
          {
            symbol: pair.symbol,
            signal: controller.signal,
            onPage: ({ page, loaded }) =>
              setProgress(prev => ({ ...prev, page, candles: loaded })),
          },
          pair.exchange
        );
        candleTotal += ingestPairCandles(candles, pair, collected, scanFilter, counts);
        // 扫描中按续涨降序展示，避免中间态乱序
        setRows(
          withRank(
            [...collected].sort((a, b) => b.afterHighPct - a.afterHighPct || b.gainPct - a.gainPct)
          )
        );
        setScannedCandles(candleTotal);
        setAfterCounts({ ...counts });
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

    const sorted = [...collected].sort(
      (a, b) => b.afterHighPct - a.afterHighPct || b.gainPct - a.gainPct
    );
    setRows(withRank(sorted));
    setScannedCandles(candleTotal);
    setAfterCounts({ ...counts });
    setScannedAt(Date.now());
    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) message.info('已停止，保留当前结果');
    else {
      message.success(
        `扫描完成：${pairs.length - failed}/${pairs.length} 币对，命中 ${sorted.length} 条（单日最高涨幅>100% 且有后续日 K）`
      );
    }
  };

  const stop = () => abortRef.current?.abort();

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    const minDays = Number(minListingDays) || 0;
    const startTs = startDateToTs(startDate);
    const filtered = rows.filter(row => {
      if (exFilter !== 'all' && row.exchange !== exFilter) return false;
      if (query && !row.symbol.includes(query)) return false;
      if (startTs != null && row.candleTs < startTs) return false;
      if (listingFilterOn && row.listingDays < minDays) return false;
      return true;
    });
    return withRank(filtered);
  }, [rows, exFilter, keyword, listingFilterOn, minListingDays, startDate]);

  const afterDist = useMemo(() => {
    const total = AFTER_BUCKETS.reduce((sum, bucket) => sum + (afterCounts[bucket.key] || 0), 0);
    return {
      total,
      buckets: AFTER_BUCKETS.map(bucket => {
        const count = afterCounts[bucket.key] || 0;
        return {
          ...bucket,
          count,
          pct: total ? (count / total) * 100 : 0,
        };
      }),
    };
  }, [afterCounts]);

  /** 阶梯回本天数分布：跟当前表格筛选一致 */
  const recoverDist = useMemo(() => {
    const dayCounts = RECOVER_BUCKETS.reduce((acc, bucket) => {
      acc[bucket.key] = 0;
      return acc;
    }, {});
    let none = 0;
    let open = 0;
    const recoveredDays = [];

    displayRows.forEach(row => {
      if (row.ladderRecoverStatus === 'none' || !row.ladderFilled) {
        none += 1;
        return;
      }
      if (row.ladderRecoverStatus === 'recovered' && Number.isFinite(row.ladderRecoverDays)) {
        recoveredDays.push(row.ladderRecoverDays);
        for (let i = 0; i < RECOVER_BUCKETS.length; i++) {
          if (RECOVER_BUCKETS[i].match(row.ladderRecoverDays)) {
            dayCounts[RECOVER_BUCKETS[i].key] += 1;
            return;
          }
        }
        return;
      }
      open += 1;
    });

    const total = displayRows.length;
    const filled = total - none;
    const recovered = recoveredDays.length;
    const pctOf = count => (total ? (count / total) * 100 : 0);
    const pctOfFilled = count => (filled ? (count / filled) * 100 : 0);
return {
      total,
      filled,
      recovered,
      none,
      open,
      recoverRate: filled ? (recovered / filled) * 100 : null,
      medianDays: medianOf(recoveredDays),
      buckets: [
        ...RECOVER_BUCKETS.map(bucket => ({
          ...bucket,
          count: dayCounts[bucket.key],
          pct: pctOf(dayCounts[bucket.key]),
        })),
        { key: 'open', label: '未回本', count: open, pct: pctOf(open) },
        { key: 'none', label: '未成交', count: none, pct: pctOf(none) },
      ],
      filledNote:
        filled > 0
          ? `成交 ${filled.toLocaleString()} · 已回本 ${recovered.toLocaleString()}（占成交 ${pctOfFilled(recovered).toFixed(1)}%）`
          : null,
    };
  }, [displayRows]);

  const percent = progress.total ? (progress.done / progress.total) * 100 : 0;

  const columns = [
    {
      key: 'rank',
      title: '#',
      width: 44,
      align: 'center',
      sortBy: row => row.rank,
      render: row => <span className={s.muted}>{row.rank}</span>,
    },
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
            {row.symbol.replace('USDT', '')}
          </a>
          <span className={s.exchangeTag}>{row.exchange === 'binance' ? 'BN' : 'BG'}</span>
        </>
      ),
    },
    {
      key: 'date',
      title: 'UTC 日',
      width: 100,
      sortBy: row => row.candleTs,
      render: row => <span className={s.muted}>{row.date}</span>,
    },
    {
      key: 'listingDays',
      title: '已上线',
      width: 72,
      align: 'right',
      sortBy: row => row.listingDays,
      render: row => <span className={s.muted}>{row.listingDays}d</span>,
    },
    {
      key: 'open',
      title: '开盘',
      width: 96,
      align: 'right',
      sortBy: row => row.open,
      render: row => fmtPrice(row.open),
    },
    {
      key: 'high',
      title: '当日最高',
      width: 96,
      align: 'right',
      sortBy: row => row.high,
      render: row => fmtPrice(row.high),
    },
    {
      key: 'gainPct',
      title: '当日最高涨幅',
      width: 110,
      align: 'right',
      sortBy: row => row.gainPct,
      render: row => <span className={cx(s.badge, s.badgeRed)}>{fmtPct(row.gainPct)}</span>,
    },
    {
      key: 'nextMaxHigh',
      title: '后3日最高',
      width: 96,
      align: 'right',
      sortBy: row => row.nextMaxHigh,
      render: row => fmtPrice(row.nextMaxHigh),
    },
    {
      key: 'afterHighPct',
      title: '后3日相对涨幅',
      width: 120,
      align: 'right',
      sortBy: row => row.afterHighPct,
      render: row => <span className={cx(s.badge, s.badgeRed)}>{fmtPct(row.afterHighPct)}</span>,
    },
    {
      key: 'followDays',
      title: '后续天数',
      width: 72,
      align: 'right',
      sortBy: row => row.followDays,
      render: row => <span className={s.muted}>{row.followDays}</span>,
    },
    {
      key: 'ladderRecoverDays',
      title: `阶梯回本(≤${DEFAULT_LADDER.windowDays}d)`,
      width: 120,
      align: 'right',
      sortBy: row =>
        row.ladderRecoverStatus === 'recovered'
          ? row.ladderRecoverDays
          : row.ladderRecoverStatus === 'open'
            ? Number.POSITIVE_INFINITY
            : Number.NEGATIVE_INFINITY,
      render: row => {
        if (row.ladderRecoverStatus === 'none' || !row.ladderFilled) {
          return <span className={s.muted}>未成交</span>;
        }
        if (row.ladderRecoverStatus === 'recovered') {
          return (
            <span className={cx(s.badge, s.badgeGreen)}>
              {row.ladderRecoverDays}d · {row.ladderFilled}/{DEFAULT_LADDER.levels.length}
            </span>
          );
        }
        return (
          <span className={cx(s.badge, s.badgeGrey)}>
            未回本 · {row.ladderFilled}/{DEFAULT_LADDER.levels.length}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>入选</span>
          <span>单日最高价 ÷ 开盘价 − 1 &gt; 100%</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>主指标</span>
          <span>后≤3 日最高价 ÷ 当日开盘价 − 1</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>范围</span>
          <span>现存合约 · 默认自 {DEFAULT_START_DATE} UTC 起</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>默认过滤</span>
          <span>上线未满 {DEFAULT_MIN_LISTING_DAYS} 天</span>
        </div>
        {scannedCandles > 0 && (
          <div className={s.statItem}>
            <span className={s.statLabel}>命中</span>
            <span>{scannedCandles.toLocaleString()} 条</span>
          </div>
        )}
        {scannedAt && (
          <div className={s.statItem}>
            <span className={s.statLabel}>上次</span>
            <span>{moment(scannedAt).format('HH:mm:ss')}</span>
          </div>
        )}
      </div>

      <div className={s.metaRow}>
        <span className={s.ruleText}>
          扫描口径对齐「data-单日最高涨幅」：仍拉全量日 K 算上线天数；只保留起始日及之后、默认上线≥
          {DEFAULT_MIN_LISTING_DAYS} 天、且单日最高涨幅&gt;100%、其后至少还有 1 根日 K 的样本。后 3
          日不足时按实际可用天数计。「阶梯回本」按 DEFAULT_LADDER（
          {DEFAULT_LADDER.levels.map(l => `${l.mult}×`).join('/')}
          ）日 K 撮合：成交当日不判回本，从次日看 low≤加权均价（再有新成交的当日同样跳过）。窗口{' '}
          {DEFAULT_LADDER.windowDays} 日。改过滤条件后请重新扫描。
        </span>
        <div className={s.actions}>
          {displayRows.length > 0 && <span className={s.countBadge}>共 {displayRows.length} 条</span>}
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
            {progress.done}/{progress.total}
            {progress.symbol
              ? ` · ${progress.exchange === 'binance' ? 'BN' : 'BG'} ${progress.symbol}${
                  progress.page ? ` · ${progress.page}页/${progress.candles}根` : ''
                }`
              : ''}
          </span>
        </div>
      )}

      <div className={s.filterRow}>
        <span className={s.muted}>起始日(UTC)</span>
        <input
          className={s.search}
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value || DEFAULT_START_DATE)}
          style={{ width: 140 }}
        />
        <span className={s.muted}>|</span>
        <Checkbox
          checked={listingFilterOn}
          onChange={e => setListingFilterOn(e.target.checked)}
        >
          过滤上线未满
        </Checkbox>
        <InputNumber
          size="small"
          min={0}
          step={1}
          value={minListingDays}
          onChange={value => setMinListingDays(value == null ? 0 : Number(value))}
          disabled={!listingFilterOn}
          style={{ width: 72 }}
        />
        <span className={s.muted}>天</span>
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
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="筛选币对"
        />
      </div>

      <div className={s.statBar}>
        <span className={s.distTitle}>后3日相对涨幅分布</span>
        <span className={s.muted}>
          样本 {afterDist.total.toLocaleString()}
          {` · ≥${appliedStartDate}`}
          {appliedListing.on ? ` · 上线≥${appliedListing.minDays}天` : ''}
        </span>
        {afterDist.buckets.map(bucket => (
          <span key={bucket.key} className={cx(s.distItem, s.distItemStatic)}>
            <span className={s.distLabel}>{bucket.label}</span>
            <span className={s.distCount}>{bucket.count.toLocaleString()}</span>
            <span className={s.distPct}>{bucket.pct.toFixed(2)}%</span>
          </span>
        ))}
      </div>

      <div className={s.statBar}>
        <span className={s.distTitle}>阶梯回本天数分布</span>
        <span className={s.muted}>
          样本 {recoverDist.total.toLocaleString()}
          {recoverDist.filledNote ? ` · ${recoverDist.filledNote}` : ''}
          {recoverDist.medianDays != null
            ? ` · 回本中位 ${Number(recoverDist.medianDays).toFixed(recoverDist.medianDays % 1 ? 1 : 0)}d`
            : ''}
        </span>
        {recoverDist.buckets.map(bucket => (
          <span key={bucket.key} className={cx(s.distItem, s.distItemStatic)}>
            <span className={s.distLabel}>{bucket.label}</span>
            <span className={s.distCount}>{bucket.count.toLocaleString()}</span>
            <span className={s.distPct}>{bucket.pct.toFixed(2)}%</span>
          </span>
        ))}
      </div>

      <ResultList
        columns={columns}
        rows={displayRows}
        empty={
          running
            ? '扫描中（全量日 K，耗时较长）...'
            : `点击「开始扫描」：默认自 ${DEFAULT_START_DATE} 起 + 上线≥${DEFAULT_MIN_LISTING_DAYS} 天，列出单日最高涨幅>100% 后 3 日续涨`
        }
        defaultSort={{ key: 'afterHighPct', dir: 'desc' }}
      />
    </div>
  );
};

export default After100Gain;