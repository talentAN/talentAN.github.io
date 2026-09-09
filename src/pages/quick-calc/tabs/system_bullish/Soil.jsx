import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, message } from 'antd';
// import reviewPack from '@root/src/data/market/binance/bullish-base-rate/soil-entry-review-v0.1.json';
import DataList from '../system_1/_DataList';
import * as s from '../system_1/pairSelector.module.less';
import { SOIL_V01 } from './patternV01';

const reviewPack = {}
const STORAGE_KEY = 'bullish-soil-entry-timing-v0.1';
const futuresUrl = symbol => `https://www.binance.com/zh-CN/futures/${symbol}`;
const cx = (...names) => names.filter(Boolean).join(' ');

const TYPE_BADGE = {
  DROP_QUIET_BOX: 'badgeBlue',
  DROP_RECOVERING: 'badgeGreen',
  ALREADY_EXTENDED: 'badgeOrange',
};

const rowId = row => `${row.symbol}|${row.judgeDate}|${row.soilType}`;

const loadNotes = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const Badge = ({ tone, children }) => (
  <span className={cx(s.badge, s[tone])}>{children}</span>
);

const EntryTimingCell = ({ id, value, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          display: 'block',
          width: '100%',
          minHeight: 24,
          margin: 0,
          padding: '2px 6px',
          textAlign: 'left',
          border: '1px dashed #e5e6eb',
          borderRadius: 4,
          background: value ? '#fff' : '#fafbfc',
          cursor: 'pointer',
          color: value ? '#1f2329' : '#bfbfbf',
          fontSize: 12,
          lineHeight: '18px',
        }}
      >
        {value || '点击填写（日期 / 不开 / 太晚）'}
      </button>
    );
  }

  return (
    <Input
      size="small"
      autoFocus
      value={draft}
      placeholder="例：2024-03-12 破箱收盘 / 不开 / 太晚"
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        onSave(id, draft.trim());
        setEditing(false);
      }}
      onPressEnter={event => event.currentTarget.blur()}
    />
  );
};

/**
 * 土壤观察 · 开仓时机人审
 */
const Soil = () => {
  const pages = reviewPack.pages || [];
  const meta = reviewPack.metadata || {};
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState({});

  useEffect(() => {
    setNotes(loadNotes());
  }, []);

  const current = pages[page - 1];
  const rows = useMemo(() => current?.rows || [], [current]);

  const saveNote = useCallback((id, text) => {
    setNotes(prev => {
      const next = { ...prev };
      if (text) next[id] = text;
      else delete next[id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        message.error('本地保存失败');
      }
      return next;
    });
  }, []);

  const filledOnPage = useMemo(
    () => rows.filter(row => notes[rowId(row)]).length,
    [rows, notes],
  );

  const copyPage = async () => {
    const header = ['币对', '土壤标记日', '土壤类型', '土壤类型代码', '开仓时机'].join('\t');
    const lines = rows.map(row => {
      const id = rowId(row);
      return [row.symbol, row.judgeDate, row.soilLabel, row.soilType, notes[id] || ''].join('\t');
    });
    const text = [`# page ${page}/${pages.length}`, header, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制第 ${page} 页（${rows.length} 行）`);
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  };

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 130,
      render: row => (
        <a className={s.symbolLink} href={futuresUrl(row.symbol)} target="_blank" rel="noreferrer">
          {row.symbol}
        </a>
      ),
    },
    {
      key: 'judgeDate',
      title: '土壤标记日',
      width: 110,
      sortBy: row => row.judgeDate,
      render: row => <span className={s.muted}>{row.judgeDate}</span>,
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
      key: 'entryTiming',
      title: '开仓时机',
      wrap: true,
      render: row => (
        <EntryTimingCell id={rowId(row)} value={notes[rowId(row)] || ''} onSave={saveNote} />
      ),
    },
  ];

  const composition = current?.composition || {};
  const filledFrom = current?.filledFrom || [];

  return (
    <div className={s.panel}>
      <div className={s.metaRow} style={{ marginBottom: 8 }}>
        <span className={s.ruleText}>
          土壤观察 · 开仓时机人审 · {SOIL_V01.workflow} · 近端倒序 · 本页已填 {filledOnPage}/{rows.length}
        </span>
        <span className={s.countBadge}>
          {meta.totalRows || 0} 行 / {pages.length} 页
        </span>
      </div>
      <div className={s.toolbar}>
        <div className={s.actions}>
          <Button type="primary" size="small" onClick={copyPage}>复制本页</Button>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <Button size="small" disabled={page >= pages.length} onClick={() => setPage(p => p + 1)}>下一页</Button>
          <span className={s.ruleText}>
            第 {page}/{pages.length} 页
            {SOIL_V01.types.map(t => (
              <span key={t.key} style={{ marginLeft: 8 }}>
                {t.label} {composition[t.key] ?? 0}
              </span>
            ))}
            {filledFrom.length > 0 && (
              <span style={{ marginLeft: 8 }}>（补足自 {filledFrom.join(', ')}）</span>
            )}
          </span>
        </div>
      </div>
      <DataList
        columns={columns}
        rows={rows}
        empty="本页无数据"
      />
    </div>
  );
};

export default Soil;
