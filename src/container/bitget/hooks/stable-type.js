import  { useState, useEffect, useRef } from 'react';
import {getFutureKlineData, getSpotKlineData} from '../api'
import moment from 'moment';
import {minTradingUSDTValue,MAX_TRADING_DAYS,MIN_TRADING_DAYS} from '../constants/filter'
import {getBatches,getPeriodMinMax} from '../utils'


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

const checkPair = async (symbol, type)=>{
  const isFuture = type === 'future'
  const api =isFuture ? getFutureKlineData : getSpotKlineData
  const ret = await api({symbol,granularity: isFuture ? '1D': '1day',limit:MAX_TRADING_DAYS,
    startTime: moment.utc().subtract(MAX_TRADING_DAYS, 'days').valueOf(),
    endTime: moment.utc().valueOf(),
})
  const data = (ret.data||[]).reverse()
  if(!data || data.length<MIN_TRADING_DAYS || data.length>=MAX_TRADING_DAYS){
    return {
      symbol,
      isStable:false
    }
  }
  const isOneWeekStable = isStable(data,MIN_TRADING_DAYS)
  const isOneMonStable = isStable(data,MAX_TRADING_DAYS)

  const avsTradingValueLast7Days = getAverageTradeValueLastXDay(data,MIN_TRADING_DAYS)

    // 过滤近7天日均成交小于5m的比对，先试试看，动态调整参数
    // if(symbol === 'CLOUSDT'){
    //   data.forEach(item=>{
    //     const [timestamp, openPrice, highPrice, lowPrice, closePrice,valueBySymbol, valueByUSDT] = item
    //     console.debug(
    //       moment(timestamp*1).format('YYYY-MM-DD'),
    //       openPrice, highPrice, lowPrice, closePrice,valueBySymbol, valueByUSDT
    //     )
    //   })
    // }
  return {
    symbol,
    isStable: isOneMonStable && avsTradingValueLast7Days>minTradingUSDTValue,
    isOneWeekStable,
    isOneMonStable,
    avsTradingValueLast7Days,
  }
}

// 稳定形态
export const useStableLine = ({
  symbols,
  type
})=>{
    const [stablePairs, setStablePairs] = useState([])
    const [checkedSymbolCount, setCheckedSymbolCount] = useState(0)
    const checkedSymbolCountRef = useRef(0)
    const stablePairsRef = useRef([])
    const timeoutRef = useRef(null)
    console.debug('symbols',symbols)
  
    const getTargetPairs = ()=>{
        if(timeoutRef.current){
            clearTimeout(timeoutRef.current)
        }
        if(!symbols.length) return
        const batches = getBatches(symbols);
        // 请求，过滤，设置
        for(let i=0; i<batches.length; i++){
          timeoutRef.current = setTimeout(async ()=>{
            const batch = batches[i];
            const batchPromises = batch.map(async (symbol) => {
              const checkResult = await checkPair(symbol,type);
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
    },[symbols])

    return {
      stablePairs,
      checkedSymbolCount
    }
}