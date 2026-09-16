import React, { useEffect, useState } from 'react';
import moment from 'moment';
import { getFutureKlineData } from '@root/src/container/market';
import * as s from './pairSelector.module.less';
import { MARKET_CONFIG } from '@root/src/consts/pairSelectorConfig';
import { MARKET_DATA_CONFIG } from '@root/src/configs/pairSelectorConfig';
import QuickCalcToolDock from './QuickCalcToolDock';

const SYMBOLS = ['BTC', 'ETH'];

const calculatePriceChange = (data, days) => {
  if (!Array.isArray(data) || data.length <= days) return null;
  const latest = Number(data[data.length - 1]?.[4]);
  const previous = Number(data[data.length - 1 - days]?.[4]);
  if (!(latest > 0) || !(previous > 0)) return null;
  return ((latest - previous) / previous) * 100;
};

const PriceTickerBanner = () => {
  const [marketData, setMarketData] = useState({ BTC: {}, ETH: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const endTime = moment().valueOf();
      const startTime = moment().subtract(MARKET_CONFIG.klineDays, 'days').valueOf();
      const results = await Promise.all(
        SYMBOLS.map(async symbol => {
          try {
            const result = await getFutureKlineData(
              {
                symbol: `${symbol}USDT`,
                granularity: '1D',
                limit: MARKET_CONFIG.klineDays,
                startTime,
                endTime,
              },
              'binance'
            );
            const data = Array.isArray(result?.data) ? result.data : [];
            return [
              symbol,
              {
                latest: data.length ? Number(data[data.length - 1]?.[4]) : null,
                day7: calculatePriceChange(data, MARKET_DATA_CONFIG.displayPeriods[0]),
                day15: calculatePriceChange(data, MARKET_DATA_CONFIG.displayPeriods[1]),
                day45: calculatePriceChange(data, MARKET_DATA_CONFIG.displayPeriods[2]),
              },
            ];
          } catch (_) {
            return [symbol, null];
          }
        })
      );
      if (disposed) return;
      setMarketData(prev => {
        const next = { ...prev };
        results.forEach(([symbol, data]) => {
          if (data?.latest != null) next[symbol] = data;
        });
        return next;
      });
      setLoading(false);
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const renderStats = (symbol, data) => {
    const href = `https://www.binance.com/zh-CN/futures/${symbol}USDT`;
    return (
      <div className={s.marketItem} key={symbol}>
        <a className={s.marketSymbol} href={href} target="_blank" rel="noopener noreferrer">
          {symbol}
        </a>
        <a className={s.marketPrice} href={href} target="_blank" rel="noopener noreferrer">
          {data.latest == null ? '-' : data.latest.toLocaleString()}
        </a>
        {MARKET_DATA_CONFIG.displayPeriods.map(days => {
          const value = data[`day${days}`];
          const tone = value == null ? s.chipFlat : value >= 0 ? s.chipUp : s.chipDown;
          return (
            <span key={days} className={`${s.chip} ${tone}`}>
              <span className={s.chipLabel}>{days}日</span>
              {value == null ? '-' : `${value.toFixed(2)}%`}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="quick-calc-ticker">
      <div className={s.marketBar}>
        {loading && !marketData.BTC.latest && !marketData.ETH.latest ? (
          <span className={s.muted}>加载市场数据...</span>
        ) : (
          <>
            {renderStats('BTC', marketData.BTC)}
            {renderStats('ETH', marketData.ETH)}
          </>
        )}
      </div>
      <QuickCalcToolDock />
    </div>
  );
};

export default PriceTickerBanner;
