const EXCHANGE_APIS = {
  bitget: {
    name: 'Bitget',
    baseUrl: 'https://api.bitget.com',
    tickerUrl: '/api/v2/mix/market/tickers',
    klineUrl: '/api/v2/mix/market/candles',
    spotKlineUrl: '/api/v2/spot/market/candles',
  },
};

const exchange = EXCHANGE_APIS['bitget'];

// 获取合约币对信息
export const getTradingPairs = async () => {
  let response;
  let data;

  response = await fetch(`${exchange.baseUrl}${exchange.tickerUrl}?productType=USDT-FUTURES`);
  data = await response.json();
  if (data.code === '00000') {
    return data?.data;
  } else {
    console.error('API Error:', data);
    return [];
  }
};

// 获取合约配置（含 isRwa 标记，用于区分代币化股票 / 商品与原生加密资产）
export const getContracts = async () => {
  try {
    const response = await fetch(
      `${exchange.baseUrl}/api/v2/mix/market/contracts?productType=USDT-FUTURES`
    );
    const data = await response.json();
    return data.code === '00000' && Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.error('bitget getContracts error', e);
    return [];
  }
};

// 获取现货币对信息
export const getSpotTradingPairs = async () => {
  let response;
  let data;
  response = await fetch(`https://api.bitget.com/api/v2/spot/public/symbols`);
  data = await response.json();
  if (data.code === '00000') {
    return data?.data;
  } else {
    console.error('API Error:', data);
    return [];
  }
};

// 获取合约K线数据
export const getFutureKlineData = async ({
  symbol,
  granularity,
  limit = 2,
  startTime,
  endTime,
}) => {
  try {
    let url = `${exchange.baseUrl}${exchange.klineUrl}?symbol=${symbol}&granularity=${granularity}&limit=${limit}&productType=USDT-FUTURES`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;

    const ret = await fetch(url);
    return ret.json();
  } catch (e) {
    return {};
  }
};

// 获取现货K线数据
export const getSpotKlineData = async ({ symbol, granularity, limit = 2, startTime, endTime }) => {
  try {
    let url = `${exchange.baseUrl}${exchange.spotKlineUrl}?symbol=${symbol}&granularity=${granularity}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const ret = await fetch(url);
    return ret.json();
  } catch (e) {
    return {};
  }
};

// 获取单个现货交易对行情
export const getSpotTicker = async symbol => {
  try {
    const response = await fetch(
      `${exchange.baseUrl}/api/v2/spot/market/tickers?symbol=${symbol}`
    );
    const data = await response.json();
    return data?.data?.[0];
  } catch (e) {
    console.error('Get spot ticker error:', e);
    return {};
  }
};

// 获取单个合约交易对行情
export const getFutureTicker = async symbol => {
  try {
    const response = await fetch(
      `${exchange.baseUrl}/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${symbol}`
    );
    const data = await response.json();
    return data?.data?.[0];
  } catch (e) {
    console.error('Get future ticker error:', e);
    return {};
  }
};
