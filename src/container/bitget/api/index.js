const EXCHANGE_APIS = {
    bitget: {
      name: 'Bitget',
      baseUrl: 'https://api.bitget.com',
      tickerUrl: '/api/v2/mix/market/tickers',
      klineUrl: '/api/v2/mix/market/candles',
      spotKlineUrl: "/api/v2/spot/market/candles"
    }
}

const exchange = EXCHANGE_APIS["bitget"];

// 获取合约币对信息
export const getTradingPairs = async()=>{
    let response;
    let data;

    // 获取Bitget合约数据
    response = await fetch(`${exchange.baseUrl}${exchange.tickerUrl}?productType=USDT-FUTURES`);
    data = await response.json();
    if (data.code === '00000') {
        return data?.data;
    } else {
      console.error('API Error:', data);
        return []
    }
}

// 获取现货币对信息
export const getSpotTradingPairs = async()=>{
    let response;
    let data;
    // 获取Bitget合约数据
    response = await fetch(`https://api.bitget.com/api/v2/spot/public/symbols`);
    data = await response.json();
    if (data.code === '00000') {
        return data?.data;
    } else {
      console.error('API Error:', data);
        return []
    }
}

// 获取合约K线数据
export const getFutureKlineData = async({symbol,granularity,limit=2,startTime,endTime})=>{
    try{
        const ret = await fetch(`${exchange.baseUrl}/${exchange.klineUrl}?symbol=${symbol}&granularity=${granularity}&limit=${limit}&startTime=${startTime}&endTime=${endTime}&productType=USDT-FUTURES`);
        return ret.json();
    }catch(e){
        return {}
    }
}

export const getSpotKlineData = async({symbol,granularity,limit=2,startTime,endTime})=>{
    try{
        const ret = await fetch(`${exchange.baseUrl}/${exchange.spotKlineUrl}?symbol=${symbol}&granularity=${granularity}&limit=${limit}&startTime=${startTime}&endTime=${endTime}`);
        return ret.json();
    }catch(e){
        return {}
    }
}