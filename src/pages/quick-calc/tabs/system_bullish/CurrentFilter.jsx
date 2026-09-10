import React, { useMemo, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { navigate } from 'gatsby';
import DataList from '../system_1/_DataList';
import * as s from '../system_1/pairSelector.module.less';
import { getTradingPairs, getFutureKlineData } from '@root/src/container/market';
import {
  SOIL_V01,
  SOIL_SCAN_V01,
  UNIVERSE_V01,
  findRecentSoilHits,
  normalizeBars,
} from './_patternV01';

const ALL = 'ALL';
const cx = (...names) => names.filter(Boolean).join(' ');
const fmtPct = value =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(0)}%`;

const TYPE_BADGE = {
  DROP_QUIET_BOX: 'badgeBlue',
  DROP_RECOVERING: 'badgeGreen',
  ALREADY_EXTENDED: 'badgeOrange',
};

const Badge = ({ tone, children }) => (
  <span className={cx(s.badge, s[tone])}>{children}</span>
);

const listingDaysOk = bars => {
  if (!bars.length) return false;
  const minDays = UNIVERSE_V01.minListingDays || 30;
  const ms = bars[bars.length - 1].openTime - bars[0].openTime;
  return ms >= (minDays - 1) * 24 * 60 * 60 * 1000;
};

/**
 * 当前筛选 = 土壤观察池：近 15 个已收盘日至少一天命中主土壤三型。
 */
const CurrentFilter = () => {
  const [rows, setRows] = useState([]);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);

  const visibleRows = useMemo(() => {
    if (typeFilter === ALL) return rows;
    return rows.filter(row => row.soilType === typeFilter || (row.typesInWindow || []).includes(typeFilter));
  }, [rows, typeFilter]);

  const scan = async () => {
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
      for (let i = 0; i < symbols.length; i += 1) {
        if (abortRef.current) break;
        const symbol = symbols[i];
        try {
          const result = await getFutureKlineData(
            { symbol, granularity: '1D', limit: SOIL_SCAN_V01.fetchLimit },
            'binance',
          );
          const rawBars = normalizeBars(Array.isArray(result?.data) ? result.data : []);
          const todayUtc = new Date().toISOString().slice(0, 10);
          const bars = rawBars.filter(bar => bar.date < todayUtc);
          if (bars.length < SOIL_SCAN_V01.minPrefixBars || !listingDaysOk(bars)) {
            setProgress({ current: i + 1, total: symbols.length });
            continue;
          }

          const hits = findRecentSoilHits(bars, SOIL_SCAN_V01.recentDays);
          if (hits.length) {
            const latest = hits[hits.length - 1];
            const typeSet = [...new Set(hits.map(h => h.soilType))];
            matched.push({
              key: symbol,
              symbol,
              soilDate: latest.date,
              soilType: latest.soilType,
              soilLabel: latest.soilLabel,
              hitCount: hits.length,
              typesInWindow: typeSet,
              close: latest.close,
              drawdown: latest.drawdown,
              recovery: latest.recovery,
            });
            setRows([...matched]);
          }
        } catch (_) {
          // 单币失败不中断
        }
        setProgress({ current: i + 1, total: symbols.length });
      }

      matched.sort((a, b) => (a.soilDate < b.soilDate ? 1 : a.soilDate > b.soilDate ? -1 : a.symbol.localeCompare(b.symbol)));
      setRows(matched);
      message.success(
        abortRef.current
          ? `已停止：当前命中 ${matched.length} 个`
          : `扫描完成：近 ${SOIL_SCAN_V01.recentDays} 日土壤命中 ${matched.length} 个`,
      );
    } catch (error) {
      message.error(`扫描失败：${error.message}`);
    } finally {
      setRunning(false);
    }
  };

  const columns = [
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
      key: 'soilDate',
      title: '最近土壤日',
      width: 110,
      sortBy: row => row.soilDate,
      render: row => <span className={s.muted}>{row.soilDate}</span>,
    },
    {
      key: 'soilType',
      title: '土壤类型',
      width: 130,
      render: row => (
        <Badge tone={TYPE_BADGE[row.soilType] || 'badgeBlue'}>
          {row.soilLabel || row.soilType}
        </Badge>
      ),
    },
    {
      key: 'hitCount',
      title: '近15日命中',
      width: 90,
      align: 'right',
      sortBy: row => row.hitCount,
      render: row => row.hitCount,
    },
    {
      key: 'typesInWindow',
      title: '窗内类型',
      width: 200,
      wrap: true,
      render: row => (
        <span>
          {(row.typesInWindow || []).map(key => (
            <span key={key} style={{ marginRight: 4 }}>
              <Badge tone={TYPE_BADGE[key] || 'badgeBlue'}>
                {SOIL_V01.types.find(t => t.key === key)?.label || key}
              </Badge>
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'drawdown',
      title: '回撤',
      width: 70,
      align: 'right',
      sortBy: row => row.drawdown,
      render: row => fmtPct(row.drawdown),
    },
    {
      key: 'recovery',
      title: '修复',
      width: 70,
      align: 'right',
      sortBy: row => row.recovery,
      render: row => fmtPct(row.recovery),
    },
    {
      key: 'close',
      title: '标记收盘',
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
          href={`/quick-calc/system_bullish/explanation/?symbol=${encodeURIComponent(row.symbol)}&date=${row.soilDate}`}
          onClick={event => {
            event.preventDefault();
            navigate(
              `/quick-calc/system_bullish/explanation/?symbol=${encodeURIComponent(row.symbol)}&date=${row.soilDate}`,
            );
          }}
        >
          解释
        </a>
      ),
    },
  ];

  return (
    <div className={s.panel}>
      <div className={s.metaRow} style={{ marginBottom: 8 }}>
        <span className={s.ruleText}>
          只观察不开仓 · {SOIL_V01.version} · 近 {SOIL_SCAN_V01.recentDays} 日至少一天命中主土壤三型
        </span>
        {rows.length > 0 && <span className={s.countBadge}>共 {visibleRows.length} 条</span>}
      </div>
      <div className={s.toolbar}>
        <div className={s.actions}>
          <Button type="primary" size="small" onClick={scan} loading={running}>开始筛选</Button>
          {running && (
            <Button size="small" onClick={() => { abortRef.current = true; }}>停止</Button>
          )}
          <span className={s.ruleText}>
            {SOIL_V01.types.map(t => t.label).join(' / ')}
          </span>
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
      {rows.length > 0 && (
        <div className={s.filterRow} style={{ marginBottom: 8 }}>
          <span
            className={cx(s.filterChip, typeFilter === ALL && s.filterChipActive)}
            onClick={() => setTypeFilter(ALL)}
          >
            全部
          </span>
          {SOIL_V01.types.map(t => (
            <span
              key={t.key}
              className={cx(s.filterChip, typeFilter === t.key && s.filterChipActive)}
              onClick={() => setTypeFilter(t.key)}
            >
              {t.label}
            </span>
          ))}
        </div>
      )}
      <DataList
        columns={columns}
        rows={visibleRows}
        empty={running ? '筛选中…' : '点击「开始筛选」扫描当前土壤观察池'}
        defaultSort={{ key: 'soilDate', dir: 'desc' }}
      />
    </div>
  );
};

export default CurrentFilter;
