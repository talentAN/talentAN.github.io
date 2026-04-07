import { useState, useEffect, useRef } from 'react';
import { getBatches } from '../utils';
import moment from 'moment';
import { getFutureKlineData } from '../api';
import { shouldEntry } from '@root/src/container/bitget/utils/trade-record/should-entry';
import watchData from '@root/contract-record/watch.json';
import ignoreList from '@root/contract-record/ignore.json';

const WATCH_ACHIEVED_SYMBOLS = new Set(
  watchData.filter(entry => !entry.achieved).map(entry => entry.symbol)
);

// 检查币对是否应该被忽略（成交量爆炸币对列表中的忽略配置）
const shouldIgnoreSymbol = symbol => {
  const ignoreItem = ignoreList.find(item => item.symbol === symbol);
  if (!ignoreItem) return false;

  const currentDate = moment();
  const ignoreBeforeDate = moment(ignoreItem.ignoreBefore);
  return currentDate.isBefore(ignoreBeforeDate);
};

export const useRiseToFallLine = ({ futureSymbols }) => {
  const [symbols, setSymbols] = useState([]);
  const [checkedSymbolCount, setCheckedSymbolCount] = useState(0);
  const [volumeSpikeData, setVolumeSpikeData] = useState([]);
  const orderRef = useRef(0);
  const checkedSymbolCountRef = useRef(0);
  const symbolsRef = useRef([]);
  const volumeSpikeRef = useRef([]);
  const timeoutRef = useRef(null);

  // 检查成交量爆炸条件: 倒数第3天或第4天的成交量 > 6倍过去20天平均
  const checkVolumeSpike = (symbol, data) => {
    try {
      if (!data || data.length < 4) {
        return null;
      }

      // 获取倒数第3天（index: length-3）和倒数第4天（index: length-4）的成交量（以USDT计）
      const day2Volume = parseFloat(data[data.length - 2][6]); // 昨日（倒数第2天）交易额
      const day3Volume = parseFloat(data[data.length - 3][6]); // 倒数第3天交易额
      const day4Volume = parseFloat(data[data.length - 4][6]); // 倒数第4天交易额
      const spikeVolume = Math.max(day3Volume, day4Volume);

      // 计算过去20天的平均成交量（以USDT计，去掉最后4天，确保比较的是更早期的数据）
      let totalVolume = 0;
      let volumeCount = 0;
      for (let i = 0; i < data.length - 4; i++) {
        totalVolume += parseFloat(data[i][6]);
        volumeCount++;
      }
      const avgVolume = totalVolume / volumeCount;

      // 检查是否满足条件：成交量 > 6倍平均值 AND 爆炸成交量 > 200万USDT
      if (spikeVolume > avgVolume * 6 && spikeVolume > 2000000) {
        return {
          symbol,
          yesterdayVolume: day2Volume.toFixed(0),
          spikeVolume: spikeVolume.toFixed(0),
          avgVolume: avgVolume.toFixed(0),
          ratio: (spikeVolume / avgVolume).toFixed(2),
          date: data[data.length - 3][0], // 倒数第3天的时间戳
        };
      }

      return null;
    } catch (error) {
      console.error(`检查 ${symbol} 成交量失败:`, error);
      return null;
    }
  };

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

    // 同时检查成交量爆炸（使用相同的K线数据）
    const volumeSpike = checkVolumeSpike(symbol, data);
    if (volumeSpike) {
      const inWatchAchieved = WATCH_ACHIEVED_SYMBOLS.has(symbol);
      if (!inWatchAchieved && !shouldIgnoreSymbol(symbol)) {
        volumeSpike.currentPrice = currentPrice.toFixed(4);
        volumeSpike.entrySignal = entryResult.shouldEntry ? entryResult : null;
        volumeSpikeRef.current.push(volumeSpike);
      }
    }

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
        setVolumeSpikeData([...volumeSpikeRef.current]);
      }, i * 1000);
    }
  };

  useEffect(() => {
    orderRef.current = orderRef.current + 1;
    symbolsRef.current = [];
    volumeSpikeRef.current = [];
    checkedSymbolCountRef.current = 0;
    setCheckedSymbolCount(0);
    setSymbols([]);
    setVolumeSpikeData([]);
    getTargetPairs();
  }, [futureSymbols]);

  return {
    symbols,
    checkedSymbolCount,
    volumeSpikeData,
  };
};
