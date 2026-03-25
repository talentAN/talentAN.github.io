/**
 * 关键位识别工具
 * 用于识别支撑位和阻力位
 */

/**
 * 找出所有摆动高点
 * 摆动高点的定义：前后各2根K线的高点都低于它
 * @param {Array} klineData K线数据数组，每条k线格式：[time, open, high, low, close, volume, ...]
 * @returns {Array} [{index, price, timestamp}, ...]
 */
export const findSwingHighs = klineData => {
  const swingHighs = [];

  if (!klineData || klineData.length < 5) {
    return swingHighs;
  }

  for (let i = 2; i < klineData.length - 2; i++) {
    const currentHigh = parseFloat(klineData[i][2]);
    const prev2High = parseFloat(klineData[i - 2][2]);
    const prev1High = parseFloat(klineData[i - 1][2]);
    const next1High = parseFloat(klineData[i + 1][2]);
    const next2High = parseFloat(klineData[i + 2][2]);

    // 当前K线的高点高于前后2根K线的高点
    if (
      currentHigh > prev2High &&
      currentHigh > prev1High &&
      currentHigh > next1High &&
      currentHigh > next2High
    ) {
      swingHighs.push({
        index: i,
        price: currentHigh,
        timestamp: klineData[i][0],
      });
    }
  }

  return swingHighs;
};

/**
 * 找出所有摆动低点
 * 摆动低点的定义：前后各2根K线的低点都高于它
 * @param {Array} klineData K线数据数组，每条k线格式：[time, open, high, low, close, volume, ...]
 * @returns {Array} [{index, price, timestamp}, ...]
 */
export const findSwingLows = klineData => {
  const swingLows = [];

  if (!klineData || klineData.length < 5) {
    return swingLows;
  }

  for (let i = 2; i < klineData.length - 2; i++) {
    const currentLow = parseFloat(klineData[i][3]);
    const prev2Low = parseFloat(klineData[i - 2][3]);
    const prev1Low = parseFloat(klineData[i - 1][3]);
    const next1Low = parseFloat(klineData[i + 1][3]);
    const next2Low = parseFloat(klineData[i + 2][3]);

    // 当前K线的低点低于前后2根K线的低点
    if (
      currentLow < prev2Low &&
      currentLow < prev1Low &&
      currentLow < next1Low &&
      currentLow < next2Low
    ) {
      swingLows.push({
        index: i,
        price: currentLow,
        timestamp: klineData[i][0],
      });
    }
  }

  return swingLows;
};

/**
 * 识别关键位（支撑位或阻力位）
 * 条件：至少2个摆动点的价格落在P的±1.5%范围内，且间隔至少5根K线
 * @param {Array} swingPoints 摆动点数组 [{index, price, timestamp}, ...]
 * @param {number} tolerance 容差百分比，默认1.5%
 * @param {number} minInterval 最小间隔K线数，默认5
 * @returns {Array} 关键位数组 [{price, points: [...], strength}, ...]
 */
export const findKeyLevels = (swingPoints, tolerance = 1.5, minInterval = 5) => {
  const keyLevels = [];

  if (!swingPoints || swingPoints.length < 2) {
    return keyLevels;
  }

  // 遍历每个摆动点作为潜在的关键位
  for (let i = 0; i < swingPoints.length; i++) {
    const basePrice = swingPoints[i].price;
    const rangeLower = basePrice * (1 - tolerance / 100);
    const rangeUpper = basePrice * (1 + tolerance / 100);

    // 找出落在范围内的其他摆动点
    const pointsInRange = [];

    for (let j = 0; j < swingPoints.length; j++) {
      if (i === j) continue;

      const point = swingPoints[j];

      // 检查价格是否在容差范围内
      if (point.price >= rangeLower && point.price <= rangeUpper) {
        // 检查间隔是否满足最小要求
        if (Math.abs(point.index - swingPoints[i].index) >= minInterval) {
          pointsInRange.push(point);
        }
      }
    }

    // 至少有1个其他摆动点满足条件，即总共至少2个
    if (pointsInRange.length >= 1) {
      // 计算关键位的平均价格
      const allPoints = [swingPoints[i], ...pointsInRange];
      const avgPrice = allPoints.reduce((sum, p) => sum + p.price, 0) / allPoints.length;

      // 检查是否已经存在类似的关键位
      const existingLevel = keyLevels.find(
        level => Math.abs(level.price - avgPrice) < basePrice * (tolerance / 100)
      );

      if (!existingLevel) {
        keyLevels.push({
          price: parseFloat(avgPrice.toFixed(2)),
          points: allPoints.sort((a, b) => a.index - b.index),
          strength: allPoints.length, // 强度由相关摆动点数量决定
        });
      }
    }
  }

  // 按强度排序，强度高的在前
  return keyLevels.sort((a, b) => b.strength - a.strength);
};

/**
 * 识别阻力位（由摆动高点成形）
 * @param {Array} klineData K线数据
 * @param {number} tolerance 容差百分比，默认1.5%
 * @param {number} minInterval 最小间隔K线数，默认5
 * @returns {Array} 阻力位数组
 */
export const findResistanceLevels = (klineData, tolerance = 1.5, minInterval = 5) => {
  const swingHighs = findSwingHighs(klineData);
  return findKeyLevels(swingHighs, tolerance, minInterval);
};

/**
 * 识别支撑位（由摆动低点成形）
 * @param {Array} klineData K线数据
 * @param {number} tolerance 容差百分比，默认1.5%
 * @param {number} minInterval 最小间隔K线数，默认5
 * @returns {Array} 支撑位数组
 */
export const findSupportLevels = (klineData, tolerance = 1.5, minInterval = 5) => {
  const swingLows = findSwingLows(klineData);
  return findKeyLevels(swingLows, tolerance, minInterval);
};

// 综合识别支撑位和阻力位
export const findSupportResistanceLevels = klineData => {
  return {
    resistanceLevels: findResistanceLevels(klineData),
    supportLevels: findSupportLevels(klineData),
  };
};

/**
 * 判断当前价格距离关键位的距离
 * @param {number} currentPrice 当前价格
 * @param {number} keyLevel 关键位价格
 * @returns {string} 距离百分比字符串
 */
export const getPriceDistanceToLevel = (currentPrice, keyLevel) => {
  if (!currentPrice || !keyLevel) return '—';
  const distance = (((currentPrice - keyLevel) / keyLevel) * 100).toFixed(2);
  return distance;
};

/**
 * 获取最近的关键位
 * @param {number} currentPrice 当前价格
 * @param {Array} levels 关键位数组
 * @returns {Object} 最近的阻力位和支撑位
 */
export const getNearestLevels = (currentPrice, levels) => {
  if (!currentPrice || !levels || levels.length === 0) {
    return { nearestResistance: null, nearestSupport: null };
  }

  const resistanceLevels = levels.filter(l => l.price > currentPrice);
  const supportLevels = levels.filter(l => l.price < currentPrice);

  const nearestResistance =
    resistanceLevels.length > 0
      ? resistanceLevels.reduce((min, l) => (l.price < min.price ? l : min))
      : null;

  const nearestSupport =
    supportLevels.length > 0
      ? supportLevels.reduce((max, l) => (l.price > max.price ? l : max))
      : null;

  return { nearestResistance, nearestSupport };
};

// 类型C：识别成交密集区
/**
 * 
{
  startIndex, endIndex,           // 起止下标
  startTime, endTime,             // 起止时间戳
  high, low,                       // 区间高低点
  amplitude,                       // 振幅百分比
  duration,                        // 持续K线数
  resistancePrice,                 // 阻力位（区间上沿）
  supportPrice                     // 支撑位（区间下沿）
} 
 */
export const findConsolidationZones = (klineData, minDays = 10, maxAmplitude = 8) => {
  const zones = [];

  if (!klineData || klineData.length < minDays) {
    return zones;
  }

  // 遍历所有可能的起始位置
  for (let startIdx = 0; startIdx <= klineData.length - minDays; startIdx++) {
    // 从每个起始位置开始，向后扫描找连续的密集区
    let currentHigh = parseFloat(klineData[startIdx][2]);
    let currentLow = parseFloat(klineData[startIdx][3]);

    for (let endIdx = startIdx + minDays - 1; endIdx < klineData.length; endIdx++) {
      const klineHigh = parseFloat(klineData[endIdx][2]);
      const klineLow = parseFloat(klineData[endIdx][3]);

      // 更新当前区间的最高和最低
      currentHigh = Math.max(currentHigh, klineHigh);
      currentLow = Math.min(currentLow, klineLow);

      // 计算振幅
      const amplitude = ((currentHigh - currentLow) / currentLow) * 100;
      const duration = endIdx - startIdx + 1;

      // 检查是否满足条件
      if (amplitude <= maxAmplitude && duration >= minDays) {
        // 检查区间内所有K线的高低点是否都在范围内
        let allPointsInRange = true;
        for (let i = startIdx; i <= endIdx; i++) {
          const h = parseFloat(klineData[i][2]);
          const l = parseFloat(klineData[i][3]);
          if (h > currentHigh || l < currentLow) {
            allPointsInRange = false;
            break;
          }
        }

        if (allPointsInRange) {
          // 检查是否是新的或更优的密集区
          const existingZone = zones.find(z => z.startIndex === startIdx && z.endIndex === endIdx);
          if (!existingZone) {
            zones.push({
              startIndex: startIdx,
              endIndex: endIdx,
              startTime: klineData[startIdx][0],
              endTime: klineData[endIdx][0],
              high: parseFloat(currentHigh.toFixed(2)),
              low: parseFloat(currentLow.toFixed(2)),
              amplitude: parseFloat(amplitude.toFixed(2)),
              duration,
              resistancePrice: parseFloat(currentHigh.toFixed(2)),
              supportPrice: parseFloat(currentLow.toFixed(2)),
            });
          }
        }
      }

      // 如果振幅已经超出范围，不需要再继续延伸
      if (amplitude > maxAmplitude) {
        break;
      }
    }
  }

  // 去除重复和包含关系的密集区
  const filteredZones = [];
  for (const zone of zones) {
    let isDuplicate = false;
    for (const existing of filteredZones) {
      // 如果新区间被现有区间包含或完全相同，跳过
      if (
        zone.startIndex >= existing.startIndex &&
        zone.endIndex <= existing.endIndex &&
        Math.abs(zone.high - existing.high) < existing.high * 0.01 &&
        Math.abs(zone.low - existing.low) < existing.low * 0.01
      ) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      filteredZones.push(zone);
    }
  }

  // 按持续时间排序，时间越长的排在前面
  return filteredZones.sort((a, b) => b.duration - a.duration);
};

/**
 * 判断当前价格是否在密集区内
 * @param {number} currentPrice 当前价格
 * @param {Object} zone 密集区对象
 * @returns {boolean} 是否在密集区内
 */
export const isPriceInConsolidationZone = (currentPrice, zone) => {
  if (!currentPrice || !zone) return false;
  return currentPrice >= zone.low && currentPrice <= zone.high;
};

/**
 * 获取当前价格相对于密集区的位置
 * @param {number} currentPrice 当前价格
 * @param {Object} zone 密集区对象
 * @returns {string} 位置描述：'above' | 'below' | 'inside' | 'unknown'
 */
export const getPricePositionInZone = (currentPrice, zone) => {
  if (!currentPrice || !zone) return 'unknown';

  if (currentPrice > zone.high) return 'above';
  if (currentPrice < zone.low) return 'below';
  if (currentPrice >= zone.low && currentPrice <= zone.high) return 'inside';

  return 'unknown';
};

/**
 * 找出最强的密集区（最长持续时间且振幅最小）
 * @param {Array} zones 密集区数组
 * @returns {Object|null} 最强的密集区或null
 */
export const getStrongestConsolidationZone = zones => {
  if (!zones || zones.length === 0) return null;

  // 按持续时间和振幅计算强度分数
  const scored = zones.map(zone => ({
    ...zone,
    strength: zone.duration * (100 - zone.amplitude), // 时间越长、振幅越小，强度越高
  }));

  return scored.reduce((strongest, current) =>
    current.strength > strongest.strength ? current : strongest
  );
};

/**
 * 综合识别所有支撑位和阻力位
 * 同时使用摆动点方法和成交密集区方法
 * @param {Array} klineData K线数据
 * @returns {Object} {resistance: [...], support: [...]}
 *   每个项包含：{price, type, strength, methods: ['swing'|'consolidation', ...]}
 */
export const findAllSupportResistanceLevels = klineData => {
  const result = {
    resistance: [],
    support: [],
  };

  if (!klineData || klineData.length < 10) {
    return result;
  }

  // 方法1：摆动点识别法
  const resistanceFromSwing = findResistanceLevels(klineData);
  const supportFromSwing = findSupportLevels(klineData);

  // 方法2：成交密集区识别法
  const consolidationZones = findConsolidationZones(klineData);

  // 处理阻力位
  const resistanceLevelMap = new Map();

  // 添加摆动点识别的阻力位
  for (const level of resistanceFromSwing) {
    const key = level.price.toFixed(2);
    if (!resistanceLevelMap.has(key)) {
      resistanceLevelMap.set(key, {
        price: level.price,
        type: 'resistance',
        strength: level.strength,
        methods: ['swing'],
        details: {
          swingPoints: level.points,
        },
      });
    } else {
      const existing = resistanceLevelMap.get(key);
      if (!existing.methods.includes('swing')) {
        existing.methods.push('swing');
        existing.details.swingPoints = level.points;
      }
    }
  }

  // 添加密集区识别的阻力位
  for (const zone of consolidationZones) {
    const key = zone.resistancePrice.toFixed(2);
    const tolerance = zone.high * 0.015; // 1.5% 容差

    let found = false;
    for (const [existingKey, existing] of resistanceLevelMap.entries()) {
      if (Math.abs(existing.price - zone.resistancePrice) <= tolerance) {
        if (!existing.methods.includes('consolidation')) {
          existing.methods.push('consolidation');
          existing.details = existing.details || {};
          existing.details.consolidationZone = zone;
          // 综合强度（摆动点强度 + 密集区持续时间）
          existing.strength += zone.duration;
        }
        found = true;
        break;
      }
    }

    if (!found) {
      resistanceLevelMap.set(key, {
        price: zone.resistancePrice,
        type: 'resistance',
        strength: zone.duration,
        methods: ['consolidation'],
        details: {
          consolidationZone: zone,
        },
      });
    }
  }

  // 处理支撑位
  const supportLevelMap = new Map();

  // 添加摆动点识别的支撑位
  for (const level of supportFromSwing) {
    const key = level.price.toFixed(2);
    if (!supportLevelMap.has(key)) {
      supportLevelMap.set(key, {
        price: level.price,
        type: 'support',
        strength: level.strength,
        methods: ['swing'],
        details: {
          swingPoints: level.points,
        },
      });
    } else {
      const existing = supportLevelMap.get(key);
      if (!existing.methods.includes('swing')) {
        existing.methods.push('swing');
        existing.details.swingPoints = level.points;
      }
    }
  }

  // 添加密集区识别的支撑位
  for (const zone of consolidationZones) {
    const key = zone.supportPrice.toFixed(2);
    const tolerance = zone.low * 0.015; // 1.5% 容差

    let found = false;
    for (const [existingKey, existing] of supportLevelMap.entries()) {
      if (Math.abs(existing.price - zone.supportPrice) <= tolerance) {
        if (!existing.methods.includes('consolidation')) {
          existing.methods.push('consolidation');
          existing.details = existing.details || {};
          existing.details.consolidationZone = zone;
          // 综合强度（摆动点强度 + 密集区持续时间）
          existing.strength += zone.duration;
        }
        found = true;
        break;
      }
    }

    if (!found) {
      supportLevelMap.set(key, {
        price: zone.supportPrice,
        type: 'support',
        strength: zone.duration,
        methods: ['consolidation'],
        details: {
          consolidationZone: zone,
        },
      });
    }
  }

  // 转换为数组并排序
  result.resistance = Array.from(resistanceLevelMap.values()).sort(
    (a, b) => b.strength - a.strength
  );

  result.support = Array.from(supportLevelMap.values()).sort((a, b) => b.strength - a.strength);

  return result;
};

/**
 * 获取所有支撑和阻力位的平铺列表
 * @param {Array} klineData K线数据
 * @returns {Array} 所有支撑和阻力位的平铺数组，按强度排序
 */
export const getAllSupportResistanceLevelsList = klineData => {
  const levels = findAllSupportResistanceLevels(klineData);
  const combined = [...levels.resistance, ...levels.support];
  return combined.sort((a, b) => b.strength - a.strength);
};
