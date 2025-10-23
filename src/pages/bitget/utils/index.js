export const getBatches = (arr)=>{
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
export const getPeriodMinMax = (data, count)=>{
  let minRet = Infinity, maxRet = -Infinity
  const arr = data.slice(0, count);
  for(let i=0;i<arr.length;i++){
    const [,,max,min] = arr[i];
    maxRet = Math.max(max,maxRet)
    minRet = Math.min(min,minRet)
  }
  return [minRet, maxRet]
}