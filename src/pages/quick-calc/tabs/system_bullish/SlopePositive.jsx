import React, { useMemo, useRef, useState } from 'react';
import { Button, Input, message } from 'antd';
import { navigate } from 'gatsby';
import DataList from '../system_1/_DataList';
import * as s from '../system_1/pairSelector.module.less';
import { getTradingPairs, getFutureKlineData } from '@root/src/container/market';
import {
  UNIVERSE_V01,
  SLOPE_SCAN_V01,
  evaluatePositiveSlope,
  normalizeBars,
} from './_patternV01';

const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;

const fmtNum = (value, digits = 4) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);

const listingDaysOk = bars => {
  if (!bars.length) return false;
  const minDays = UNIVERSE_V01.minListingDays || 30;
  const ms = bars[bars.length - 1].openTime - bars[0].openTime;
  return ms >= (minDays - 1) * 24 * 60 * 60 * 1000;
};

const clampWindowDays = raw => {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return SLOPE_SCAN_V01.windowDays;
  return Math.min(
    SLOPE_SCAN_V01.windowDaysMax,
    Math.max(SLOPE_SCAN_V01.windowDaysMin, n),
  );
};

/**
 * 斜率正观察池：近 N 日温和上行（斜率+R²+振幅+禁近端暴拉）。
 */
const SlopePositive = () => {
  const [windowInput, setWindowInput] = useState(String(SLOPE_SCAN_V01.windowDays));
  const [windowDays, setWindowDays] = useState(SLOPE_SCAN_V01.windowDays);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);

  const applyWindowDays = () => {
    const next = clampWindowDays(windowInput);
    setWindowDays(next);
    setWindowInput(String(next));
    return next;
  };

  const scan = async () => {
    const days = applyWindowDays();
    abortRef.current = false;
    setRunning(true);
    setRows([]);
    try {
      const pairs = await getTradingPairs({}, 'binance');
      const symbols = (pairs || [])
        .map(item => item.symbol || item)
        .filter(symbol => String(symbol).endsWith('USDT'));
      setProgress({ current: 0, total: symbols.length });

      const matched = [];
      const P = SLOPE_SCAN_V01;
      const fetchLimit = Math.min(500, days + 15);
      for (let i = 0; i < symbols.length; i += 1) {
        if (abortRef.current) break;
        const symbol = symbols[i];
        try {
          const result = await getFutureKlineData(
            { symbol, granularity: '1D', limit: fetchLimit },
            'binance',
          );
          const rawBars = normalizeBars(Array.isArray(result?.data) ? result.data : []);
          const todayUtc = new Date().toISOString().slice(0, 10);
          const bars = rawBars.filter(bar => bar.date < todayUtc);
          if (bars.length < days || !listingDaysOk(bars)) {
            setProgress({ current: i + 1, total: symbols.length });
            continue;
          }

          const evaled = evaluatePositiveSlope(bars, { windowDays: days });
          if (evaled.ok && evaled.pass) {
            matched.push({
              key: symbol,
              symbol,
              windowDays: days,
              date: evaled.date,
              close: evaled.close,
              slope: evaled.slope,
              slopeRetWindow: evaled.slopeRetWindow,
              r2: evaled.r2,
              rangePct: evaled.rangePct,
              retWindow: evaled.retWindow,
              maxDayRet5: evaled.maxDayRet5,
            });
            setRows([...matched]);
          }
        } catch (_) {
          // 单币失败不中断
        }
        setProgress({ current: i + 1, total: symbols.length });
      }

      matched.sort((a, b) => (b.r2 ?? 0) - (a.r2 ?? 0));
      setRows(matched);
      message.success(
        abortRef.current
          ? `已停止：当前命中 ${matched.length} 个`
          : `扫描完成：近 ${days} 日斜率正命中 ${matched.length} 个`,
      );
    } catch (error) {
      message.error(`扫描失败：${error.message}`);
    } finally {
      setRunning(false);
    }
  };

  const columns = useMemo(() => [
    {
      key: 'symbol',
      title: '币对',
      width: 130,
      render: row => (
        <a
          className={s.symbolLink}
          href={`https://www.binance.com/zh-CN/futures/${row.symbol}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.symbol}
        </a>
      ),
    },
    {
      key: 'date',
      title: '判定日',
      width: 110,
      sortBy: row => row.date,
      render: row => <span className={s.muted}>{row.date}</span>,
    },
    {
      key: 'r2',
      title: 'R²',
      width: 70,
      align: 'right',
      sortBy: row => row.r2,
      render: row => fmtNum(row.r2, 2),
    },
    {
      key: 'retWindow',
      title: `${windowDays}日涨幅`,
      width: 90,
      align: 'right',
      sortBy: row => row.retWindow,
      render: row => fmtPct(row.retWindow),
    },
    {
      key: 'slopeRetWindow',
      title: '斜率≈收益',
      width: 90,
      align: 'right',
      sortBy: row => row.slopeRetWindow,
      render: row => fmtPct(row.slopeRetWindow),
    },
    {
      key: 'rangePct',
      title: '窗内振幅',
      width: 90,
      align: 'right',
      sortBy: row => row.rangePct,
      render: row => fmtPct(row.rangePct),
    },
    {
      key: 'maxDayRet5',
      title: '近5日最大单日',
      width: 110,
      align: 'right',
      sortBy: row => row.maxDayRet5,
      render: row => fmtPct(row.maxDayRet5),
    },
    {
      key: 'close',
      title: '收盘',
      width: 100,
      align: 'right',
      sortBy: row => row.close,
      render: row => (Number.isFinite(row.close) ? Number(row.close).toPrecision(5) : '—'),
    },
    {
      key: 'explanation',
      title: '走势',
      width: 56,
      render: row => (
        <a
          className={s.symbolLink}
          href={`/quick-calc/system_bullish/explanation/?symbol=${encodeURIComponent(row.symbol)}&date=${row.date}`}
          onClick={event => {
            event.preventDefault();
            navigate(
              `/quick-calc/system_bullish/explanation/?symbol=${encodeURIComponent(row.symbol)}&date=${row.date}`,
            );
          }}
        >
          解释
        </a>
      ),
    },
  ], [windowDays]);

  const P = SLOPE_SCAN_V01;

  return (
    <div className={s.panel}>
      <div className={s.metaRow} style={{ marginBottom: 8 }}>
        <span className={s.ruleText}>
          只观察 · {P.version} · 近 N 日 log收盘斜率&gt;0 · R²≥{P.r2Min}
          · 振幅≤{(P.rangeMax * 100).toFixed(0)}% · 涨幅≥{(P.retWindowMin * 100).toFixed(0)}%
          · 近{P.spikeLookback}日单日&lt;{(P.spikeDayRetMax * 100).toFixed(0)}%
          · N∈[{P.windowDaysMin},{P.windowDaysMax}]
        </span>
        {rows.length > 0 && <span className={s.countBadge}>共 {rows.length} 条</span>}
      </div>
      <div className={s.toolbar}>
        <div className={s.actions}>
          <span className={s.ruleText}>回看天数</span>
          <Input
            size="small"
            style={{ width: 72 }}
            value={windowInput}
            disabled={running}
            onChange={event => setWindowInput(event.target.value)}
            onBlur={applyWindowDays}
            onPressEnter={applyWindowDays}
          />
          <Button type="primary" size="small" onClick={scan} loading={running}>开始筛选</Button>
          {running && (
            <Button size="small" onClick={() => { abortRef.current = true; }}>停止</Button>
          )}
          <span className={s.ruleText}>当前 N={windowDays}</span>
        </div>
        {progress.total > 0 && (
          <span className={s.countBadge}>{progress.current}/{progress.total}</span>
        )}
      </div>
      {progress.total > 0 && (
        <div className={s.progressRow}>
          <div className={s.progressTrack}>
            <div
              className={s.progressBar}
              style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
            />
          </div>
          <span className={s.progressText}>
            {progress.current} / {progress.total}
          </span>
        </div>
      )}
      <DataList
        columns={columns}
        rows={rows}
        empty={running ? '筛选中…' : '点击「开始筛选」扫描斜率正观察池'}
        defaultSort={{ key: 'r2', dir: 'desc' }}
      />
    </div>
  );
};

export default SlopePositive;
