import { useState, useEffect, useRef } from 'react';
import { getBatches } from '../utils';
import moment from 'moment';
import { getFutureKlineData } from '../api';
import { shouldEntry } from '@trade/utils/should-entry';

export const useRiseToFallLine = ({ futureSymbols }) => {
  const [symbols, setSymbols] = useState([]);
  const [checkedSymbolCount, setCheckedSymbolCount] = useState(0);
  const orderRef = useRef(0);
  const checkedSymbolCountRef = useRef(0);
  const symbolsRef = useRef([]);
  const timeoutRef = useRef(null);

  const checkPair = async symbol => {
    const ret = await getFutureKlineData({
      symbol,
      granularity: '1Dutc',
      limit: 90,
      startTime: moment.utc().subtract(90, 'days').valueOf(),
      endTime: moment.utc().valueOf(),
    });
    const data = ret.data || [];

    if (!data || data.length < 90) {
      return {
        symbol,
        isTarget: false,
      };
    }

    // 使用 shouldEntry 检查是否满足入场条件
    const entryResult = await shouldEntry(symbol, data);
    const currentPrice = parseFloat(data[data.length - 1][4]);
    const resistancePrice = Math.max(...data.slice(0, 80).map(k => parseFloat(k[2])));

    return {
      symbol,
      isTarget: entryResult.shouldEntry,
      currentPrice: currentPrice.toFixed(4),
      resistancePrice: resistancePrice.toFixed(4),
      entrySignal: entryResult.shouldEntry ? entryResult : null,
    };
  };

  const getTargetPairs = () => {
    const order = orderRef.current;
    const batches = getBatches(futureSymbols);

    for (let i = 0; i < batches.length; i++) {
      setTimeout(async () => {
        if (order < timeoutRef.current) return;
        const batch = batches[i];
        const batchPromises = batch.map(async symbol => {
          const checkResult = await checkPair(symbol);
          return checkResult;
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(checkResult => {
          if (checkResult.isTarget) {
            symbolsRef.current.push(checkResult);
          }
        });
        checkedSymbolCountRef.current = checkedSymbolCountRef.current + batchResults.length;
        setCheckedSymbolCount(checkedSymbolCountRef.current);
        setSymbols([...symbolsRef.current]);
      }, i * 1000);
    }
  };

  useEffect(() => {
    orderRef.current = orderRef.current + 1;
    symbolsRef.current = [];
    checkedSymbolCountRef.current = 0;
    setCheckedSymbolCount(0);
    setSymbols([]);
    getTargetPairs();
  }, [futureSymbols]);

  return {
    symbols,
    checkedSymbolCount,
  };
};
