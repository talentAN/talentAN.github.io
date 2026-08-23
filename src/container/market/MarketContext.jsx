import React, { createContext, useContext, useEffect, useState } from 'react';
import marketApi, {
  registerExchange as regExchange,
  setDefaultExchange,
  getRegisteredExchanges,
} from './index';
import * as binanceApi from '../binance/api';

const MarketContext = createContext({
  exchange: 'bitget',
  setExchange: () => {},
  registerExchange: () => {},
  availableExchanges: [],
});

export const MarketProvider = ({ children, initial = 'bitget' }) => {
  const [exchange, setExchange] = useState(initial);
  const initialAvailable = getRegisteredExchanges();
  const [available, setAvailable] = useState(
    Array.isArray(initialAvailable) && initialAvailable.length ? initialAvailable : ['bitget']
  );

  useEffect(() => {
    try {
      setDefaultExchange(exchange);
    } catch (e) {
      // swallow if exchange not registered yet
      // console.warn(e);
    }
  }, [exchange]);

  const registerExchange = (name, apiModule) => {
    regExchange(name, apiModule);
    setAvailable(getRegisteredExchanges());
  };

  // On mount: if BINANCE key + Ed25519 private key exist in env, register an authenticated client.
  // 本地直接签（币安会拦 Cloudflare Workers 的出口 IP，走不了 Worker 代理）。
  useEffect(() => {
    const key = process.env.BINANCE_API_KEY || process.env.GATSBY_BINANCE_API_KEY;
    const privateKey = process.env.BINANCE_PRIVATE_KEY || process.env.GATSBY_BINANCE_PRIVATE_KEY;
    if (key && privateKey) {
      try {
        const client = binanceApi.createAuthenticatedClient();
        registerExchange('binance-auth', client);
      } catch (e) {
        // signing may be unsupported in browser; ignore
        // console.warn(e);
      }
    }
  }, []);

  return (
    <MarketContext.Provider
      value={{ exchange, setExchange, registerExchange, availableExchanges: available }}
    >
      {children}
    </MarketContext.Provider>
  );
};

export const useMarket = () => useContext(MarketContext);

export default {
  MarketProvider,
  useMarket,
};
