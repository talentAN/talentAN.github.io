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

  // On mount: if BINANCE keys exist in env, register an authenticated client (without writing keys)
  useEffect(() => {
    const key = process.env.BINANCE_API_KEY || process.env.GATSBY_BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET || process.env.GATSBY_BINANCE_API_SECRET;
    if (key && secret) {
      try {
        const client = binanceApi.createAuthenticatedClient({ key, secret });
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
