import  { useState, useEffect, useRef } from 'react';
import {getKlineData} from '../api'
import moment from 'moment';
import {minTradingUSDTValue} from '../constants/filter'

// 币对切片
const getBatches = (arr)=>{
    // 分批处理，每批最多8个币对
    const batchSize = 8;
    const batches = [];
    for (let i = 0; i < arr.length; i += batchSize) {
      const batch = arr.slice(i, i + batchSize);
      batches.push([...batch.map(b=>b.symbol)]);
    }
    return batches
}

// 获取周期内的最高价、最低价
const getPeriodMinMax = (data, count)=>{
  let minRet = Infinity, maxRet = -Infinity
  const arr = data.slice(0, count);
  for(let i=0;i<arr.length;i++){
    const [,,max,min] = arr[i];
    maxRet = Math.max(max,maxRet)
    minRet = Math.min(min,minRet)
  }
  return [minRet, maxRet]
}

const isStable = (data, count)=>{
  const [min, max] = getPeriodMinMax(data, count);
  return max<=min*2
}

// 一周内平均成交总额
const getAverageTradeValueLastXDay = (data, days)=>{
  return data.slice(0,days).reduce((acc, cur)=>{
    const valueByUSDT = cur[cur.length-1];
    return acc + valueByUSDT*1
  },0)/days 
}

const checkPair = async (symbol)=>{
  const ret = await getKlineData({symbol,granularity:'1D',limit:60,
    startTime: moment.utc().subtract(30, 'days').valueOf(),
    endTime: moment.utc().valueOf(),
})
  const data = (ret.data||[]).reverse()
// 过滤上线超过2个月的老币对
  if(!data || data.length<7 || data.length>=60){
    return {
      symbol,
      isStable:false
    }
  }
  const isOneWeekStable = isStable(data,7)
  const isOneMonkStable = isStable(data,30)
  const avsTradingValueLast7Days = getAverageTradeValueLastXDay(data,7)

    // 过滤近7天日均成交小于5m的比对，先试试看，动态调整参数
    if(symbol === 'CLOUSDT'){
      data.forEach(item=>{
        const [timestamp, openPrice, highPrice, lowPrice, closePrice,valueBySymbol, valueByUSDT] = item
        console.debug(
          moment(timestamp*1).format('YYYY-MM-DD'),
          openPrice, highPrice, lowPrice, closePrice,valueBySymbol, valueByUSDT
        )
      })
    }
  return {
    symbol,
    isStable: (isOneWeekStable||isOneMonkStable) && avsTradingValueLast7Days>minTradingUSDTValue,
    isOneWeekStable,
    isOneMonkStable,
    avsTradingValueLast7Days,
  }
}

// 稳定形态
export const useStableLine = (tradingPairs)=>{
    const [stablePairs, setStablePairs] = useState([])
    const [checkedSymbolCount, setCheckedSymbolCount] = useState(0)
    const checkedSymbolCountRef = useRef(0)
    const stablePairsRef = useRef([])
    const timeoutRef = useRef(null)
  
    const getTargetPairs = ()=>{
        if(timeoutRef.current){
            clearTimeout(timeoutRef.current)
        }
        if(!tradingPairs.length) return
        const batches = getBatches(tradingPairs);
        // 请求，过滤，设置
        for(let i=0; i<batches.length; i++){
          timeoutRef.current = setTimeout(async ()=>{
            const batch = batches[i];
            const batchPromises = batch.map(async (symbol) => {
              const checkResult = await checkPair(symbol);
              return checkResult
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach((checkResult) => {
              if(checkResult.isStable){
                stablePairsRef.current.push(checkResult)
              }
            });
            checkedSymbolCountRef.current = checkedSymbolCountRef.current+batchResults.length
            setCheckedSymbolCount( checkedSymbolCountRef.current )
            setStablePairs([...stablePairsRef.current]);
          },i * 1000)
        }

    }

    useEffect(()=>{
      getTargetPairs()
    },[tradingPairs])

    return {
      stablePairs,
      checkedSymbolCount
    }
}