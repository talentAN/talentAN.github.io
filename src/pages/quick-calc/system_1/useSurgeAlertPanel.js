/**
 * 暴涨100：面板展开 / 浮动位置 / 拖拽；顺带申请通知权限与解锁音频。
 */
import { useEffect, useRef, useState } from 'react';
import { POS_KEY, clampPos, loadPos } from './_surgeAlertShared';

export const useSurgeAlertPanel = ({ docked = false } = {}) => {
  /** 面板是否展开 */
  const [expanded, setExpanded] = useState(false);
  /** 浮动面板坐标（docked 时 UI 不用） */
  const [pos, setPos] = useState({ x: 16, y: 120 });
  /** 拖拽起点与原始坐标；null=未在拖 */
  const dragRef = useRef(null);
  /** 本次按下后是否移动超过阈值（点开 vs 拖动） */
  const movedRef = useRef(false);
  /** 进入页时的 document.title，卸载时还原 */
  const originalTitleRef = useRef(
    typeof document !== 'undefined' ? document.title : ''
  );

  useEffect(() => {
    setPos(loadPos());
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPos(p => {
        const next = clampPos(p.x, p.y);
        localStorage.setItem(POS_KEY, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 通知权限 + 首次手势解锁 AudioContext（只挂一次）
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const unlockAudio = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        ctx.resume().then(() => ctx.close()).catch(() => {});
      } catch (_) {
        /* ignore */
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      document.title = originalTitleRef.current;
    };
  }, []);

  /** pointerdown 开始拖面板；点在 input/button 上或 docked 时不拖 */
  const startDrag = e => {
    if (docked) return;
    if (e.target.closest('input,button,a')) return;
    e.preventDefault();
    movedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    const onMove = ev => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
      const next = clampPos(dragRef.current.origX + dx, dragRef.current.origY + dy);
      setPos(next);
    };

    const onUp = () => {
      if (dragRef.current && movedRef.current) {
        setPos(p => {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
          return p;
        });
      }
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return {
    expanded,
    setExpanded,
    pos,
    startDrag,
    movedRef,
  };
};
