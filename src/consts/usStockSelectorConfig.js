/**
 * 美股筛选器 — 参数配置
 *
 * 标的来源：Binance underlyingType=TradFi 合约 + Bitget isRwa=YES 合约。
 * 两所都有的标的优先 Binance，仅 Bitget 有的保留 Bitget。
 *
 * 阈值不是拍脑袋，是拿币圈现有参数的「严格度」对齐过来的：
 * 币圈单日 30% 落在日线分布的 P99（命中率 1.03%），
 * 美股同分位对应 14.5%（命中率 0.97%）→ 取 15%。
 * 窗口峰值、连续 4 天同法对齐（币圈 40% / 50% 的命中率 6.68% / 4.12%）。
 * 样本：159 个标的、约 12000 根日线（2026-08 拉取）。
 */

/** 模式一：过去 N 个交易日暴涨 */
export const US_SPIKE_CONFIG = {
    windowDays: 4,
    /** 单日涨幅阈值 — 对齐币圈 30%（同为 P99） */
    riseRatio: 0.15,
    /** 窗口最高价高于最远一天开盘价 — 对齐币圈 40% */
    peakRatio: 0.2,
    /** 触发日量比（quoteVol / 前 10 日均量）— 实用档 */
    volumeRatio: 1.5,
    volumeMaDays: 10,
  };
  
  /** 模式二：N 个交易日内暴涨仍高位 */
  export const US_HOLD_CONFIG = {
    klineLimit: 90,
    /** 单日涨幅阈值 */
    riseRatio: 0.15,
    /** 连续 4 天涨幅 — 对齐币圈 50% */
    fourDayRunRatio: 0.22,
    /** 高位下限：当前价 ≥ 基准价 × 此值 */
    priceRatio: 0.97,
    /**
     * 高位上限：当前价 ≤ 基准价 × 此值。
     * 虚拟币没有这一条（涨完就砸）；美股会沿着高位继续走趋势，
     * 不设上限会把「已经走成新趋势」的标的一起捞进来（实测命中率 33%，币圈只有 7%）。
     */
    maxPriceRatio: 1.1,
    /** 基准日量比 — 实用档 */
    volumeRatio: 1.5,
    volumeMaDays: 10,
  };
  
  /** 商品 / 金属 / 能源 —— 不是股票 */
  export const US_COMMODITY = [
    'XAU', 'XAG', 'XPT', 'XPD', 'XAUT', 'PAXG', 'COPPER', 'NATGAS', 'CL', 'BZ',
  ];
  
  /** 未上市公司合成盘（无真实股票市场结构） */
  export const US_PRE_IPO = ['ANTHROPIC', 'OPENAI', 'SPCX', 'MOONSHOT', 'SHAZ', 'ECHO'];
  
  /** 杠杆 / 反向 ETF —— 涨跌被放大 2~3 倍，会污染阈值 */
  export const US_LEVERAGED = [
    'SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'TSLL', 'NVDL', 'GGLL', 'MSFU', 'AMZU', 'MSTU',
    'CONL', 'AAPU', 'METU', 'MUU', 'XNDU', 'TZA', 'TBT', 'UVXY', 'TMF', 'DFEN',
    'KORU', 'SNXX', 'INTW', 'SPCH', 'SKUU', 'MVLL', 'JMKE', 'SKDD', 'NVDX', 'MSTX', 'BITO',
  ];
  
  /** 指数 / 板块 / 国家 ETF —— 一篮子，不是个股注意力 */
  export const US_INDEX_ETF = [
    'SPY', 'QQQ', 'VOO', 'IWM', 'SMH', 'SOXX', 'XBI', 'IBB', 'XLE', 'XLK', 'XLU', 'XLV',
    'KWEB', 'INDA', 'EWJ', 'EWZ', 'EWY', 'EWH', 'EWT', 'SP500', 'NDX100', 'BOTZ', 'ROBO',
    'SGOV', 'DIASTOCK', 'SLX', 'KR200', 'CSOPSK2LHKD', 'CSOPSS2LHKD',
  ];
  
  /** 非美上市（本土挂牌）—— 美股 ADR 不在此列，仍算美股 */
  export const US_NON_US_LISTED = [
    'TENCENT', 'TENCENTHKD', 'XIAOMI', 'XIAOMIHKD', 'MEITUAN', 'KUAISHOU', 'POPMART',
    'ZHIPU', 'ZHIPUHKD', 'MINIMAX', 'MINIMAXHKD', 'SMIC', 'GIGADEVICE', 'ZHONGJI',
    'SAMSUNG', 'SAMSUNGEM', 'SKHYNIX', 'SKHY', 'LGELECTRONICS', 'HYUNDAI', 'HANMI',
    'DOOSBOT', 'DOOSENER', 'NAVER', 'ADVANTEST', 'LASERTEC', 'KIOXIA', 'TOKYOEL',
    'SUMIELEC', 'DISK', 'DRAM', 'EUV', 'OSS', 'TER', 'FWDI', 'KSTR', 'BSP', 'BNC',
    'MAR', 'RAM', 'LIN',
  ];
  
  const toSet = arr => new Set(arr);
  
  const CATEGORY_SETS = [
    ['commodity', toSet(US_COMMODITY)],
    ['preIpo', toSet(US_PRE_IPO)],
    ['leveraged', toSet(US_LEVERAGED)],
    ['indexEtf', toSet(US_INDEX_ETF)],
    ['nonUs', toSet(US_NON_US_LISTED)],
  ];
  
  /** 把 baseCoin 归类，未命中任何排除集的视为美股个股 */
  export const classifyRwaSymbol = baseCoin => {
    const found = CATEGORY_SETS.find(([, set]) => set.has(baseCoin));
    return found ? found[0] : 'stock';
  };
  
  export const US_CATEGORY_LABELS = {
    stock: '个股',
    indexEtf: '指数 / 板块 ETF',
    leveraged: '杠杆 / 反向 ETF',
    nonUs: '非美上市',
    commodity: '商品 / 金属',
    preIpo: 'Pre-IPO 合成盘',
  };
  
  /** 默认只扫个股 */
  export const US_DEFAULT_CATEGORIES = ['stock'];
  
  /** 大盘方向过滤：币圈用 BTC，美股用指数 */
  export const US_MARKET_FILTER = {
    symbols: ['SPYUSDT', 'QQQUSDT'],
    maRef: 50,
  };
  
  /** Anonymous Gregorian：算某年复活节周日（UTC） */
  const easterSunday = year => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  };
  
  const ymd = d => d.toISOString().slice(0, 10);
  
  /** 固定日遇周末则按 NYSE 惯例顺延（周六→周五，周日→周一） */
  const observed = (year, month, day) => {
    const d = new Date(Date.UTC(year, month, day));
    const wd = d.getUTCDay();
    if (wd === 6) d.setUTCDate(d.getUTCDate() - 1);
    else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };
  
  /** 某月第 n 个星期 w（w: 0=日 … 4=四） */
  const nthWeekday = (year, month, weekday, n) => {
    const first = new Date(Date.UTC(year, month, 1));
    const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7;
    return new Date(Date.UTC(year, month, day));
  };
  
  /** 某月最后一个星期 w */
  const lastWeekday = (year, month, weekday) => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    return new Date(Date.UTC(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)));
  };
  
  /** 生成某年 NYSE 全休市日（不含提前收盘日——那天仍有交易） */
  const usMarketHolidaysOf = year => {
    const goodFriday = easterSunday(year);
    goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    const list = [
      observed(year, 0, 1), // New Year（遇周六会落到上一年 12/31）
      nthWeekday(year, 0, 1, 3), // MLK
      nthWeekday(year, 1, 1, 3), // Presidents
      goodFriday,
      lastWeekday(year, 4, 1), // Memorial
      observed(year, 6, 4), // Independence
      nthWeekday(year, 8, 1, 1), // Labor
      nthWeekday(year, 10, 4, 4), // Thanksgiving
      observed(year, 11, 25), // Christmas
    ];
    if (year >= 2021) list.push(observed(year, 5, 19)); // Juneteenth
    return new Set(list.map(ymd));
  };
  
  const holidayCache = new Map();
  const holidaysOf = year => {
    if (!holidayCache.has(year)) holidayCache.set(year, usMarketHolidaysOf(year));
    return holidayCache.get(year);
  };
  
  /**
   * 代币化永续 24h 出 K，但周末 / NYSE 休市日正股不开盘、流动性极差，
   * 那几根 K 线既不代表涨跌也不代表量能，判定前一律剔除。
   * 于是配置里的「天」全部读作「交易日」。
   * 识别不了的特殊休市（交易所临时停牌等）忽略，不强求。
   */
  export const dropWeekendCandles = candles =>
    candles.filter(c => {
      const d = new Date(Number(c[0]));
      const day = d.getUTCDay();
      if (day === 0 || day === 6) return false;
      const key = ymd(d);
      const y = d.getUTCFullYear();
      // 新年若顺延到 12/31，记在下一年的假期表里
      return !holidaysOf(y).has(key) && !holidaysOf(y + 1).has(key);
    });
  
  /** 剔除周末约 2/7，再留出每年 ~10 个节假日的冗余 */
  export const withWeekendBuffer = tradingDays => Math.ceil((tradingDays * 7) / 5) + 15;
  
  /**
   * 量比：当日 quoteVol / 前 10 个交易日 quoteVol 均值（不含当日）。
   *
   * 标定（2026-08，个股约 6933 根交易日 K vs 币圈约 14000 根）：
   * - 无条件分布主体接近（两边 median 都是 0.77、P90≈2.0），币圈右尾更肥。
   * - 币圈 5× 命中率 2.65% → 美股同分位约 3.6×。
   * - 但「暴涨日」上两边差很大：币圈 rise≥30% 的日，量比中位 5.2×、过半 ≥5×；
   *   美股 rise≥15% 的日，量比中位仅 1.35×，≥5× 只有 9.6%。
   *   板块共振日（如 2026-07-30）大量票涨幅够但量比只有 1.3~1.9×。
   *
   * 因此初始不用 5×，而用「与价格条件联立时，联合命中率对齐币圈」的口径：
   * 币圈 (rise≥30% ∧ vol≥5×) ≈ 0.57% 根；美股 (rise≥15% ∧ vol≥1.5×) ≈ 0.61% 根。
   */
  export const US_VOLUME_CONFIG = {
    maDays: 10,
    /** 涌入确认：与涨幅条件联立用（已接入筛选） */
    inflowRatio: 1.5,
    /** 严格档：无条件同分位对齐币圈 5×（约 P97.4），后续可切换 */
    strictRatio: 3.5,
  };
  
  /** 还没解决的问题（目前为空则不展示待迭代盒） */
  export const US_PENDING_ITEMS = [];
  
  /**
   * 板块共振提醒阈值（不参与过滤，只在结果出来后提示人工判断）。
   * 同一触发日命中 ≥ minCount 条，或该日占比 ≥ minRatio，视为疑似板块/大盘行情。
   */
  export const US_RESONANCE_HINT = {
    minCount: 3,
    minRatio: 0.35,
  };
  
  /** 按结果里的触发日聚合，返回需要人工核对的共振日列表 */
  export const detectSectorResonance = (rows, dateKey) => {
    if (!rows?.length) return [];
    const counts = {};
    rows.forEach(r => {
      const d = r[dateKey];
      if (!d) return;
      counts[d] = (counts[d] || 0) + 1;
    });
    const total = rows.length;
    return Object.entries(counts)
      .filter(
        ([, n]) =>
          n >= US_RESONANCE_HINT.minCount || n / total >= US_RESONANCE_HINT.minRatio
      )
      .sort((a, b) => b[1] - a[1])
      .map(([date, count]) => ({ date, count, ratio: count / total }));
  };
  