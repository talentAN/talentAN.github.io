/**
 * 横盘监控：展开态 + 列表分区折叠。
 */
import { useState } from 'react';

export const useRangeMonitorPanel = () => {
  const [expanded, setExpanded] = useState(false);
  /** 列表区块：默认全部折叠 */
  const [sectionOpen, setSectionOpen] = useState({
    cancelled: false,
    exits: false,
    placed: false,
    tips: false,
  });

  return {
    expanded,
    setExpanded,
    sectionOpen,
    setSectionOpen,
  };
};
