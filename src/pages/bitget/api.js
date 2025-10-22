const EXCHANGE_APIS = {
    bitget: {
      name: 'Bitget',
      baseUrl: 'https://api.bitget.com',
      tickerUrl: '/api/v2/mix/market/tickers',
      klineUrl: '/api/v2/mix/market/candles'
    }
}

const exchange = EXCHANGE_APIS["bitget"];

// 获取币对信息
export const getTradingPairs = async()=>{
    let response;
    let data;

    // 获取Bitget合约数据
    response = await fetch(`${exchange.baseUrl}${exchange.tickerUrl}?productType=USDT-FUTURES`);
    data = await response.json();
    console.log('API Response:', data);
    
    if (data.code === '00000') {
        return data?.data;
    } else {
      console.error('API Error:', data);
        return []
    }
}

// 获取K线数据
export const getKlineData = async({symbol,granularity,limit=2})=>{
    try{
        const ret = await fetch(`${exchange.baseUrl}/${exchange.klineUrl}?symbol=${symbol}&granularity=${granularity}&limit=${limit}&productType=USDT-FUTURES`);
        return ret.json();
    }catch(e){
        return {}
    }

}