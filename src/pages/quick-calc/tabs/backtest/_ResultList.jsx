import React, { useMemo, useState } from 'react';
import * as s from './backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const PAGE_SIZE = 100;

/**
 * 极简 div 列表（替代 antd Table）
 * columns: { key, title, width?, align?, render(row), sortBy?(row) }
 * 回测结果可能上千行，按 100 行分段渲染，避免一次性铺满。
 */
const ResultList = ({ columns, rows, empty, defaultSort, highlightKey }) => {
  const [sort, setSort] = useState(defaultSort || null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const gridTemplate = columns.map(c => (c.width ? `${c.width}px` : 'minmax(0, 1fr)')).join(' ');
  // 列数多时（如失败视图追加 30/60/90 天）总宽会超过容器，靠内层最小宽度触发横向滚动。
  const minWidth = columns.every(c => c.width)
    ? columns.reduce((sum, c) => sum + c.width, 0)
    : undefined;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col || !col.sortBy) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortBy(a);
      const bv = col.sortBy(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = col => {
    if (!col.sortBy) return;
    setVisible(PAGE_SIZE);
    setSort(prev => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'desc' };
      return prev.dir === 'desc' ? { key: col.key, dir: 'asc' } : null;
    });
  };

  const highlighted = highlightKey ? sorted.find(row => row.key === highlightKey) : null;
  const rest = highlighted ? sorted.filter(row => row.key !== highlightKey) : sorted;
  const shown = highlighted ? [highlighted, ...rest.slice(0, visible)] : rest.slice(0, visible);

  return (
    <div className={s.list}>
      <div className={s.listInner} style={{ minWidth }}>
        <div className={s.listHead} style={{ gridTemplateColumns: gridTemplate }}>
          {columns.map(col => {
            const active = sort && sort.key === col.key;
            return (
              <div
                key={col.key}
                onClick={() => toggleSort(col)}
                className={cx(s.headCell, col.sortBy && s.sortable, active && s.sortActive)}
                style={{ textAlign: col.align || 'left' }}
              >
                {col.title}
                {active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
              </div>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <div className={s.empty}>{empty}</div>
        ) : (
          shown.map((row, index) => (
            <div
              key={row.key}
              className={cx(
                s.row,
                highlightKey && row.key === highlightKey && s.rowHighlight,
                !(highlightKey && row.key === highlightKey) && (index + 1) % 5 === 0 && s.rowAlt
              )}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {columns.map(col => (
                <div key={col.key} className={s.cell} style={{ textAlign: col.align || 'left' }}>
                  {col.render(row)}
                </div>
              ))}
            </div>
          ))
        )}

        {rest.length > visible && (
          <div className={s.moreRow} onClick={() => setVisible(v => v + PAGE_SIZE)}>
            加载更多（已显示 {shown.length} / {sorted.length}）
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultList;
