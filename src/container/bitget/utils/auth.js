import { generateHeaders } from './headers';

// 从环境变量获取 API 配置
export const getApiConfig = () => {
  const apiKey = process.env.GATSBY_BITGET_API_KEY;
  const apiSecret = process.env.GATSBY_BITGET_API_SECRET;
  const passphrase = process.env.GATSBY_BITGET_PASSPHRASE;
  return { apiKey, apiSecret, passphrase };
};


// 发送认证请求 - 目前只用于获取历史仓位信息
export const authenticatedRequest = async (method, endpoint, params = {}) => {
  const { apiKey, apiSecret, passphrase } = getApiConfig();
  
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('请先配置 API Key');
  }

  const queryString = new URLSearchParams(params).toString();
  const requestPath = queryString ? `${endpoint}?${queryString}` : endpoint;

  const headers = generateHeaders({
    apiKey,
    apiSecret,
    passphrase,
    method,
    requestPath,
    body: ''
  });

  const url = `https://api.bitget.com${requestPath}`;
  const response = await fetch(url, { method, headers });
  return response.json();
};
