#!/usr/bin/env node
/**
 * K线模式检测 - 简化版
 * 直接读取 klines.json 进行分析
 */

const fs = require('fs');
const path = require('path');

const {
  findAllSupportResistanceLevels,
  findSwingHighs,
  findSwingLows,
  findConsolidationZones,
} = require('../src/container/bitget/utils/trade-record/support-resistance');

const {
  isBullishEntrySignal,
  isBearishEntrySignal,
  isHammer,
  isBullishEngulfing,
  isMorningStar,
  isShootingStar,
  isBearishEngulfing,
  isEveningStar,
} = require('../src/container/bitget/utils/trade-record/kline-pattern');

// 读取 klines.json
const klineFile = path.join(__dirname, 'klines.json');
let klineData;

try {
  const fileContent = fs.readFileSync(klineFile, 'utf8');
  const rawData = JSON.parse(fileContent);

  // 跳过标题行
  const startIndex =
    Array.isArray(rawData[0]) && typeof rawData[0][0] === 'string' && rawData[0][0].includes('时间')
      ? 1
      : 0;

  // 转换数据格式
  klineData = rawData
    .slice(startIndex)
    .map(candle => [
      candle[0],
      parseFloat(candle[1]),
      parseFloat(candle[2]),
      parseFloat(candle[3]),
      parseFloat(candle[4]),
      parseInt(candle[5]),
      parseFloat(candle[6]),
    ]);

  console.log(`✅ 已加载 ${klineData.length} 根K线数据\n`);
} catch (error) {
  console.error(`❌ 读取 klines.json 失败: ${error.message}`);
  process.exit(1);
}

function analyze() {
  console.log('='.repeat(60));
  console.log('  K线模式检测分析');
  console.log('='.repeat(60));

  // 1. 摆动点
  console.log('\n📍 摆动点识别');
  const swingHighs = findSwingHighs(klineData);
  const swingLows = findSwingLows(klineData);
  console.log(`  摆动高点: ${swingHighs.length} 个`);
  swingHighs.forEach(h => console.log(`    - K线${h.index}: ${h.price.toFixed(4)}`));
  console.log(`  摆动低点: ${swingLows.length} 个`);
  swingLows.forEach(l => console.log(`    - K线${l.index}: ${l.price.toFixed(4)}`));

  // 2. 成交密集区
  console.log('\n📦 成交密集区');
  const zones = findConsolidationZones(klineData);
  console.log(`  发现: ${zones.length} 个`);
  zones.slice(0, 3).forEach(z => {
    console.log(
      `    - K线${z.startIndex}~${z.endIndex}: 高${z.high.toFixed(4)}, 低${z.low.toFixed(4)}, 振幅${z.amplitude.toFixed(2)}%`
    );
  });

  // 3. 支撑/阻力位
  console.log('\n🎯 支撑/阻力位');
  const levels = findAllSupportResistanceLevels(klineData);
  console.log(`  阻力位: ${levels.resistance.length} 个`);
  levels.resistance.forEach(r => {
    console.log(`    - ${r.price.toFixed(4)} (强度${r.strength}, ${r.methods.join('+')})`);
  });
  console.log(`  支撑位: ${levels.support.length} 个`);
  levels.support.forEach(s => {
    console.log(`    - ${s.price.toFixed(4)} (强度${s.strength}, ${s.methods.join('+')})`);
  });

  // 4. K线模式 (最后3根)
  console.log('\n📊 K线模式 (最后3根)');
  if (klineData.length >= 3) {
    const lastThree = klineData.slice(-3);

    // 单K线
    if (isHammer(lastThree[2])) console.log('  ✓ 锤子线 (Hammer)');
    if (isShootingStar(lastThree[2])) console.log('  ✓ 射击之星 (Shooting Star)');

    // 双K线
    if (isBullishEngulfing(lastThree[1], lastThree[2]))
      console.log('  ✓ 看涨吞没 (Bullish Engulfing)');
    if (isBearishEngulfing(lastThree[1], lastThree[2]))
      console.log('  ✓ 看跌吞没 (Bearish Engulfing)');

    // 三K线
    if (isMorningStar(lastThree[0], lastThree[1], lastThree[2]))
      console.log('  ✓ 早晨之星 (Morning Star)');
    if (isEveningStar(lastThree[0], lastThree[1], lastThree[2]))
      console.log('  ✓ 黄昏之星 (Evening Star)');

    const bullish = isBullishEntrySignal(lastThree);
    const bearish = isBearishEntrySignal(lastThree);

    console.log(`\n  看涨信号: ${bullish ? '✓ ' + bullish.pattern : '✗ 无'}`);
    console.log(`  看跌信号: ${bearish ? '✓ ' + bearish.pattern : '✗ 无'}`);
  }

  // 5. 入场判断
  console.log('\n⚡ 入场判断');
  const lastKline = klineData[klineData.length - 1];
  const [, , highLast, lowLast] = lastKline;

  const bullishZones = levels.support.filter(
    s => lowLast <= s.price * 1.02 && highLast >= s.price * 0.98
  );
  const bearishZones = levels.resistance.filter(
    r => lowLast <= r.price * 1.02 && highLast >= r.price * 0.98
  );

  if (bullishZones.length > 0 && klineData.length >= 3) {
    const bullish = isBullishEntrySignal(klineData.slice(-3));
    if (bullish) {
      console.log(
        `  🎯 看涨入场: 价格${bullishZones.map(z => z.price.toFixed(4)).join('/')} + ${bullish.pattern}`
      );
    }
  }

  if (bearishZones.length > 0 && klineData.length >= 3) {
    const bearish = isBearishEntrySignal(klineData.slice(-3));
    if (bearish) {
      console.log(
        `  🎯 看跌入场: 价格${bearishZones.map(z => z.price.toFixed(4)).join('/')} + ${bearish.pattern}`
      );
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

analyze();
