import React, { useState, useEffect, useRef } from 'react';
import { Button, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getMergedTradingPairs, getFutureKlineData, getTradeUrl } from '@root/src/container/market';
import watchData from '@root/contract-record/watch.json';
import moment from 'moment';
import PositionCalculatorButton from '@trade/system_1/PositionCalculatorButton';
import {
  SPIKE_CONFIG,
  HOLD_CONFIG,
  MARKET_CONFIG,
  RATIO_COLOR,
} from '@root/src/consts/pairSelectorConfig';
import { MARKET_DATA_CONFIG } from '@root/src/configs/pairSelectorConfig';
import { getSingleDaySpike, getWindowPeakSignal, getHoldReference } from './_pairSelectorRules';
import DataList from './_DataList';
import UsStockPanel from './_UsStockPanel';
import * as s from './pairSelector.module.less';

const WATCHING_SYMBOLS = new Set(watchData.filter(d => !d.achieved).map(d => d.symbol));

// 市场分页
const MARKET_CRYPTO = 'crypto';
const MARKET_US = 'us';

// 筛选模式
const MODE_SPIKE = 'spike'; // 过去4天内单日涨幅 ≥30% 或最高价高于最远一天开盘价的40%
const MODE_HOLD = 'hold'; // 90天内最近一次暴涨 ≥30% 或连续 4 天最高价高于第一天开盘价 50%，且当前价仍高位

const MARKET_TABS = [
  { label: '虚拟币', value: MARKET_CRYPTO },
  { label: '美股', value: MARKET_US },
];

const MODE_OPTIONS = [
  { label: '过去4天暴涨', value: MODE_SPIKE },
  { label: '90天内暴涨仍高位', value: MODE_HOLD },
];

const TRIGGER_FILTERS = ['全部', '暴涨', '连续4天', '两者'];

const cx = (...names) => names.filter(Boolean).join(' ');

const fmtPrice = v => (v != null && Number.isFinite(v) ? v.toPrecision(5) : '—');

const Badge = ({ tone, children }) => <span className={cx(s.badge, s[tone])}>{children}</span>;

const PairSelector = () => {
  const [market, setMarket] = useState(MARKET_CRYPTO);
  const [tradingPairs, setTradingPairs] = useState([]);
  const [marketData, setMarketData] = useState({ BTC: {}, ETH: {} });
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [mode, setMode] = useState(MODE_SPIKE);
  const [spikeResults, setSpikeResults] = useState([]);
  const [holdResults, setHoldResults] = useState([]);
  const [triggerFilter, setTriggerFilter] = useState('全部');
  const [spikeProgress, setSpikeProgress] = useState({ checked: 0, total: 0 });
  const [spikeRunning, setSpikeRunning] = useState(false);
  const abortRef = useRef(false);

  const calculatePriceChange = (klineData, days) => {
    if (!klineData || klineData.length < days) return null;
    const latestPrice = parseFloat(klineData[klineData.length - 1][4]);
    const pastPrice = parseFloat(klineData[klineData.length - 1 - days][4]);
    return (((latestPrice - pastPrice) / pastPrice) * 100).toFixed(2);
  };

  const renderMarketStats = (symbol, data) => {
    const latest = data && data.latest ? Number(data.latest) : null;
    return (
      <div className={s.marketItem}>
        <span className={s.marketSymbol}>{symbol}</span>
        {latest ? (
          <a
            className={s.marketPrice}
            href={getTradeUrl(`${symbol}USDT`, 'binance')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {latest.toLocaleString()}
          </a>
        ) : (
          <span className={s.muted}>-</span>
        )}
        {MARKET_DATA_CONFIG.displayPeriods.map(days => {
          const key = `day${days}`;
          const raw = data && (data[key] === 0 || data[key] ? data[key] : null);
          const val = raw !== null ? parseFloat(raw) : null;
          const tone = val === null ? s.chipFlat : val >= 0 ? s.chipUp : s.chipDown;
          return (
            <span key={days} className={cx(s.chip, tone)}>
              <span className={s.chipLabel}>{days}日</span>
              {val === null ? '-' : `${val.toFixed(2)}%`}
            </span>
          );
        })}
      </div>
    );
  };

  const fetchMarketData = async () => {
    setLoadingMarket(true);
    try {
      const endTime = moment().valueOf();
      const startTime = moment().subtract(MARKET_CONFIG.klineDays, 'days').valueOf();

      const [btcData, ethData] = await Promise.all([
        getFutureKlineData(
          {
            symbol: 'BTCUSDT',
            granularity: '1D',
            limit: MARKET_CONFIG.klineDays,
            startTime,
            endTime,
          },
          'binance'
        ),
        getFutureKlineData(
          {
            symbol: 'ETHUSDT',
            granularity: '1D',
            limit: MARKET_CONFIG.klineDays,
            startTime,
            endTime,
          },
          'binance'
        ),
      ]);

      const mkChange = (data, days) => calculatePriceChange(data, days);
      const safeLatest = data =>
        data && Array.isArray(data) && data.length ? parseFloat(data[data.length - 1][4]) : null;
      setMarketData({
        BTC: {
          latest: safeLatest(btcData.data),
          day7: mkChange(btcData.data, MARKET_CONFIG.periods[0]),
          day15: mkChange(btcData.data, MARKET_CONFIG.periods[1]),
          day45: mkChange(btcData.data, MARKET_CONFIG.periods[2]),
        },
        ETH: {
          latest: safeLatest(ethData.data),
          day7: mkChange(ethData.data, MARKET_CONFIG.periods[0]),
          day15: mkChange(ethData.data, MARKET_CONFIG.periods[1]),
          day45: mkChange(ethData.data, MARKET_CONFIG.periods[2]),
        },
      });
    } catch (error) {
      message.error('获取市场数据失败：' + error.message);
    } finally {
      setLoadingMarket(false);
    }
  };

  const loadData = () => {
    abortRef.current = true;
    setSpikeRunning(false);
    getMergedTradingPairs().then(res => setTradingPairs(res));
  };

  // 模式一：过去 4 天内单日涨幅 ≥30% 或过去 4 天最高价高于最远一天开盘价的 40%
  const runSpikeFilter = async () => {
    abortRef.current = false;
    setSpikeRunning(true);
    setSpikeResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getMergedTradingPairs();
    if (!tradingPairs.length) setTradingPairs(pairs);

    const startTime = moment
      .utc()
      .subtract(SPIKE_CONFIG.windowDays, 'days')
      .startOf('day')
      .valueOf();
    const endTime = moment.utc().valueOf();
    setSpikeProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol, exchange: pairExchange } = pairs[i];
      try {
        const res = await getFutureKlineData(
          {
            symbol,
            granularity: '1Dutc',
            limit: SPIKE_CONFIG.windowDays + 1,
            startTime,
            endTime,
          },
          pairExchange
        );
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        );

        if (candles.length < 2) {
          setSpikeProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const spikeSignal = getSingleDaySpike(candles);
        const peakSignal = getWindowPeakSignal(candles);
        const qualified = Boolean(spikeSignal) || Boolean(peakSignal);

        if (qualified && !WATCHING_SYMBOLS.has(symbol)) {
          const trigger = spikeSignal ? (peakSignal ? '两者' : '单日暴涨') : '窗口峰值';
          matched.push({
            key: `${pairExchange}:${symbol}`,
            symbol,
            exchange: pairExchange,
            date: spikeSignal?.date || peakSignal?.date,
            rise: spikeSignal?.rise,
            firstOpen: peakSignal?.firstOpen,
            maxHigh: peakSignal?.maxHigh,
            peakRatio: peakSignal?.ratio,
            trigger,
          });
          setSpikeResults([...matched]);
        }
      } catch (_) {}
      setSpikeProgress({ checked: i + 1, total: pairs.length });
    }
    setSpikeRunning(false);
  };

  // 模式二：90天内最近一次暴涨 ≥30% 或存在连续 4 天，4 天内最高价高于第一天开盘价 50%，且当前价仍 ≥ 基准价 × 95%
  const runHoldFilter = async () => {
    abortRef.current = false;
    setSpikeRunning(true);
    setHoldResults([]);

    const pairs = tradingPairs.length ? tradingPairs : await getMergedTradingPairs();
    if (!tradingPairs.length) setTradingPairs(pairs);

    const endTime = moment.utc().valueOf();
    setSpikeProgress({ checked: 0, total: pairs.length });

    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol, exchange: pairExchange } = pairs[i];
      try {
        // 只传 endTime + limit，避免触发"区间不能超过90天"限制
        const res = await getFutureKlineData(
          {
            symbol,
            granularity: '1Dutc',
            limit: HOLD_CONFIG.klineLimit,
            endTime,
          },
          pairExchange
        );
        const candles = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        ); // 升序：oldest → newest
        if (candles.length < 2) {
          setSpikeProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        const holdSignal = getHoldReference(candles);
        if (holdSignal && !WATCHING_SYMBOLS.has(symbol)) {
          const yesterdayHigh =
            candles.length >= 2 ? parseFloat(candles[candles.length - 2][2]) : null;
          matched.push({
            key: `${pairExchange}:${symbol}`,
            symbol,
            exchange: pairExchange,
            spikeDate: holdSignal.referenceDate,
            spikeRise: holdSignal.referenceRise || '—',
            spikeClose: holdSignal.spikeClose,
            refPrice: holdSignal.baseline,
            currentPrice: holdSignal.currentPrice,
            yesterdayHigh: Number.isFinite(yesterdayHigh) ? yesterdayHigh : null,
            ratio: ((holdSignal.currentPrice / holdSignal.baseline) * 100).toFixed(1),
            trigger: holdSignal.trigger,
            daysAgo: holdSignal.daysAgo,
          });
          setHoldResults([...matched]);
        }
      } catch (_) {}
      setSpikeProgress({ checked: i + 1, total: pairs.length });
    }
    setSpikeRunning(false);
  };

  const handleRun = () => (mode === MODE_SPIKE ? runSpikeFilter() : runHoldFilter());

  // 合并拉取两所币对 + 大盘数据（不再切换交易所）
  useEffect(() => {
    loadData();
    fetchMarketData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbolCell = row => (
    <a
      className={s.symbolLink}
      href={getTradeUrl(row.symbol, row.exchange)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {row.symbol}
    </a>
  );

  const spikeColumns = [
    { key: 'symbol', title: '币对', width: 150, render: symbolCell },
    {
      key: 'date',
      title: '触发日期',
      width: 120,
      render: r => <span className={s.muted}>{r.date}</span>,
    },
    ...(spikeResults.some(r => r.trigger === '单日暴涨' || r.trigger === '两者')
      ? [
          {
            key: 'rise',
            title: '当日涨幅',
            width: 100,
            sortBy: r => parseFloat(r.rise),
            render: r => (r.rise ? <Badge tone="badgeGreen">+{r.rise}%</Badge> : '—'),
          },
        ]
      : []),
    ...(spikeResults.some(r => r.trigger === '窗口峰值' || r.trigger === '两者')
      ? [
          {
            key: 'openHigh',
            title: '开盘价 / 最高价',
            sortBy: r => parseFloat(r.peakRatio),
            render: r =>
              r.firstOpen != null && r.maxHigh != null ? (
                <span>
                  {r.firstOpen.toPrecision(5)}
                  <span className={s.muted}> / </span>
                  {r.maxHigh.toPrecision(5)}
                  {r.peakRatio != null && (
                    <span style={{ marginLeft: 6 }}>
                      <Badge tone="badgeGreen">+{r.peakRatio}%</Badge>
                    </span>
                  )}
                </span>
              ) : (
                '—'
              ),
          },
        ]
      : []),
  ];

  const holdColumns = [
    { key: 'symbol', title: '币对', width: 140, render: symbolCell },
    {
      key: 'spikeDate',
      title: '暴涨日期',
      width: 100,
      render: r => <span className={s.muted}>{r.spikeDate}</span>,
    },
    {
      key: 'daysAgo',
      title: '距今',
      width: 60,
      align: 'center',
      sortBy: r => r.daysAgo,
      render: r => r.daysAgo,
    },
    {
      key: 'spikeRise',
      title: '暴涨幅度',
      width: 90,
      sortBy: r => parseFloat(r.spikeRise),
      render: r =>
        r.spikeRise && r.spikeRise !== '—' ? <Badge tone="badgeRed">+{r.spikeRise}%</Badge> : '—',
    },
    { key: 'spikeClose', title: '暴涨收盘', width: 100, render: r => fmtPrice(r.spikeClose) },
    { key: 'refPrice', title: '基准价(a)', width: 100, render: r => fmtPrice(r.refPrice) },
    { key: 'currentPrice', title: '当前价', width: 100, render: r => fmtPrice(r.currentPrice) },
    { key: 'yesterdayHigh', title: '昨日最高', width: 100, render: r => fmtPrice(r.yesterdayHigh) },
    {
      key: 'ratio',
      title: '当前/暴涨',
      width: 90,
      sortBy: r => parseFloat(r.ratio),
      render: r => {
        const p = parseFloat(r.ratio);
        const tone =
          p >= RATIO_COLOR.green
            ? 'badgeGreen'
            : p >= RATIO_COLOR.orange
              ? 'badgeOrange'
              : 'badgeRed';
        return <Badge tone={tone}>{r.ratio}%</Badge>;
      },
    },
    {
      key: 'trigger',
      title: '触发',
      width: 80,
      render: r => (
        <Badge
          tone={
            r.trigger === '两者' ? 'badgeGreen' : r.trigger === '暴涨' ? 'badgeBlue' : 'badgeOrange'
          }
        >
          {r.trigger}
        </Badge>
      ),
    },
  ];

  const rows = mode === MODE_SPIKE ? spikeResults : holdResults;
  const visibleRows =
    mode === MODE_HOLD && triggerFilter !== '全部'
      ? rows.filter(r => r.trigger === triggerFilter)
      : rows;

      return (
        <div className={s.panel}>
          <div className={s.toolbar}>
            <div className={s.cascade}>
              <div className={s.pillGroup}>
                {MARKET_TABS.map(t => (
                  <span
                    key={t.value}
                    onClick={() => setMarket(t.value)}
                    className={cx(
                      s.pill,
                      market === t.value && s.pillActive,
                      market === t.value && s.pillActivePrimary
                    )}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              <span className={s.cascadeSep}>›</span>
              <div className={s.pillGroup}>
                {MODE_OPTIONS.map(o => (
                  <span
                    key={o.value}
                    onClick={() => {
                      setMode(o.value);
                      setSpikeProgress({ checked: 0, total: 0 });
                    }}
                    className={cx(s.pill, mode === o.value && s.pillActive)}
                  >
                    {o.label}
                  </span>
                ))}
              </div>
            </div>
    
            {market === MARKET_US ? (
              <PositionCalculatorButton />
            ) : (
              <div className={s.actions}>
                <PositionCalculatorButton />
                <Button
                  size="small"
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={handleRun}
                  loading={spikeRunning}
                >
                  {spikeRunning ? '筛选中...' : '开始筛选'}
                </Button>
                {spikeRunning && (
                  <Button
                    size="small"
                    onClick={() => {
                      abortRef.current = true;
                      setSpikeRunning(false);
                    }}
                  >
                    停止
                  </Button>
                )}
              </div>
            )}
          </div>
    
          {market === MARKET_US ? (
            <UsStockPanel mode={mode} />
          ) : (
            <>
              <div className={s.stickyBar}>
                <div className={s.marketBar}>
                  {loadingMarket ? (
                    <span className={s.muted} style={{ fontSize: 11 }}>
                      加载市场数据...
                    </span>
                  ) : (
                    <>
                      {renderMarketStats('BTC', marketData.BTC)}
                      {renderMarketStats('ETH', marketData.ETH)}
                    </>
                  )}
                </div>
              </div>
    
              <div className={s.metaRow}>
                <span className={s.ruleText}>
                  {mode === MODE_SPIKE
                    ? `过去 ${SPIKE_CONFIG.windowDays} 天内单日涨幅 ≥${SPIKE_CONFIG.riseRatio * 100}% 或过去 ${SPIKE_CONFIG.windowDays} 天的最高价高于最远一天开盘价的 ${SPIKE_CONFIG.peakRatio * 100}%`
                    : `${HOLD_CONFIG.klineLimit} 天内最近一次暴涨 ≥${HOLD_CONFIG.riseRatio * 100}% 或存在连续 4 天，4 天内最高价高于第一天开盘价的 ${HOLD_CONFIG.fourDayRunRatio * 100}%，且当前价 ≥ 基准价 × ${HOLD_CONFIG.priceRatio * 100}%`}
                </span>
                {visibleRows.length > 0 && (
                  <span className={s.countBadge}>共 {visibleRows.length} 条</span>
                )}
              </div>
    
              {mode === MODE_HOLD && rows.length > 0 && (
                <div className={s.filterRow}>
                  {TRIGGER_FILTERS.map(f => (
                    <span
                      key={f}
                      onClick={() => setTriggerFilter(f)}
                      className={cx(s.filterChip, triggerFilter === f && s.filterChipActive)}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
    
              {spikeProgress.total > 0 && (
                <div className={s.progressRow}>
                  <div className={s.progressTrack}>
                    <div
                      className={s.progressBar}
                      style={{ width: `${(spikeProgress.checked / spikeProgress.total) * 100}%` }}
                    />
                  </div>
                  <span className={s.progressText}>
                    {spikeProgress.checked} / {spikeProgress.total}
                  </span>
                </div>
              )}
    
              <DataList
                key={mode}
                columns={mode === MODE_SPIKE ? spikeColumns : holdColumns}
                rows={visibleRows}
                empty={spikeRunning ? '筛选中...' : '点击「开始筛选」获取数据'}
                defaultSort={mode === MODE_HOLD ? { key: 'ratio', dir: 'desc' } : null}
              />
            </>
          )}
        </div>
      );
    };
    
    export default PairSelector;
    