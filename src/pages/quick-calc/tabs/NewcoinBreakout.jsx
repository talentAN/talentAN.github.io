import React, { useState, useRef } from 'react';
import { Card, Row, Col, Button, Table, Tag, Progress, Statistic, message, Checkbox } from 'antd';
import { ReloadOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { getTradingPairs, getFutureKlineData } from '../../../container/bitget/api';
import ignoreListRaw from '@root/contract-record/newcoin-breakout-ignore.json';
import willEnterRaw from '@root/contract-record/newcoin-breakout-2026-05-08.json';

// 黑名单, 直接跳过不进结果
const IGNORE_LIST = Array.isArray(ignoreListRaw)
  ? ignoreListRaw
  : Array.isArray(ignoreListRaw?.results)
    ? ignoreListRaw.results
    : [];
const IGNORE_SET = new Set(IGNORE_LIST.map(r => r?.symbol).filter(Boolean));

// 历史「是否会入场」勾选状态的初始值 (兼容纯数组 / { results: [] } 两种格式)
const WILL_ENTER_LIST = Array.isArray(willEnterRaw)
  ? willEnterRaw
  : Array.isArray(willEnterRaw?.results)
    ? willEnterRaw.results
    : [];
const WILL_ENTER_MAP = WILL_ENTER_LIST.reduce((acc, r) => {
  if (r && r.symbol) acc[r.symbol] = !!r.willEnter;
  return acc;
}, {});

// 时间常量
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const LIST_START = new Date('2025-01-01').getTime();
const LIST_SEARCH_START = new Date('2024-10-01').getTime();

// 业务常量
const RATIO_THRESHOLD = 2.5; // 横盘判定: max <= min * 2.5
const STABLE_MIN_DAYS = 17; // 第2天到第18天 = 17 个交易日
const POST_BREAKOUT_DAYS = 10; // 跳出后再观察 10 天 (含跳出当天共 11 天)
const BREAKOUT_PCT = 0.2; // 跳出后最高 > 横盘期最高 * 1.2 视为满足
const PRICE_CEILING = 20; // 横盘区间最低价 > 该值则过滤掉

const fmtPrice = v => (v == null || !isFinite(v) ? '-' : Number(v).toPrecision(5));
const tsToDate = ts => new Date(Number(ts)).toISOString().slice(0, 10);
const fmtUSDT = v => {
  if (v == null || !isFinite(v)) return '-';
  const n = Number(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
};

const NewcoinBreakout = () => {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [onlyBreakout, setOnlyBreakout] = useState(false);
  const abortRef = useRef(false);

  const run = async () => {
    abortRef.current = false;
    setRunning(true);
    setResults([]);
    setProgress({ checked: 0, total: 0 });

    let pairs = [];
    try {
      pairs = await getTradingPairs();
    } catch (e) {
      console.error('获取币对失败', e);
      setRunning(false);
      return;
    }
    setProgress({ checked: 0, total: pairs.length });

    const accumulated = [];
    for (let i = 0; i < pairs.length; i++) {
      if (abortRef.current) break;
      const { symbol } = pairs[i];

      // 黑名单: 直接跳过, 不进入结果
      if (IGNORE_SET.has(symbol)) {
        setProgress({ checked: i + 1, total: pairs.length });
        continue;
      }

      try {
        // 1. 找上架时间 (按 3 月分块往前找第一根 K 线)
        let listTs = null;
        const searchEnd = Date.now();
        for (let cs = LIST_SEARCH_START; cs < searchEnd; cs += THREE_MONTHS_MS) {
          if (abortRef.current) break;
          const ce = Math.min(cs + THREE_MONTHS_MS, searchEnd);
          const res = await getFutureKlineData({
            symbol,
            granularity: '1Dutc',
            limit: 100,
            startTime: cs,
            endTime: ce,
          });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          if (chunk.length) {
            listTs = Math.min(...chunk.map(c => Number(c[0])));
            break;
          }
        }
        if (!listTs || listTs < LIST_START) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        // 2. 增量拉 K 线 + 增量验证横盘 + 跳出后再取 11 天
        let candles = []; // 全量 K 线 (含上架当天)
        let runMaxHigh = -Infinity;
        let runMinLow = Infinity;
        let runQuoteVolSum = 0; // 横盘期 quoteVol 累计 (USDT)
        let stableDays = 0; // 已确认横盘的交易日数
        let breakoutTradingIdx = -1; // 跳出当天的 trading 索引 (0 = 第2天)
        let breakoutReason = null; // 'up' | 'down' 突破方向
        let processedTradingIdx = 0;
        let chunkFrom = listTs;
        let done = false;

        while (!done && !abortRef.current) {
          const chunkTo = chunkFrom + THREE_MONTHS_MS;
          const res = await getFutureKlineData({
            symbol,
            granularity: '1Dutc',
            limit: 100,
            startTime: chunkFrom,
            endTime: chunkTo,
          });
          const chunk = Array.isArray(res?.data) ? res.data : [];
          if (!chunk.length) break;
          chunk.sort((a, b) => Number(a[0]) - Number(b[0]));

          // 去重合并
          const lastTs = candles.length ? Number(candles[candles.length - 1][0]) : 0;
          for (const c of chunk) {
            if (Number(c[0]) > lastTs) candles.push(c);
          }

          // 推进横盘判定 (candles[0] = 上架当天, 跳过)
          // K线格式: [ts, open, high, low, close, vol, quoteVol]
          if (breakoutTradingIdx === -1) {
            while (processedTradingIdx + 1 < candles.length) {
              const candle = candles[processedTradingIdx + 1];
              const high = parseFloat(candle[2]);
              const low = parseFloat(candle[3]);
              const quoteVol = parseFloat(candle[6]);
              const newMax = Math.max(runMaxHigh, high);
              const newMin = Math.min(runMinLow, low);
              if (newMin > 0 && newMax <= newMin * RATIO_THRESHOLD) {
                runMaxHigh = newMax;
                runMinLow = newMin;
                if (isFinite(quoteVol)) runQuoteVolSum += quoteVol;
                stableDays = processedTradingIdx + 1;
                processedTradingIdx++;
              } else {
                breakoutTradingIdx = processedTradingIdx;
                // 判定方向: high 单独触发了上限 / low 单独触发了下限 / 同时触发取过界更大的一侧
                const upBreaks = high > 0 && runMinLow > 0 && high > runMinLow * RATIO_THRESHOLD;
                const downBreaks = low > 0 && runMaxHigh > low * RATIO_THRESHOLD;
                if (upBreaks && downBreaks) {
                  const excessUp = high / runMinLow - RATIO_THRESHOLD;
                  const excessDown = runMaxHigh / low - RATIO_THRESHOLD;
                  breakoutReason = excessUp >= excessDown ? 'up' : 'down';
                } else if (upBreaks) {
                  breakoutReason = 'up';
                } else if (downBreaks) {
                  breakoutReason = 'down';
                }
                break;
              }
            }
          }

          // 早退: 18 天内就跳出, 不符合横盘条件
          if (breakoutTradingIdx >= 0 && stableDays < STABLE_MIN_DAYS) {
            done = true;
            break;
          }

          // 早退: 横盘期最低价 > 20, 直接过滤 (runMinLow 单调递减, 后续不会再降下来)
          if (stableDays >= STABLE_MIN_DAYS && runMinLow > PRICE_CEILING) {
            done = true;
            break;
          }

          // 跳出后已收集 11 天数据, 完成
          if (breakoutTradingIdx >= 0) {
            const totalTrading = candles.length - 1;
            if (totalTrading >= breakoutTradingIdx + 1 + POST_BREAKOUT_DAYS) {
              done = true;
              break;
            }
          }

          if (chunkTo >= Date.now()) break;
          chunkFrom = chunkTo;
        }

        // 不符合 18 天横盘条件 (要么早跳出, 要么交易日不够)
        if (stableDays < STABLE_MIN_DAYS) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        // 横盘期最低价 > 20, 过滤
        if (runMinLow > PRICE_CEILING) {
          setProgress({ checked: i + 1, total: pairs.length });
          continue;
        }

        // 3. 跳出后涨幅判定
        let breakoutDate = null;
        let postMax = null;
        let postMin = null;
        let postCount = 0;
        let satisfied = null;
        if (breakoutTradingIdx >= 0) {
          const breakoutCandle = candles[breakoutTradingIdx + 1];
          breakoutDate = tsToDate(breakoutCandle[0]);
          const post = candles.slice(
            breakoutTradingIdx + 1,
            breakoutTradingIdx + 1 + POST_BREAKOUT_DAYS + 1
          );
          postCount = post.length;
          if (post.length) {
            postMax = Math.max(...post.map(c => parseFloat(c[2])));
            postMin = Math.min(...post.map(c => parseFloat(c[3])));
            const threshold = runMaxHigh * (1 + BREAKOUT_PCT);
            if (postMax > threshold) satisfied = true;
            else if (postCount >= POST_BREAKOUT_DAYS + 1) satisfied = false;
            else satisfied = null; // 数据不足, 待观察
          }
        }

        accumulated.push({
          key: symbol,
          symbol,
          listDate: tsToDate(listTs),
          stableDays,
          rangeHigh: runMaxHigh,
          rangeLow: runMinLow,
          avgDailyVolume: stableDays > 0 ? runQuoteVolSum / stableDays : 0,
          breakoutDate,
          breakoutReason,
          postMax,
          postMin,
          postCount,
          satisfied,
          willEnter: WILL_ENTER_MAP[symbol] || false,
        });
        setResults([...accumulated]);
      } catch (e) {
        console.error(`分析 ${symbol} 失败:`, e);
      }
      setProgress({ checked: i + 1, total: pairs.length });
    }
    setRunning(false);
  };

  const stop = () => {
    abortRef.current = true;
    setRunning(false);
  };

  const toggleWillEnter = symbol => {
    setResults(prev =>
      prev.map(r => (r.symbol === symbol ? { ...r, willEnter: !r.willEnter } : r))
    );
  };

  const buildExportPayload = () => ({
    generatedAt: new Date().toISOString(),
    config: {
      ratioThreshold: RATIO_THRESHOLD,
      stableMinDays: STABLE_MIN_DAYS,
      postBreakoutDays: POST_BREAKOUT_DAYS,
      breakoutPct: BREAKOUT_PCT,
      priceCeiling: PRICE_CEILING,
      listStart: new Date(LIST_START).toISOString().slice(0, 10),
    },
    summary: {
      total: results.length,
      matched: results.filter(r => r.satisfied === true).length,
      notMatched: results.filter(r => r.satisfied === false).length,
      pending: results.filter(r => r.satisfied === null && r.breakoutDate).length,
      stillStable: results.filter(r => !r.breakoutDate).length,
    },
    results,
  });

  const handleCopy = () => {
    if (!results.length) {
      message.warning('暂无数据可复制');
      return;
    }
    const slim = results.map(r => ({ symbol: r.symbol, willEnter: !!r.willEnter }));
    const text = JSON.stringify(slim, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => message.success(`已复制 ${slim.length} 条币对入场状态`))
      .catch(() => message.error('复制失败'));
  };

  const handleExport = () => {
    if (!results.length) {
      message.warning('暂无数据可导出');
      return;
    }
    const text = JSON.stringify(buildExportPayload(), null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newcoin-breakout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  // 统计
  const matched = results.filter(r => r.satisfied === true).length;
  const notMatched = results.filter(r => r.satisfied === false).length;
  const pending = results.filter(r => r.satisfied === null && r.breakoutDate).length;
  const stillStable = results.filter(r => !r.breakoutDate).length;
  const verdictTotal = matched + notMatched;
  const ratio = verdictTotal > 0 ? ((matched / verdictTotal) * 100).toFixed(1) : '0';

  // 入场币对子集统计
  const entryMatched = results.filter(r => r.willEnter && r.satisfied === true).length;
  const entryNotMatched = results.filter(r => r.willEnter && r.satisfied === false).length;
  const entryVerdictTotal = entryMatched + entryNotMatched;
  const entryRatio =
    entryVerdictTotal > 0 ? ((entryMatched / entryVerdictTotal) * 100).toFixed(1) : '0';

  const columns = [
    {
      title: '币对',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 140,
      fixed: 'left',
      render: s => (
        <a
          href={`https://www.bitget.com/zh-CN/futures/usdt/${s}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {s}
        </a>
      ),
    },
    {
      title: '上架日期',
      dataIndex: 'listDate',
      key: 'listDate',
      width: 110,
      sorter: (a, b) => a.listDate.localeCompare(b.listDate),
    },
    {
      title: '横盘时间',
      dataIndex: 'stableDays',
      key: 'stableDays',
      width: 100,
      render: v => <Tag color="orange">{v}天</Tag>,
      sorter: (a, b) => a.stableDays - b.stableDays,
    },
    {
      title: '跳出区间日期',
      dataIndex: 'breakoutDate',
      key: 'breakoutDate',
      width: 130,
      render: v => v || <Tag color="blue">未跳出</Tag>,
    },
    {
      title: '跳出原因',
      dataIndex: 'breakoutReason',
      key: 'breakoutReason',
      width: 100,
      render: v => {
        if (v === 'up') return <Tag color="green">突破上限</Tag>;
        if (v === 'down') return <Tag color="red">突破下限</Tag>;
        return '-';
      },
      filters: [
        { text: '突破上限', value: 'up' },
        { text: '突破下限', value: 'down' },
      ],
      onFilter: (val, r) => r.breakoutReason === val,
    },
    {
      title: '横盘期 高/低',
      key: 'range',
      width: 170,
      render: (_, r) => `${fmtPrice(r.rangeHigh)} / ${fmtPrice(r.rangeLow)}`,
    },
    {
      title: '横盘日均成交额',
      dataIndex: 'avgDailyVolume',
      key: 'avgDailyVolume',
      width: 140,
      render: v => (v > 0 ? `${fmtUSDT(v)}` : '-'),
      sorter: (a, b) => (a.avgDailyVolume || 0) - (b.avgDailyVolume || 0),
    },
    {
      title: '跳出后 高/低',
      key: 'post',
      width: 170,
      render: (_, r) => (r.breakoutDate ? `${fmtPrice(r.postMax)} / ${fmtPrice(r.postMin)}` : '-'),
    },
    {
      title: '跳出后涨幅',
      key: 'postRise',
      width: 110,
      render: (_, r) => {
        if (!r.breakoutDate || r.postMax == null || !r.rangeHigh) return '-';
        const rise = (r.postMax / r.rangeHigh - 1) * 100;
        return (
          <Tag color={rise > BREAKOUT_PCT * 100 ? 'green' : 'default'}>
            {rise >= 0 ? '+' : ''}
            {rise.toFixed(1)}%
          </Tag>
        );
      },
      sorter: (a, b) => {
        const av = a.postMax && a.rangeHigh ? a.postMax / a.rangeHigh : 0;
        const bv = b.postMax && b.rangeHigh ? b.postMax / b.rangeHigh : 0;
        return av - bv;
      },
    },
    {
      title: '是否满足',
      dataIndex: 'satisfied',
      key: 'satisfied',
      width: 110,
      render: v => {
        if (v === true) return <Tag color="green">满足</Tag>;
        if (v === false) return <Tag color="red">不满足</Tag>;
        return <Tag>待观察</Tag>;
      },
      filters: [
        { text: '满足', value: 'yes' },
        { text: '不满足', value: 'no' },
        { text: '待观察', value: 'pending' },
      ],
      onFilter: (val, r) =>
        (val === 'yes' && r.satisfied === true) ||
        (val === 'no' && r.satisfied === false) ||
        (val === 'pending' && r.satisfied === null),
    },
    {
      title: '是否会入场',
      dataIndex: 'willEnter',
      key: 'willEnter',
      width: 100,
      fixed: 'right',
      align: 'center',
      render: (v, r) => <Checkbox checked={!!v} onChange={() => toggleWillEnter(r.symbol)} />,
      filters: [
        { text: '会入场', value: true },
        { text: '不入场', value: false },
      ],
      onFilter: (val, r) => !!r.willEnter === val,
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <strong>新币横盘后突破验证</strong>
            <span style={{ color: '#888', marginLeft: 12 }}>
              上线 ≥ 2025-01-01 · 第 2~18 天满足 max ≤ min × 2.5 · 横盘期最低 ≤ {PRICE_CEILING} ·
              跳出后 11 天内最高 &gt; 横盘期最高 × 1.2 视为满足
            </span>
            <div style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>
              黑名单 {IGNORE_SET.size} 个币对 · 已加载历史入场标记{' '}
              {Object.values(WILL_ENTER_MAP).filter(Boolean).length} 条
            </div>
          </Col>
          <Col>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopy}
              disabled={!results.length}
              style={{ marginRight: 8 }}
            >
              一键复制
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExport}
              disabled={!results.length}
              style={{ marginRight: 8 }}
            >
              导出 JSON
            </Button>
            {running ? (
              <Button onClick={stop}>停止</Button>
            ) : (
              <Button type="primary" icon={<ReloadOutlined />} onClick={run}>
                {results.length ? '重新扫描' : '开始扫描'}
              </Button>
            )}
          </Col>
        </Row>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col flex="1">
          <Card>
            <Statistic title="满足条件" value={matched} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col flex="1">
          <Card>
            <Statistic title="不满足" value={notMatched} valueStyle={{ color: '#f5222d' }} />
          </Card>
        </Col>
        <Col flex="1">
          <Card>
            <Statistic
              title="满足比例"
              value={ratio}
              suffix="%"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col flex="1">
          <Card>
            <Statistic title="未跳出 / 待观察" value={`${stillStable} / ${pending}`} />
          </Card>
        </Col>
        <Col flex="1">
          <Card>
            <Statistic
              title="入场 满足/不满足"
              value={`${entryMatched} / ${entryNotMatched}`}
              suffix={entryVerdictTotal > 0 ? `(${entryRatio}%)` : ''}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        {progress.total > 0 && (
          <Progress
            percent={Math.round((progress.checked / progress.total) * 100)}
            status={running ? 'active' : 'normal'}
            style={{ marginBottom: 12 }}
            format={() => `${progress.checked} / ${progress.total}`}
          />
        )}
        <div
          style={{
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span>
            共筛选出 <strong>{results.length}</strong> 个上线后横盘 ≥ 18 天的币对
          </span>
          <Checkbox checked={onlyBreakout} onChange={e => setOnlyBreakout(e.target.checked)}>
            只看已跳出（上限 / 下限）
          </Checkbox>
        </div>
        <Table
          columns={columns}
          dataSource={
            onlyBreakout
              ? results.filter(r => r.breakoutReason === 'up' || r.breakoutReason === 'down')
              : results
          }
          rowKey="symbol"
          size="small"
          pagination={false}
          scroll={{ x: 1440 }}
          locale={{
            emptyText: running ? '扫描中...' : '点击右上角「开始扫描」',
          }}
        />
      </Card>
    </div>
  );
};

export default NewcoinBreakout;
