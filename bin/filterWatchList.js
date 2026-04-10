#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 读取 watch.json
const watchPath = path.join(__dirname, '../contract-record/watch.json');
const watchData = JSON.parse(fs.readFileSync(watchPath, 'utf8'));

// 过滤出未完成的商品（没有 achieved: true）
const activeSymbols = watchData.filter(item => !item.achieved).map(item => item.symbol);

console.log('活跃观察币对:', activeSymbols);
console.log('总数:', activeSymbols.length);

// 需要调用 API 获取每个币对的近3天成交量
// K线粒度：1d (日线)，获取最近3条
const API = 'https://api.bitget.com/api/v2/mix/market/candles';

async function getVolumeData(symbol) {
  try {
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

    // 获取3天的日线数据
    const url = `${API}?symbol=${symbol}&granularity=1d&limit=3&startTime=${threeDaysAgo}&endTime=${now}&productType=USDT-FUTURES`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.code === '00000' && data.data && Array.isArray(data.data)) {
      const klines = data.data;

      // 计算3天的平均成交量（USDT）
      let totalVolume = 0;
      klines.forEach(k => {
        // k[7] 是成交金额 (quote asset volume)
        if (k[7]) {
          totalVolume += parseFloat(k[7]);
        }
      });

      const avgVolume = totalVolume / klines.length;
      return {
        symbol,
        avgVolume: Math.round(avgVolume),
        totalVolume: Math.round(totalVolume),
        dataPoints: klines.length,
      };
    }

    return {
      symbol,
      avgVolume: 0,
      totalVolume: 0,
      error: 'No data',
    };
  } catch (error) {
    return {
      symbol,
      avgVolume: 0,
      totalVolume: 0,
      error: error.message,
    };
  }
}

async function main() {
  console.log('\n开始获取近3天成交数据...\n');

  const results = [];

  for (const symbol of activeSymbols) {
    const result = await getVolumeData(symbol);
    results.push(result);
    console.log(
      `${result.symbol}: 平均日成交=${(result.avgVolume / 1000000).toFixed(2)}M USDT (总=${(result.totalVolume / 1000000).toFixed(2)}M)`
    );
  }

  // 过滤出平均成交 >= 150万的币对
  const filtered = results
    .filter(r => r.avgVolume >= 1500000)
    .sort((a, b) => b.avgVolume - a.avgVolume);

  console.log('\n========== 过滤结果 (平均成交 >= 150万 USDT) ==========\n');
  console.log('通过过滤的币对:');
  filtered.forEach(r => {
    console.log(`${r.symbol}: ${(r.avgVolume / 1000000).toFixed(2)}M USDT`);
  });

  console.log('\n被过滤掉的币对 (平均成交 < 150万 USDT):');
  const notFiltered = results
    .filter(r => r.avgVolume < 1500000)
    .sort((a, b) => b.avgVolume - a.avgVolume);
  notFiltered.forEach(r => {
    console.log(`${r.symbol}: ${(r.avgVolume / 1000000).toFixed(2)}M USDT`);
  });

  console.log(`\n总计: ${filtered.length}/${activeSymbols.length} 币对满足条件`);
}

main().catch(console.error);
