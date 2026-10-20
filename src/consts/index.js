export const PATTERN = {
  LONG_STABLE: 'LONG_STABLE',
  high_volume_breakout_shrink_stall: 'high_volume_breakout_shrink_stall',
  low_rise_ready_to_break: 'low_rise_ready_to_break',
  surge_100_pullback: 'surge_100_pullback',
  trial_water: 'trial_water',
  /** 横盘监控：近带挂多 → 突破上沿成交 */
  range_breakout_upper: 'range_breakout_upper',
};

export const PATTERN_Array = [
  {
    key: PATTERN.high_volume_breakout_shrink_stall,
    label: '放量冲关缩量滞涨',
  },
  {
    key: PATTERN.surge_100_pullback,
    label: '爆100回调',
  },
  {
    key: PATTERN.range_breakout_upper,
    label: '横盘突破上沿',
  },
  {
    key: PATTERN.low_rise_ready_to_break,
    label: '低量高低点抬升',
  },
  {
    key: PATTERN.trial_water,
    label: '试水',
  },
];
