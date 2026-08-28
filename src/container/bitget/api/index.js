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

/**
 * 分页拉取 Bitget USDT 合约的全部日线。
 * history-candles 的单页上限为 200；从最新向上市首日回溯。
 */
export const getAllFutureDailyKlines = async ({
  symbol,
  signal,
  onPage,
  endTime = Date.now(),
}) => {
  const pageSize = 200;
  const all = new Map();
  let cursor = endTime;
  let page = 0;

  while (cursor > 0) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `${exchange.baseUrl}/api/v2/mix/market/history-candles?symbol=${encodeURIComponent(
      symbol
    )}&productType=USDT-FUTURES&granularity=1Dutc&limit=${pageSize}&endTime=${cursor}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Bitget K线请求失败 (${response.status})`);
    const body = await response.json();
    if (body?.code !== '00000') throw new Error(body?.msg || 'Bitget K线响应异常');
    const raw = Array.isArray(body.data) ? body.data : [];
    if (!raw.length) break;

    raw.forEach(c => all.set(Number(c[0]), c.slice(0, 7)));
    page += 1;
    onPage?.({ page, loaded: all.size });

    const oldest = Math.min(...raw.map(c => Number(c[0])));
    if (raw.length < pageSize || !Number.isFinite(oldest) || oldest >= cursor) break;
    cursor = oldest - 1;
    // history-candles 单页较小，全市场扫描时主动节流。
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return [...all.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
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

/** 获取 USDT 本位合约当前资金费率。 */
export const getFutureFundingRate = async symbol => {
  const response = await fetch(
    `${exchange.baseUrl}/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}`
  );
  const body = await response.json();
  if (!response.ok || body?.code !== '00000') {
    throw new Error(body?.msg || `Bitget 资金费率请求失败 (${response.status})`);
  }
  const item = Array.isArray(body.data) ? body.data[0] : body.data;
  const fundingRate = Number(item?.fundingRate);
  if (!Number.isFinite(fundingRate)) throw new Error('Bitget 资金费率响应无效');
  return { symbol, fundingRate, fundingTime: Number(item?.fundingTime) || null, raw: body };
};
