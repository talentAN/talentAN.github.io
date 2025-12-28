import  { useState, useEffect, useRef } from 'react';
import {getBatches,getPeriodMinMax} from '../utils'
import moment from 'moment';
import {getFutureKlineData} from '../api'

const isStableRise = (data, period,risePencent)=>{
    const min = getPeriodMinMax(data.slice(1, period))[0]
    const max = getPeriodMinMax(data, period-1)[1];

    const isPercentValid = max >min && (max-min)/min * 100 > risePencent
    let isRiseValid = true;
    for(let i=0; i<period.length-1;i++){
      const [,,,,close_price] = arr[i];
      const [,,max_next_day,,close_price_next] = arr[i+1];
      isRiseValid = isRiseValid && close_price_next>=close_price
    }
    return  isPercentValid && isRiseValid
}

export const useStableRiseLine = ({
    futureSymbols,
    risePencent,
    period
})=>{
    const [symbols, setBurstPairs] = useState([])
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
        const isTarget = isStableRise(data,period,risePencent)
        // if(symbol==='PHBUSDT'){
        //   debugger
        // }
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
      },[futureSymbols])  

    return {
        symbols,
        checkedSymbolCount
    }
}
