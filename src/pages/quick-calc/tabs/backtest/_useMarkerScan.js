import { useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { getAllFutureDailyKlines, getMergedTradingPairs } from '@root/src/container/market';
import { getBinanceBanRemaining } from '@root/src/container/binance/api';
import { findRise100Markers } from './_rise100Rules';

// 会话级缓存：两个 tab 共用同一次全量扫描结果，避免重复拉全市场历史
const cache = { markers: [], errors: [], scannedAt: null };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const EMPTY_PROGRESS = { done: 0, total: 0, symbol: '', exchange: '', page: 0, candles: 0 };

// 全市场标记日扫描：拉合约币对 → 逐个拉全量日 K → 提取标记日，结果写入会话缓存
export const useMarkerScan = () => {
  const [markers, setMarkers] = useState(cache.markers);
  const [errors, setErrors] = useState(cache.errors);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const abortRef = useRef(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setMarkers([]);
    setErrors([]);
    setProgress(EMPTY_PROGRESS);

    let pairs = [];
    try {
      pairs = await getMergedTradingPairs();
      if (!pairs.length) throw new Error('未获取到合约币对');
    } catch (error) {
      message.error(error?.message || '获取合约币对失败');
      setRunning(false);
      return;
    }

    setProgress(prev => ({ ...prev, total: pairs.length }));
    const found = [];
    const failed = [];

    for (let index = 0; index < pairs.length; index++) {
      if (controller.signal.aborted) break;
      const pair = pairs[index];
      setProgress({
        ...EMPTY_PROGRESS,
        done: index,
        total: pairs.length,
        symbol: pair.symbol,
        exchange: pair.exchange,
      });

      try {
        const candles = await getAllFutureDailyKlines(
          {
            symbol: pair.symbol,
            signal: controller.signal,
            onPage: ({ page, loaded }) => setProgress(prev => ({ ...prev, page, candles: loaded })),
          },
          pair.exchange
        );
        found.push(...findRise100Markers(candles, pair));
        // 每个币对完成后更新一次，避免每根 K 线触发渲染。
        setMarkers([...found]);
      } catch (error) {
        if (error?.name === 'AbortError') break;
        if (pair.exchange === 'binance' && error?.status && error.status !== 200) {
          message.error(`Binance 接口异常（${error.status}）：${pair.symbol}`, 5);
        }
        failed.push({
          symbol: pair.symbol,
          exchange: pair.exchange,
          message: error?.message || String(error),
        });
        setErrors([...failed]);
      }

      setProgress(prev => ({ ...prev, done: index + 1 }));
      // 被 Binance 418/429 限频时整体暂停，避免把剩余币对全部记成失败。
      const banRemaining = getBinanceBanRemaining();
      if (banRemaining > 0) {
        message.warning(`Binance 限频，暂停 ${Math.ceil(banRemaining / 1000)}s 后继续`, 3);
        await sleep(banRemaining + 1000);
      }
      // 币对间留一个小间隔，降低跨接口限频概率。
      await sleep(120);
    }

    cache.markers = [...found];
    cache.errors = [...failed];
    cache.scannedAt = Date.now();
    setMarkers(cache.markers);
    setRunning(false);
    abortRef.current = null;

    if (controller.signal.aborted) message.info('已停止，保留当前结果');
    else message.success(`扫描完成：成功 ${pairs.length - failed.length} 个，失败 ${failed.length} 个`);
  };

  const stop = () => abortRef.current?.abort();

  const percent = useMemo(
    () => (progress.total ? (progress.done / progress.total) * 100 : 0),
    [progress]
  );

  return { markers, errors, running, progress, percent, run, stop, scannedAt: cache.scannedAt };
};
