// 拆成单独文件只是为了让 exchangeProxy.js 和 tradeSession.js 都能引用它、又不互相循环 import。
export const getProxyConfig = () => ({
  proxyUrl: process.env.GATSBY_EXCHANGE_PROXY_URL,
  proxyToken: process.env.GATSBY_EXCHANGE_PROXY_TOKEN,
});
