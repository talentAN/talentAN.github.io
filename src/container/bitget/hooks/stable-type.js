import { useState, useEffect, useRef } from 'react';
import { getFutureKlineData } from '../api';
import moment from 'moment';
import { MAX_TRADING_DAYS, MIN_TRADING_DAYS } from '../constants/filter';
import { getBatches } from '../utils';
import { matchLongStable, parseKlineData } from '@trade/utils/symbol-match-pattern';

const checkPair = async symbol => {
  try {
    // 获取365天的K线数据来判断上架时间
    const oneYearData = await getFutureKlineData({
      symbol,
      granularity: '1D',
      limit: 365,
      startTime: moment.utc().subtract(365, 'days').valueOf(),
      endTime: moment.utc().subtract(300, 'days').valueOf(),
    });

    // 如果K线数据接近365天，说明上架超过1年，过滤掉
    if (oneYearData.data.length) {
      return {
        symbol,
        isStable: false,
      };
    }

    const ret = await getFutureKlineData({
      symbol,
      granularity: '1D',
      limit: MAX_TRADING_DAYS,
      startTime: moment.utc().subtract(MAX_TRADING_DAYS, 'days').valueOf(),
      endTime: moment.utc().valueOf(),
    });
    const data = (ret.data || []).reverse();
    // 上币小于30天的不看
    if (!data || data.length < MIN_TRADING_DAYS) {
      return {
        symbol,
        isStable: false,
      };
    }
    const aggData = parseKlineData(data);
    return {
      symbol,
      isStable: matchLongStable(aggData),
      avgVolume: aggData.avgVolume,
    };
  } catch (error) {
    console.error(`检查${symbol}失败:`, error);
    return {
      symbol,
      isStable: false,
    };
  }
};

// 稳定形态
export const useStableLine = ({ symbols }) => {
  const [stablePairs, setStablePairs] = useState([]);
  const [checkedSymbolCount, setCheckedSymbolCount] = useState(0);
  const checkedSymbolCountRef = useRef(0);
  const stablePairsRef = useRef([]);
  const timeoutRef = useRef(null);

  const getTargetPairs = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (!symbols.length) return;
    const batches = getBatches(symbols);
    // 请求，过滤，设置
    for (let i = 0; i < batches.length; i++) {
      timeoutRef.current = setTimeout(async () => {
        const batch = batches[i];
        const batchPromises = batch.map(async symbol => {
          const checkResult = await checkPair(symbol);
          return checkResult;
        });
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(checkResult => {
          if (checkResult.isStable) {
            stablePairsRef.current.push(checkResult);
          }
        });
        checkedSymbolCountRef.current = checkedSymbolCountRef.current + batchResults.length;
        setCheckedSymbolCount(checkedSymbolCountRef.current);
        setStablePairs([...stablePairsRef.current]);
      }, i * 1000);
    }
  };

  useEffect(() => {
    getTargetPairs();
  }, [symbols]);

  return {
    stablePairs,
    checkedSymbolCount,
  };
};
