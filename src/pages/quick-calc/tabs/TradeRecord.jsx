import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Table, Button, Checkbox, message, DatePicker, Tag, Radio, Tooltip, Input } from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import {
  fetchAllTradeRecords,
  getTradeLink,
  EXCHANGE_LABEL,
  ensureNotionals,
} from '../../../container/trade-record/_index';
import localRecords from '@root/contract-record/all.json';
import { PATTERN, PATTERN_Array } from '@root/src/consts';
import moment from 'moment';

const { RangePicker } = DatePicker;
const { TextArea } = Input;

/** 双击进入编辑，失焦写回并恢复文本展示 */
const EditableTextCell = ({ value, multiline = false, emptyText = '-', onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      // antd Input / TextArea
      const el = inputRef.current?.resizableTextArea?.textArea || inputRef.current?.input || inputRef.current;
      el?.focus?.();
      if (el && typeof el.select === 'function' && !multiline) el.select();
    }
  }, [editing, multiline]);

  const commit = () => {
    onCommit(draft);
    setEditing(false);
  };

  if (editing) {
    if (multiline) {
      return (
        <TextArea
          ref={inputRef}
          value={draft}
          autoSize={{ minRows: 2, maxRows: 8 }}
          style={{ fontSize: 12 }}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
        />
      );
    }
    return (
      <Input
        ref={inputRef}
        size="small"
        value={draft}
        style={{ fontSize: 12, padding: '0 4px' }}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onPressEnter={commit}
      />
    );
  }

  const text = value != null && String(value).trim() !== '' ? String(value) : emptyText;
  const body = (
    <div
      onDoubleClick={() => {
        setDraft(value ?? '');
        setEditing(true);
      }}
      title="双击编辑"
      style={
        multiline
          ? {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              cursor: 'text',
              minHeight: 18,
            }
          : {
              cursor: 'text',
              minHeight: 18,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }
      }
    >
      {text}
    </div>
  );

  if (multiline && text !== emptyText) {
    return (
      <Tooltip
        title={<div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>}
        placement="topLeft"
        overlayStyle={{ background: '#fff', color: '#000' }}
      >
        {body}
      </Tooltip>
    );
  }
  return body;
};

/** 系统统计表展示的入场模式（按此顺序） */
const STAT_SYSTEMS = [
  {
    key: PATTERN.high_volume_breakout_shrink_stall,
    label: '放量冲关缩量滞涨',
  },
  {
    key: PATTERN.surge_100_pullback,
    label: '爆100回调',
  },
];

const expectationTooltip = (
  <div style={{ fontSize: 12, lineHeight: '1.8' }}>
    <div style={{ marginBottom: 2, fontWeight: 'bold', color: '#fff' }}>
      期望值 = 胜率×均盈R − 败率×均亏R
    </div>
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 4 }}>
      <div>
        <span style={{ color: '#ff4d4f' }}>{'< 0'}</span>
        {'　负期望，长期必亏，系统不可用'}
      </div>
      <div>
        <span style={{ color: '#faad14' }}>{'0 ~ 0.1'}</span>
        {'　微弱正期望，接近保本，仍在噪音区间'}
      </div>
      <div>
        <span style={{ color: '#73d13d' }}>{'0.1 ~ 0.2'}</span>
        {'　轻微正期望，系统基本可行，继续验证'}
      </div>
      <div>
        <span style={{ color: '#52c41a' }}>{'0.2 ~ 0.4'}</span>
        {'　良好正期望，系统稳定可用'}
      </div>
      <div>
        <span style={{ color: '#1890ff' }}>{'>  0.4'}</span>
        {'　高期望，优质系统（注意样本量是否充足）'}
      </div>
    </div>
  </div>
);

const TradeRecord = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(null);
  const [onlyHighlight, setOnlyHighlight] = useState(false);
  const [entryReasonFilter, setEntryReasonFilter] = useState(null);
  const [onlyTrades, setOnlyTrades] = useState(true);
  const [directionFilter, setDirectionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(
    () => setCurrentPage(1),
    [directionFilter, onlyHighlight, entryReasonFilter, onlyTrades]
  );

  const recordsToDisplay = useMemo(() => {
    let temp =
      directionFilter === 'all' ? records : records.filter(r => r.holdSide === directionFilter);
    if (onlyHighlight) {
      temp = temp.filter(r => r.tags?.includes?.('highlight'));
    }
    if (entryReasonFilter) {
      temp = temp.filter(r => r.entryReason === entryReasonFilter);
    }
    if (onlyTrades) {
      temp = temp.filter(r => r.type !== 'summery');
    }
    return temp;
  }, [records, directionFilter, onlyHighlight, entryReasonFilter, onlyTrades]);

  const getDiffColor = diff => {
    if (!diff) return undefined;
    if (diff < 15) return 'green';
    if (diff < 30) return 'orange';
    return 'red';
  };

  /** 尾部去 0；≥1000 → K，≥100万 → M */
  const formatCompactNumber = value => {
    const n = parseFloat(value);
    if (value == null || value === '' || Number.isNaN(n)) return '-';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    let scaled = abs;
    let suffix = '';
    if (abs >= 1e6) {
      scaled = abs / 1e6;
      suffix = 'M';
    } else if (abs >= 1e3) {
      scaled = abs / 1e3;
      suffix = 'K';
    }
    const decimals = suffix ? 2 : 8;
    let text = scaled.toFixed(decimals).replace(/\.?0+$/, '');
    return `${sign}${text}${suffix}`;
  };

  const getEntryReasonLabel = reason => {
    if (!reason) return '-';
    const pattern = PATTERN_Array.find(p => p.key === reason);
    return pattern ? pattern.label : reason;
  };

  const getRMultiplier = utime => {
    // 2026-04-02 00:00:00 的时间戳
    const cutoffTime = moment('2026-04-02', 'YYYY-MM-DD').valueOf();
    // utime通常是毫秒时间戳，如果不是则需要转换
    const timestamp = typeof utime === 'string' ? parseInt(utime) : utime;
    return timestamp >= cutoffTime ? 10 : 1;
  };

  const calculatePatternStats = patternKey => {
    const filteredRecords = records.filter(
      r =>
        r.type !== 'summery' &&
        r.entryReason === patternKey &&
        (directionFilter === 'all' || r.holdSide === directionFilter)
    );

    if (filteredRecords.length === 0) {
      return null;
    }

    let profitCount = 0;
    let lossCount = 0;
    let totalProfitR = 0;
    let totalLossR = 0;
    let diffLt10 = 0;
    let diff10to20 = 0;
    let diff20to40 = 0;
    let diffGt40 = 0;
    let maxDrawdown = null;

    filteredRecords.forEach(record => {
      const profit = parseFloat(record.netProfit);
      const R = getRMultiplier(record.utime);
      const rMultiple = profit / R;

      if (profit >= 0) {
        profitCount++;
        totalProfitR += rMultiple;
      } else {
        lossCount++;
        totalLossR += rMultiple;
      }

      // 统计 openPriceDiff 分布
      const diff = parseFloat(record.openPriceDiff);
      if (!isNaN(diff)) {
        if (diff < 10) {
          diffLt10++;
        } else if (diff < 20) {
          diff10to20++;
        } else if (diff < 40) {
          diff20to40++;
        } else {
          diffGt40++;
        }
      }

      // 取各笔手填最大回撤的峰值（按绝对值）
      const dd = parseFloat(record.maxDrawdown);
      if (!Number.isNaN(dd)) {
        const mag = Math.abs(dd);
        if (maxDrawdown == null || mag > maxDrawdown) maxDrawdown = mag;
      }
    });

    const totalCount = filteredRecords.length;
    const winRate = profitCount / totalCount;
    const lossRate = 1 - winRate;
    const avgProfitR = profitCount > 0 ? totalProfitR / profitCount : 0;
    const avgLossR = lossCount > 0 ? Math.abs(totalLossR / lossCount) : 0;
    const expectation = winRate * avgProfitR - lossRate * avgLossR;

    return {
      totalCount,
      profitCount,
      lossCount,
      winRate,
      lossRate,
      avgProfitR,
      avgLossR,
      expectation,
      maxDrawdown,
      diffLt10,
      diff10to20,
      diff20to40,
      diffGt40,
    };
  };

  const systemStatsRows = useMemo(() => {
    return STAT_SYSTEMS.map(system => {
      const stats = calculatePatternStats(system.key);
      const name = `${system.label}（${stats ? stats.totalCount : 0}）`;
      if (!stats) {
        return {
          key: system.key,
          patternKey: system.key,
          name,
          winRate: '-',
          avgPL: '-',
          expectation: '-',
          expectationNum: null,
          maxDrawdown: '-',
          diffLt10: '-',
          diff10to20: '-',
          diff20to40: '-',
          diffGt40: '-',
        };
      }
      const total = stats.diffLt10 + stats.diff10to20 + stats.diff20to40 + stats.diffGt40;
      const pct = n => (total > 0 ? ((n / total) * 100).toFixed(1) : '0');
      return {
        key: system.key,
        patternKey: system.key,
        name,
        winRate: `${(stats.winRate * 100).toFixed(2)}%`,
        avgPL: `${stats.avgProfitR.toFixed(2)}/${stats.avgLossR.toFixed(2)}`,
        expectation: stats.expectation.toFixed(4),
        expectationNum: stats.expectation,
        maxDrawdown:
          stats.maxDrawdown == null ? '-' : Number(stats.maxDrawdown).toFixed(2)+'%',
        diffLt10: `${stats.diffLt10}(${pct(stats.diffLt10)}%)`,
        diff10to20: `${stats.diff10to20}(${pct(stats.diff10to20)}%)`,
        diff20to40: `${stats.diff20to40}(${pct(stats.diff20to40)}%)`,
        diffGt40: `${stats.diffGt40}(${pct(stats.diffGt40)}%)`,
      };
    });
  }, [records, directionFilter]);

  const toggleEntryReasonFilter = reason => {
    setEntryReasonFilter(prev => (prev === reason ? null : reason));
  };

  const systemStatsColumns = [
    {
      title: '系统',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (name, row) => (
        <span
          style={{
            cursor: 'pointer',
            color: '#1890ff',
            borderBottom: '1px dashed #1890ff',
            fontWeight: entryReasonFilter === row.patternKey ? 'bold' : 'normal',
          }}
          title={entryReasonFilter === row.patternKey ? '点击取消筛选' : '点击只展示此类'}
          onClick={() => toggleEntryReasonFilter(row.patternKey)}
        >
          {name}
        </span>
      ),
    },
    {
      title: '胜率',
      dataIndex: 'winRate',
      key: 'winRate',
      width: 72,
      render: v => <span style={{ fontWeight: 'bold', color: '#1890ff' }}>{v}</span>,
    },
    {
      title: '均盈/均亏',
      dataIndex: 'avgPL',
      key: 'avgPL',
      width: 88,
      render: v => <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{v}</span>,
    },
    {
      title: '期望',
      dataIndex: 'expectation',
      key: 'expectation',
      width: 72,
      render: (v, row) =>
        v === '-' ? (
          '-'
        ) : (
          <Tooltip title={expectationTooltip}>
            <span
              style={{
                fontWeight: 'bold',
                color: row.expectationNum >= 0 ? '#52c41a' : '#f5222d',
                borderBottom: '1px dashed currentColor',
                cursor: 'help',
              }}
            >
              {v}
            </span>
          </Tooltip>
        ),
    },
    {
      title: '最大回撤',
      dataIndex: 'maxDrawdown',
      key: 'maxDrawdown',
      width: 72,
      render: v => (
        <span style={{ fontWeight: 'bold', color: v === '-' ? undefined : '#f5222d' }}>{v}</span>
      ),
    },
    {
      title: '开仓最优差<10%',
      dataIndex: 'diffLt10',
      key: 'diffLt10',
      width: 96,
      render: v => <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{v}</span>,
    },
    {
      title: '10-20%',
      dataIndex: 'diff10to20',
      key: 'diff10to20',
      width: 80,
      render: v => <span style={{ fontWeight: 'bold', color: '#13c2c2' }}>{v}</span>,
    },
    {
      title: '20-40%',
      dataIndex: 'diff20to40',
      key: 'diff20to40',
      width: 80,
      render: v => <span style={{ fontWeight: 'bold', color: '#faad14' }}>{v}</span>,
    },
    {
      title: '>40%',
      dataIndex: 'diffGt40',
      key: 'diffGt40',
      width: 80,
      render: v => <span style={{ fontWeight: 'bold', color: '#f5222d' }}>{v}</span>,
    },
  ];

  const columns = [
    {
      title: '平/开仓日期',
      key: 'time',
      width: 120,
      fixed: 'left',
      render: (_, record) => {
        if (record.type === 'summery') {
          return {
            children: (
              <div style={{ whiteSpace: 'pre-wrap', padding: '10px', background: '#f0f0f0' }}>
                {record.content}
              </div>
            ),
            props: { colSpan: 11 },
          };
        }
        return (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {moment(record.utime * 1).format('YYYY-MM-DD')}
            {'\n'}
            {moment(record.ctime * 1).format('YYYY-MM-DD')}
          </div>
        );
      },
    },
    {
      title: '合约',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 80,
      render: (symbol, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <a href={getTradeLink(record)} target="_blank" rel="noopener noreferrer">
            {symbol}
          </a>
        );
      },
    },
    {
      title: '方向',
      dataIndex: 'holdSide',
      key: 'holdSide',
      width: 60,
      render: (side, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <Tag color={side === 'long' ? 'green' : 'red'}>{side === 'long' ? '做多' : '做空'}</Tag>
        );
      },
    },
    {
      title: '开/平仓价值',
      key: 'notional',
      width: 100,
      align: 'right',
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {formatCompactNumber(record.openNotional)}
            {'\n'}
            {formatCompactNumber(record.closeNotional)}
          </div>
        );
      },
    },
    {
      title: '开/平仓价',
      key: 'price',
      width: 100,
      align: 'right',
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {formatCompactNumber(record.openAvgPrice)}
            {'\n'}
            {formatCompactNumber(record.closeAvgPrice)}
          </div>
        );
      },
    },
    {
      title: '开仓最优差',
      key: 'openBestPriceDiff',
      width: 120,
      align: 'right',
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {record.openBestPrice3d != null ? formatCompactNumber(record.openBestPrice3d) : '-'}
            {'\n'}
            {record.openPriceDiff ? (
              <span style={{ color: getDiffColor(record.openPriceDiff) }}>
                {parseFloat(record.openPriceDiff).toFixed(2)}%
              </span>
            ) : (
              '-'
            )}
          </div>
        );
      },
    },
    {
      title: '最大回撤',
      dataIndex: 'maxDrawdown',
      key: 'maxDrawdown',
      width: 88,
      
      render: (val, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        const display =
          val != null && String(val).trim() !== ''
            ? String(val).includes('%')
              ? String(val)
              : `${val}%`
            : undefined;
        return (
          <EditableTextCell
            value={display}
            emptyText="-"
            onCommit={next => {
              // 存纯数字，展示时再加 %
              const cleaned = String(next).replace(/%/g, '').trim();
              setRecords(prev =>
                prev.map(r =>
                  r.positionId === record.positionId ? { ...r, maxDrawdown: cleaned } : r
                )
              );
            }}
          />
        );
      },
    },
    {
      title: '收益率',
      key: 'returnRate',
      width: 80,
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        const openN = parseFloat(record.openNotional);
        const closeN = parseFloat(record.closeNotional);
        if (!openN || Number.isNaN(openN) || Number.isNaN(closeN)) return '-';
        // （开仓价值 - 平仓价值）/ 开仓价值 × 开仓方向
        // 开仓方向：做多 -1、做空 +1，保证顺向盈利为正
        const openDirection = record.holdSide === 'long' ? -1 : 1;
        const returnRate = ((openN - closeN) / openN) * openDirection * 100;
        return (
          <span style={{ color: returnRate >= 0 ? 'green' : 'red' }}>
            {returnRate.toFixed(2)}%
          </span>
        );
      },
    },
    {
      title: '净盈亏(R倍)',
      dataIndex: 'netProfit',
      key: 'netProfit',
      fixed: 'right',
      width: 90,
      render: (profit, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        const R = getRMultiplier(record.utime);
        const rMultiple = parseFloat(profit) / R;
        return (
          <span style={{ color: parseFloat(profit) >= 0 ? 'green' : 'red' }}>
            {rMultiple.toFixed(2)}
          </span>
        );
      },
    },

    {
      title: '入场理由',
      dataIndex: 'entryReason',
      key: 'entryReason',
      width: 150,
      fixed: 'right',
      render: (reason, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        const label = getEntryReasonLabel(reason);
        const isStatSystem = STAT_SYSTEMS.some(s => s.key === reason);
        if (isStatSystem) {
          const active = entryReasonFilter === reason;
          return (
            <span
              style={{
                cursor: 'pointer',
                borderBottom: '1px dashed #1890ff',
                color: '#1890ff',
                fontWeight: active ? 'bold' : 'normal',
                background: active ? 'rgba(24,144,255,0.08)' : undefined,
                padding: active ? '0 2px' : undefined,
              }}
              title={active ? '点击取消筛选' : '点击只展示此类'}
              onClick={() => toggleEntryReasonFilter(reason)}
            >
              {label}
            </span>
          );
        }
        return label;
      },
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      width: 300,
      fixed: 'right',
      render: (text, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <EditableTextCell
            value={text}
            multiline
            emptyText="-"
            onCommit={next => {
              setRecords(prev =>
                prev.map(r => (r.positionId === record.positionId ? { ...r, remark: next } : r))
              );
            }}
          />
        );
      },
    },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const requestParams = {};
      if (Array.isArray(dateRange) && dateRange.length === 2 && dateRange[0] && dateRange[1]) {
        const latestAllowedEnd = moment().subtract(1, 'day').startOf('day').valueOf();
        const safeEndTime = Math.min(dateRange[1].startOf('day').valueOf(), latestAllowedEnd);
        const safeStartTime = Math.min(dateRange[0].startOf('day').valueOf(), safeEndTime);
        requestParams.startTime = safeStartTime.toString();
        requestParams.endTime = safeEndTime.toString();
      }

      const { records: mergedData, stats, errors, fallback } = await fetchAllTradeRecords(
        requestParams
      );
      setRecords(mergedData);

      const parts = Object.entries(stats || {})
        .map(([ex, n]) => `${EXCHANGE_LABEL[ex] || ex} ${n}`)
        .join(' / ');

      if (fallback) {
        message.warning(
          `远程拉取失败，已回退本地 ${mergedData.length} 条${errors?.length ? `（${errors.map(e => e.message).join('; ')}）` : ''}`
        );
      } else if (errors?.length) {
        message.warning(
          `合并 ${mergedData.length} 条（${parts}）；部分失败：${errors.map(e => `${EXCHANGE_LABEL[e.exchange] || e.exchange} ${e.message}`).join('; ')}`
        );
      } else {
        message.success(`合并成功，共 ${mergedData.length} 条（${parts}）`);
      }
    } catch (error) {
      console.warn('TradeRecord fetchData 异常，使用本地数据回退', error);
      setRecords((localRecords || []).filter(r => !r.ignore).map(ensureNotionals));
      message.error(error?.message || '拉取失败，已回退本地数据');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (records.length === 0) {
      message.warning('没有数据可复制');
      return;
    }
    const summaryOrder = ['summeryLatest', 'summeryCurrent'];
    const orderedRecords = [
      ...summaryOrder.map(id => records.find(r => r.positionId === id)).filter(Boolean),
      ...records.filter(r => !summaryOrder.includes(r.positionId)),
    ];
    const text = JSON.stringify(orderedRecords, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        message.success('已复制到剪贴板');
      })
      .catch(() => {
        message.error('复制失败');
      });
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <Card bodyStyle={{ padding: 6, fontSize: 12 }}>
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          fontSize: 12,
        }}
      >
        <Radio.Group
          value={directionFilter}
          onChange={e => setDirectionFilter(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          size="small"
          style={{ marginRight: 0 }}
        >
          <Radio.Button value="all">全部</Radio.Button>
          <Radio.Button value="long">做多</Radio.Button>
          <Radio.Button value="short">做空</Radio.Button>
        </Radio.Group>
        <RangePicker value={dateRange} onChange={setDateRange} size="small" />
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={fetchData}
          loading={loading}
          size="small"
        >
          查询合并
        </Button>
        <Button icon={<CopyOutlined />} onClick={handleCopy} size="small">
          复制数据
        </Button>
        <Checkbox
          checked={onlyHighlight}
          onChange={e => {
            setOnlyHighlight(e.target.checked);
          }}
        >
          只展示标杆
        </Checkbox>
        <Checkbox
          checked={onlyTrades}
          onChange={e => {
            setOnlyTrades(e.target.checked);
          }}
        >
          只展示成交记录
        </Checkbox>
      </div>

      {/* 系统统计 */}
      <Table
        columns={systemStatsColumns}
        dataSource={systemStatsRows}
        pagination={false}
        size="small"
        style={{ marginBottom: 8, fontSize: 12, width: 'max-content', maxWidth: '100%' }}
        className="trade-record-table trade-record-stats-table"
        rowKey="key"
      />

      <Table
        columns={columns}
        dataSource={recordsToDisplay}
        loading={loading}
        size="small"
        style={{ fontSize: 12 }}
        className="trade-record-table"
        rowKey={record => record.positionId}
        pagination={{
          pageSize: 100,
          current: currentPage,
          onChange: page => setCurrentPage(page),
          showTotal: total => `共 ${total} 条记录`,
          size: 'small',
        }}
        scroll={{ x: 'max-content' }}
      />
      <style>{`
        .trade-record-table,
        .trade-record-table .ant-table,
        .trade-record-table .ant-table-thead > tr > th,
        .trade-record-table .ant-table-tbody > tr > td,
        .trade-record-table .ant-pagination {
          font-size: 12px !important;
        }
        .trade-record-stats-table .ant-table-thead > tr > th,
        .trade-record-stats-table .ant-table-tbody > tr > td {
          padding: 2px 6px !important;
          white-space: nowrap;
        }
        .trade-record-stats-table .ant-table-container table {
          width: max-content !important;
        }
      `}</style>
    </Card>
  );
};

export default TradeRecord;
