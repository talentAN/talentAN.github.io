import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, InputNumber, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getAllFutureDailyKlines, getMergedTradingPairs, getTradeUrl } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import ResultList from './_ResultList';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const TOP_N = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
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

/** 涨幅区间（仅统计 >100%）：首档 (100, 300)，其后左闭右开，最后一档 ≥4000% */
const GAIN_BUCKETS = [
  { key: 'b100_300', label: '100–300%', match: g => g > 100 && g < 300 },
  { key: 'b300_500', label: '300–500%', match: g => g >= 300 && g < 500 },
  { key: 'b500_1000', label: '500–1000%', match: g => g >= 500 && g < 1000 },
  { key: 'b1000_2000', label: '1000–2000%', match: g => g >= 1000 && g < 2000 },
  { key: 'b2000_4000', label: '2000–4000%', match: g => g >= 2000 && g < 4000 },
  { key: 'gte4000', label: '≥4000%', match: g => g >= 4000 },
];

const emptyGainCounts = () =>
  GAIN_BUCKETS.reduce((acc, bucket) => {
    acc[bucket.key] = 0;
    return acc;
  }, {});

const bumpGainBucket = (counts, gainPct) => {
  if (!(gainPct > 100)) return;
  for (let i = 0; i < GAIN_BUCKETS.length; i++) {
    if (GAIN_BUCKETS[i].match(gainPct)) {
      counts[GAIN_BUCKETS[i].key] += 1;
      return;
    }
  }
};
/**
 * 固定容量最小堆：堆顶是当前 Top-N 里涨幅最小的，新值更大则替换堆顶。
 * 只保留至多 capacity 条候选，避免全市场全历史日 K 占内存。
 */
class MinGainHeap {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = [];
  }

  size() {
    return this.items.length;
  }

  peek() {
    return this.items[0] || null;
  }

  push(item) {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      this.siftUp(this.items.length - 1);
      return;
    }
    if (item.gainPct <= this.items[0].gainPct) return;
    this.items[0] = item;
    this.siftDown(0);
  }

  /** 按涨幅降序取出 */
  toSortedDesc() {
    return [...this.items].sort((a, b) => b.gainPct - a.gainPct);
  }

  siftUp(index) {
    const items = this.items;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[index].gainPct >= items[parent].gainPct) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  siftDown(index) {
    const items = this.items;
    const n = items.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;
      if (left < n && items[left].gainPct < items[smallest].gainPct) smallest = left;
      if (right < n && items[right].gainPct < items[smallest].gainPct) smallest = right;
      if (smallest === index) break;
      [items[index], items[smallest]] = [items[smallest], items[index]];
      index = smallest;
    }
  }
}

/** 遍历单币全量日 K：累计涨幅区间计数 + 写入 Top 堆；返回计入统计的样本数（过起始日+上线过滤） */
const ingestPairCandles = (candles, pair, heap, scanFilter, gainCounts) => {
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
    bumpGainBucket(gainCounts, gainPct);
    sampled += 1;

    // 堆顶已是 Top-N 最小涨幅时，更小的直接跳过，少做对象分配
    const peek = heap.peek();
    if (heap.size() >= heap.capacity && peek && gainPct <= peek.gainPct) continue;

    heap.push({
      key: `${pair.exchange}:${pair.symbol}:${ts}`,
      symbol: pair.symbol,
      exchange: pair.exchange,
      open,
      high,
      close: Number.isFinite(close) && close > 0 ? close : high,
      gainPct,
      candleTs: ts,
      date: moment.utc(ts).format('YYYY-MM-DD'),
      listingDays,
      listedAt,
    });
  }

  return sampled;
};

const withRank = list => list.map((row, index) => ({ ...row, rank: index + 1 }));

const DayHighGain = () => {
  const [topRows, setTopRows] = useState([]);
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
  const [gainCounts, setGainCounts] = useState(emptyGainCounts);
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
    setTopRows([]);
    setScannedCandles(0);
    setGainCounts(emptyGainCounts());
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
    const heap = new MinGainHeap(TOP_N);
    const counts = emptyGainCounts();
    let candleTotal = 0;
    let failed = 0;

    // 逐币拉全量日 K（不全量落盘），边扫边用最小堆维护涨幅 Top-N，并累计区间分布
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
        candleTotal += ingestPairCandles(candles, pair, heap, scanFilter, counts);
        setTopRows(withRank(heap.toSortedDesc()));
        setScannedCandles(candleTotal);
        setGainCounts({ ...counts });
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

    setTopRows(withRank(heap.toSortedDesc()));
    setScannedCandles(candleTotal);
    setGainCounts({ ...counts });
    setScannedAt(Date.now());
    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) message.info('已停止，保留当前 Top 结果');
    else {
      message.success(
        `扫描完成：${pairs.length - failed}/${pairs.length} 币对，约 ${candleTotal} 根有效日 K，Top ${TOP_N}`
      );
    }
  };

  const stop = () => abortRef.current?.abort();

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    const minDays = Number(minListingDays) || 0;
    const startTs = startDateToTs(startDate);
    const filtered = topRows.filter(row => {
      if (exFilter !== 'all' && row.exchange !== exFilter) return false;
      if (query && !row.symbol.includes(query)) return false;
      if (startTs != null && row.candleTs < startTs) return false;
      if (listingFilterOn && row.listingDays < minDays) return false;
      return true;
    });
    return withRank(filtered);
  }, [topRows, exFilter, keyword, listingFilterOn, minListingDays, startDate]);

  const gainDist = useMemo(() => {
    const total = GAIN_BUCKETS.reduce((sum, bucket) => sum + (gainCounts[bucket.key] || 0), 0);
    return {
      total,
      buckets: GAIN_BUCKETS.map(bucket => {
        const count = gainCounts[bucket.key] || 0;
        return {
          ...bucket,
          count,
          pct: total ? (count / total) * 100 : 0,
        };
      }),
    };
  }, [gainCounts]);

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
      width: 100,
      align: 'right',
      sortBy: row => row.open,
      render: row => fmtPrice(row.open),
    },
    {
      key: 'high',
      title: '最高',
      width: 100,
      align: 'right',
      sortBy: row => row.high,
      render: row => fmtPrice(row.high),
    },
    {
      key: 'close',
      title: '收盘',
      width: 100,
      align: 'right',
      sortBy: row => row.close,
      render: row => fmtPrice(row.close),
    },
    {
      key: 'gainPct',
      title: '最高涨幅',
      width: 100,
      align: 'right',
      sortBy: row => row.gainPct,
      render: row => <span className={cx(s.badge, s.badgeRed)}>{fmtPct(row.gainPct)}</span>,
    },
  ];

  return (
    <div>
      <div className={s.statBar}>
        <div className={s.statItem}>
          <span className={s.statLabel}>口径</span>
          <span>单日最高价 ÷ 开盘价 − 1</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>范围</span>
          <span>现存合约 · 默认自 {DEFAULT_START_DATE} UTC 起</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>默认过滤</span>
          <span>上线未满 {DEFAULT_MIN_LISTING_DAYS} 天</span>
        </div>
        <div className={s.statItem}>
          <span className={s.statLabel}>内存</span>
          <span>最小堆仅留 Top {TOP_N}</span>
        </div>
        {scannedCandles > 0 && (
          <div className={s.statItem}>
            <span className={s.statLabel}>已扫 K</span>
            <span>{scannedCandles.toLocaleString()}</span>
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
          仍拉全量日 K 以计算上线天数，但入堆与分布只保留「起始日及之后」且（默认）上线≥
          {DEFAULT_MIN_LISTING_DAYS} 天的样本。修改起始日 / 上线过滤后请重新扫描，才能得到对应口径的完整
          Top{TOP_N} 与分布。
        </span>
        <div className={s.actions}>
          {displayRows.length > 0 && <span className={s.countBadge}>共 {displayRows.length} 条</span>}
          <Button size="small" type="primary" icon={<ReloadOutlined />} loading={running} onClick={run}>
            {running ? '扫描中...' : topRows.length ? '重新扫描' : '开始扫描'}
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
        <span className={s.distTitle}>涨幅分布（&gt;100%）</span>
        <span className={s.muted}>
          样本 {gainDist.total.toLocaleString()}
          {` · ≥${appliedStartDate}`}
          {appliedListing.on ? ` · 上线≥${appliedListing.minDays}天` : ''}
        </span>
        {gainDist.buckets.map(bucket => (
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
            : `点击「开始扫描」：默认自 ${DEFAULT_START_DATE} 起 + 上线≥${DEFAULT_MIN_LISTING_DAYS} 天，统计单日最高涨幅 Top100`
        }
        defaultSort={{ key: 'gainPct', dir: 'desc' }}
      />
    </div>
  );
};

export default DayHighGain