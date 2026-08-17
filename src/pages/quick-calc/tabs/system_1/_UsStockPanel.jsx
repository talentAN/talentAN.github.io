import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import moment from 'moment';
import { getContracts, getFutureKlineData, getTradeUrl } from '@root/src/container/market';
import {
  US_SPIKE_CONFIG,
  US_HOLD_CONFIG,
  US_CATEGORY_LABELS,
  US_DEFAULT_CATEGORIES,
  US_PENDING_ITEMS,
  classifyRwaSymbol,
  dropWeekendCandles,
  withWeekendBuffer,
  detectSectorResonance,
  US_VOLUME_CONFIG,
} from '@root/src/consts/usStockSelectorConfig';
import { RATIO_COLOR } from '@root/src/consts/pairSelectorConfig';
import { getSingleDaySpike, getWindowPeakSignal, getHoldReference } from './_pairSelectorRules';
import DataList from './_DataList';
import * as s from './pairSelector.module.less';

const MODE_SPIKE = 'spike';

const cx = (...names) => names.filter(Boolean).join(' ');

const pct = v => `${(v * 100).toFixed(0)}%`;

const fmtPrice = v => (v != null && Number.isFinite(v) ? v.toPrecision(5) : '—');

const Badge = ({ tone, children }) => <span className={cx(s.badge, s[tone])}>{children}</span>;

const classifyBinanceContract = contract => {
  if (contract.underlyingType === 'COMMODITY') return 'commodity';
  if (contract.underlyingType === 'PREMARKET') return 'preIpo';
  if (contract.underlyingType === 'HK_EQUITY' || contract.underlyingType === 'KR_EQUITY') {
    return 'nonUs';
  }
  return classifyRwaSymbol(contract.baseAsset);
};

const UsStockPanel = ({ mode }) => {
  const [universe, setUniverse] = useState([]);
  const [categories, setCategories] = useState(US_DEFAULT_CATEGORIES);
  const [spikeResults, setSpikeResults] = useState([]);
  const [holdResults, setHoldResults] = useState([]);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    Promise.all([getContracts({}, 'binance'), getContracts({}, 'bitget')]).then(
      ([binanceContracts, bitgetContracts]) => {
        const binance = (binanceContracts || [])
          .filter(
            c =>
              ['EQUITY', 'HK_EQUITY', 'KR_EQUITY', 'COMMODITY', 'PREMARKET'].includes(
                c.underlyingType
              ) &&
              c.status === 'TRADING' &&
              c.quoteAsset === 'USDT'
          )
          .map(c => ({
            symbol: c.symbol,
            baseCoin: c.baseAsset,
            category: classifyBinanceContract(c),
            exchange: 'binance',
          }));
        const binanceSymbols = new Set(binance.map(c => c.symbol));
        const bitgetOnly = (bitgetContracts || [])
          .filter(c => c.isRwa === 'YES' && c.symbolStatus === 'normal')
          .map(c => ({
            symbol: c.symbol,
            baseCoin: c.baseCoin,
            category: classifyRwaSymbol(c.baseCoin),
            exchange: 'bitget',
          }))
          .filter(c => !binanceSymbols.has(c.symbol));

        setUniverse([...binance, ...bitgetOnly]);
      }
    );
  }, []);

  const selected = universe.filter(u => categories.includes(u.category));

  const categoryCounts = universe.reduce((acc, u) => {
    acc[u.category] = (acc[u.category] || 0) + 1;
    return acc;
  }, {});

  const toggleCategory = key =>
    setCategories(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    );

  const runFilter = async () => {
    abortRef.current = false;
    setRunning(true);
    setSpikeResults([]);
    setHoldResults([]);

    const pairs = selected;
    setProgress({ checked: 0, total: pairs.length });

    const isSpike = mode === MODE_SPIKE;
    const endTime = moment.utc().valueOf();
    const matched = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol, exchange } = pairs[i];
      const tradingDays = isSpike ? US_SPIKE_CONFIG.windowDays : US_HOLD_CONFIG.klineLimit;
      const maDays = US_VOLUME_CONFIG.maDays;
      const needBars = tradingDays + maDays;
      try {
        const res = await getFutureKlineData(
          {
            symbol,
            granularity: '1Dutc',
            limit: withWeekendBuffer(needBars),
            endTime,
          },
          exchange
        );
        const raw = (Array.isArray(res?.data) ? res.data : []).sort(
          (a, b) => Number(a[0]) - Number(b[0])
        );
        // 保留 MA 历史 + 观察窗口；量比用前 maDays 根，规则只在窗口内搜
        const candles = dropWeekendCandles(raw).slice(-needBars);
        if (candles.length < maDays + 2) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        if (isSpike) {
          const spikeSignal = getSingleDaySpike(candles, US_SPIKE_CONFIG);
          const peakSignal = getWindowPeakSignal(candles, US_SPIKE_CONFIG);
          if (spikeSignal || peakSignal) {
            matched.push({
              key: symbol,
              symbol,
              exchange,
              date: spikeSignal?.date || peakSignal?.date,
              rise: spikeSignal?.rise,
              firstOpen: peakSignal?.firstOpen,
              maxHigh: peakSignal?.maxHigh,
              peakRatio: peakSignal?.ratio,
              volRatio: spikeSignal?.volRatio ?? peakSignal?.volRatio ?? null,
            });
            setSpikeResults([...matched]);
          }
        } else {
          const holdSignal = getHoldReference(candles, US_HOLD_CONFIG);
          if (holdSignal) {
            matched.push({
              key: symbol,
              symbol,
              exchange,
              spikeDate: holdSignal.referenceDate,
              spikeRise: holdSignal.referenceRise || '—',
              refPrice: holdSignal.baseline,
              currentPrice: holdSignal.currentPrice,
              ratio: ((holdSignal.currentPrice / holdSignal.baseline) * 100).toFixed(1),
              trigger: holdSignal.trigger,
              daysAgo: holdSignal.daysAgo,
              volRatio: holdSignal.volRatio ?? null,
            });
            setHoldResults([...matched]);
          }
        }
      } catch (_) {}
      setProgress({ checked: i + 1, total: pairs.length });
    }
    setRunning(false);
  };

  const symbolCell = row => (
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
  );

  const spikeColumns = [
    { key: 'symbol', title: '标的', width: 120, render: symbolCell },
    {
      key: 'date',
      title: '触发日期',
      width: 110,
      render: r => <span className={s.muted}>{r.date}</span>,
    },
    {
      key: 'rise',
      title: '当日涨幅',
      width: 100,
      sortBy: r => parseFloat(r.rise),
      render: r => (r.rise ? <Badge tone="badgeGreen">+{r.rise}%</Badge> : '—'),
    },
    {
      key: 'volRatio',
      title: '量比',
      width: 70,
      sortBy: r => r.volRatio ?? 0,
      render: r =>
        r.volRatio != null ? <Badge tone="badgeBlue">{r.volRatio}×</Badge> : '—',
    },
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
  ];

  const holdColumns = [
    { key: 'symbol', title: '标的', width: 110, render: symbolCell },
    {
      key: 'spikeDate',
      title: '基准日期',
      width: 100,
      render: r => <span className={s.muted}>{r.spikeDate}</span>,
    },
    {
      key: 'daysAgo',
      title: '距今交易日',
      width: 80,
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
    {
      key: 'volRatio',
      title: '量比',
      width: 70,
      sortBy: r => r.volRatio ?? 0,
      render: r =>
        r.volRatio != null ? <Badge tone="badgeBlue">{r.volRatio}×</Badge> : '—',
    },
    { key: 'refPrice', title: '基准价(a)', width: 100, render: r => fmtPrice(r.refPrice) },
    { key: 'currentPrice', title: '当前价', width: 100, render: r => fmtPrice(r.currentPrice) },
    {
      key: 'ratio',
      title: '当前/基准',
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

  const isSpike = mode === MODE_SPIKE;
  const rows = isSpike ? spikeResults : holdResults;
  const resonance = detectSectorResonance(rows, isSpike ? 'date' : 'spikeDate');
  const volTxt = `量比 ≥ ${US_VOLUME_CONFIG.inflowRatio}×`;

  const ruleText = isSpike
    ? `过去 ${US_SPIKE_CONFIG.windowDays} 个交易日内单日涨幅 ≥${pct(US_SPIKE_CONFIG.riseRatio)} 或最高价高于最远一天开盘价的 ${pct(US_SPIKE_CONFIG.peakRatio)}，且触发日 ${volTxt}（已剔除周末 / NYSE 休市日）`
    : `${US_HOLD_CONFIG.klineLimit} 个交易日内最近一次暴涨 ≥${pct(US_HOLD_CONFIG.riseRatio)} 或存在连续 4 个交易日涨幅 ≥${pct(US_HOLD_CONFIG.fourDayRunRatio)}，基准日 ${volTxt}，且当前价在基准价的 ${pct(US_HOLD_CONFIG.priceRatio)} ~ ${pct(US_HOLD_CONFIG.maxPriceRatio)} 之间（已剔除周末 / NYSE 休市日）`;

  return (
    <div>
      <div className={s.stickyBar}>
        <div className={s.marketBar}>
          <span className={s.marketSymbol}>标的池</span>
          {Object.keys(US_CATEGORY_LABELS).map(key => (
            <span
              key={key}
              onClick={() => toggleCategory(key)}
              className={cx(s.filterChip, categories.includes(key) && s.filterChipActive)}
            >
              {US_CATEGORY_LABELS[key]} {categoryCounts[key] || 0}
            </span>
          ))}
          <span className={s.muted} style={{ fontSize: 11 }}>
            已选 {selected.length} 个
          </span>
          {resonance.length > 0 && (
            <span className={s.resonanceHint} title="仅提醒，不参与过滤；请人工判断是否板块/大盘行情">
              ⚠ 疑似板块共振{' '}
              {resonance
                .slice(0, 2)
                .map(r => `${r.date}×${r.count}`)
                .join(' · ')}
              {resonance.length > 2 ? ` +${resonance.length - 2}` : ''}
              <span className={s.resonanceNote}>（人工核对）</span>
            </span>
          )}
        </div>
      </div>

      <div className={s.metaRow}>
        <span className={s.ruleText}>{ruleText}</span>
        <div className={s.actions}>
          {rows.length > 0 && <span className={s.countBadge}>共 {rows.length} 条</span>}
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={runFilter}
            loading={running}
            disabled={!selected.length}
          >
            {running ? '筛选中...' : '开始筛选'}
          </Button>
          {running && (
            <Button
              size="small"
              onClick={() => {
                abortRef.current = true;
                setRunning(false);
              }}
            >
              停止
            </Button>
          )}
        </div>
      </div>

      {progress.total > 0 && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div
              className={s.progressBar}
              style={{ width: `${(progress.checked / progress.total) * 100}%` }}
            />
          </div>
          <span className={s.progressText}>
            {progress.checked} / {progress.total}
          </span>
        </div>
      )}

      <DataList
        key={mode}
        columns={isSpike ? spikeColumns : holdColumns}
        rows={rows}
        empty={running ? '筛选中...' : '点击「开始筛选」获取数据'}
        defaultSort={isSpike ? null : { key: 'ratio', dir: 'desc' }}
      />

      {US_PENDING_ITEMS.length > 0 && (
        <div className={s.pendingBox}>
          <div className={s.pendingTitle}>待迭代</div>
          {US_PENDING_ITEMS.map(item => (
            <div key={item} className={s.pendingItem}>
              · {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UsStockPanel;
