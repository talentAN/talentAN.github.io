/** 酝酿池「命名」↔ 回测主 tab（与 Backtest.jsx PATHS/TABS 对齐） */
export const BREWING_PATTERN_ENUM = [
  {
    key: 'rise100',
    label: '涨幅100%回测',
    path: '/quick-calc/backtest/rise-100',
  },
  {
    key: 'ladder',
    label: '阶梯开仓回测',
    path: '/quick-calc/backtest/ladder',
  },
  {
    key: 'dayHighGain',
    label: 'data-单日最高涨幅',
    path: '/quick-calc/backtest/day-high-gain',
  },
  {
    key: 'after100Gain',
    label: 'data-涨幅100后',
    path: '/quick-calc/backtest/after-100-gain',
  },
  {
    key: 'gentleRise',
    label: '缓坡上行',
    path: '/quick-calc/backtest/gentle-rise',
  },
  {
    key: 'lowVolRangeBlast',
    label: '低波动横盘暴涨',
    path: '/quick-calc/backtest/low-vol-range-blast',
  },
];

export const BREWING_PATTERN_MAP = Object.fromEntries(
  BREWING_PATTERN_ENUM.map(item => [item.key, item])
);

/** 旧备注前缀 → 命名枚举（兼容尚未写 name 字段的历史数据） */
export const inferBrewingPatternKey = (row = {}) => {
  if (row.name && BREWING_PATTERN_MAP[row.name]) return row.name;
  const note = String(row.note || '');
  if (/下沿\/上沿\/最高|低波动横盘|低波动\s*\+\s*暴涨/.test(note)) return 'lowVolRangeBlast';
  if (/缓坡/.test(note)) return 'gentleRise';
  if (/涨幅\s*100|100%/.test(note)) return 'rise100';
  if (/阶梯/.test(note)) return 'ladder';
  if (/单日最高|最高涨幅/.test(note)) return 'dayHighGain';
  if (/涨幅100后|100后/.test(note)) return 'after100Gain';
  return 'gentleRise';
};

export const getBrewingPattern = keyOrRow => {
  const key = typeof keyOrRow === 'string' ? keyOrRow : inferBrewingPatternKey(keyOrRow);
  return BREWING_PATTERN_MAP[key] || BREWING_PATTERN_MAP.gentleRise;
}; 