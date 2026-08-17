import React, { useMemo, useState } from 'react';
import * as s from './pairSelector.module.less';

/**
 * 极简 div 列表（替代 antd Table）
 * columns: { key, title, width?, align?, render(row), sortBy?(row) }
 */
const DataList = ({ columns, rows, empty, defaultSort }) => {
  const [sort, setSort] = useState(defaultSort || null);

  const gridTemplate = columns.map(c => (c.width ? `${c.width}px` : 'minmax(0, 1fr)')).join(' ');

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col || !col.sortBy) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortBy(a);
      const bv = col.sortBy(b);
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = col => {
    if (!col.sortBy) return;
    setSort(prev => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: 'desc' };
      return prev.dir === 'desc' ? { key: col.key, dir: 'asc' } : null;
    });
  };

  const cx = (...names) => names.filter(Boolean).join(' ');

  return (
    <div className={s.list}>
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

      {sorted.length === 0 ? (
        <div className={s.empty}>{empty}</div>
      ) : (
        sorted.map((row, index) => (
          <div
            key={row.key}
            className={cx(s.row, (index + 1) % 5 === 0 && s.rowAlt)}
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
    </div>
  );
};

export default DataList;