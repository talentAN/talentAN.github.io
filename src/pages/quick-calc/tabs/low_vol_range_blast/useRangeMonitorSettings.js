/**
 * 横盘监控：高低比 / 近带% 设置。
 */
import { useRef, useState } from 'react';
import { normalizeNearBandPct } from './_rangeScan';
import {
  loadMaxMult,
  saveMaxMult,
  loadNearBandPct,
  saveNearBandPct,
} from './_rangeMonitorShared';

export const useRangeMonitorSettings = () => {
  const [maxMult, setMaxMult] = useState(() => loadMaxMult());
  const [maxMultInput, setMaxMultInput] = useState(() => String(loadMaxMult()));
  const [nearBandPct, setNearBandPct] = useState(() => loadNearBandPct());
  const [nearBandInput, setNearBandInput] = useState(() => String(loadNearBandPct()));

  const maxMultRef = useRef(maxMult);
  const nearBandPctRef = useRef(nearBandPct);
  maxMultRef.current = maxMult;
  nearBandPctRef.current = nearBandPct;

  const applyMaxMult = raw => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 1) {
      setMaxMultInput(String(maxMult));
      return false;
    }
    const next = Math.round(n * 100) / 100;
    setMaxMult(next);
    setMaxMultInput(String(next));
    maxMultRef.current = next;
    saveMaxMult(next);
    return true;
  };

  const applyNearBandPct = raw => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) {
      setNearBandInput(String(nearBandPct));
      return false;
    }
    const next = normalizeNearBandPct(n);
    setNearBandPct(next);
    setNearBandInput(String(next));
    nearBandPctRef.current = next;
    saveNearBandPct(next);
    return true;
  };

  return {
    maxMult,
    maxMultInput,
    setMaxMultInput,
    applyMaxMult,
    maxMultRef,
    nearBandPct,
    nearBandInput,
    setNearBandInput,
    applyNearBandPct,
    nearBandPctRef,
  };
};
