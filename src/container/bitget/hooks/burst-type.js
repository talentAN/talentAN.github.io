import  { useState, useEffect, useRef } from 'react';
import {getBatches,getPeriodMinMax} from '../utils'
import moment from 'moment';
import {getFutureKlineData} from '../api'

const isBurst = (data, period,risePencent)=>{
    let min, max;
    if(period===1){
        [min,max] = getPeriodMinMax(data, period)
    }else{
         min = getPeriodMinMax(data.slice(1, period))[0]
         max = getPeriodMinMax(data, period-1)[1];
    }
    return max >min && (max-min)/min * 100 > risePencent
}

export const useBurstLine = ({
    futureSymbols,
    risePencent,
    period
})=>{
    const [burstPairs, setBurstPairs] = useState([])
    const [checkedSymbolCount, setCheckedSymbolCount] = useState(0)
    // 记录批次的
    const orderRef = useRef(0)
    const checkedSymbolCountRef = useRef(0)
    const burstPairsRef = useRef([])
    const timeoutRef = useRef(null)

    const checkPair = async (symbol)=>{
        const ret = await getFutureKlineData({
          symbol,
          granularity:'1D',
          limit:period,
          startTime: moment.utc().subtract(period, 'days').valueOf(),
          endTime: moment.utc().valueOf(),
      })
        const data = (ret.data||[]).reverse()

      // 过滤上线超过2个月的老币对
        if(!data || data.length < period){
          return {
            symbol,
            isTarget:false
          }
        }
        const isTarget = isBurst(data,period,risePencent)
        const [bottomPrice, topPrice] = getPeriodMinMax(data,period)
        const currentPrice = data[0][4]
     
        return {
          symbol,
          isTarget,
          currentPrice,
          bottomPrice,
          topPrice,
        }
      }

    const getTargetPairs = ()=>{
        const order = orderRef.current;
        const batches = getBatches(futureSymbols);
        // 请求，过滤，设置
        for(let i=0; i<batches.length; i++){
            setTimeout(async ()=>{
              if(order<timeoutRef.current) return
              const batch = batches[i];
              const batchPromises = batch.map(async (symbol) => {
                const checkResult = await checkPair(symbol);
                return checkResult
              });
              const batchResults = await Promise.all(batchPromises);
              batchResults.forEach((checkResult) => {
                if(checkResult.isTarget){
                  burstPairsRef.current.push(checkResult)
                }
              });
              checkedSymbolCountRef.current = checkedSymbolCountRef.current+batchResults.length
              setCheckedSymbolCount( checkedSymbolCountRef.current )
              setBurstPairs([...burstPairsRef.current]);
            },i * 1000)
          }
    }

    useEffect(()=>{
        orderRef.current = orderRef.current+1
        getTargetPairs()
      },[futureSymbols,risePencent,
        period])  

    return {
        burstPairs,
        checkedSymbolCount
    }
}
