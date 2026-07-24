import React, { useState, useEffect, useMemo } from 'react';
import { Card, Table, Button, Checkbox, message, DatePicker, Tag, Radio, Tooltip } from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { authenticatedRequest } from '../../../container/bitget/utils/auth';
import { enrichRecordsWithBestPrices } from '../../../container/bitget/utils/record';
import localRecords from '@root/contract-record/all.json';
import { PATTERN_Array } from '@root/src/consts';
import moment from 'moment';

const { RangePicker } = DatePicker;

const TradeRecord = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState(null);
  const [onlyHighlight, setOnlyHighlight] = useState(false);
  const [onlyBurstVolume, setOnlyBurstVolume] = useState(false);
  const [onlyTrades, setOnlyTrades] = useState(true);
  const [directionFilter, setDirectionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => setCurrentPage(1), [directionFilter, onlyHighlight, onlyBurstVolume, onlyTrades]);

  const recordsToDisplay = useMemo(() => {
    let temp =
      directionFilter === 'all' ? records : records.filter(r => r.holdSide === directionFilter);
    if (onlyHighlight) {
      temp = temp.filter(r => r.tags?.includes?.('highlight'));
    }
    if (onlyBurstVolume) {
      temp = temp.filter(r => r.entryReason === 'high_volume_breakout_shrink_stall');
    }
    if (onlyTrades) {
      temp = temp.filter(r => r.type !== 'summery');
    }
    return temp;
  }, [records, directionFilter, onlyHighlight, onlyBurstVolume, onlyTrades]);

  const getDiffColor = diff => {
    if (!diff) return undefined;
    if (diff < 15) return 'green';
    if (diff < 30) return 'orange';
    return 'red';
  };

  const getProfitRateColor = rate => {
    if (rate > 0) return 'green';
    if (rate >= -50) return 'orange';
    return 'red';
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
      diffLt10,
      diff10to20,
      diff20to40,
      diffGt40,
    };
  };

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
            props: { colSpan: 14 },
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
          <a
            href={`https://www.bitget.com/zh-CN/futures/usdt/${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
          >
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
      title: '数量',
      dataIndex: 'openTotalPos',
      key: 'openTotalPos',
      width: 80,
      render: (_, record) => (record.type === 'summery' ? { props: { colSpan: 0 } } : _),
    },
    {
      title: '杠杆',
      dataIndex: 'leverage',
      key: 'leverage',
      width: 80,
      render: (lev, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return lev ? `${lev}x` : '-';
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
            {parseFloat(record.openAvgPrice).toFixed(4)}
            {'\n'}
            {parseFloat(record.closeAvgPrice).toFixed(4)}
          </div>
        );
      },
    },
    {
      title: '开仓最优价/最优差',
      key: 'openBestPriceDiff',
      width: 120,
      align: 'right',
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {record.openBestPrice3d ? parseFloat(record.openBestPrice3d).toFixed(4) : '-'}
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
      title: '收益比',
      dataIndex: 'profitRate',
      key: 'profitRate',
      width: 80,
      render: (_, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        const openPrice = parseFloat(record.openAvgPrice);
        const closePrice = parseFloat(record.closeAvgPrice);
        const direction = record.holdSide === 'long' ? 1 : -1;
        const profitRate =
          ((closePrice - openPrice) / openPrice) * direction * (record.leverage || 3) * 100;
        return (
          <span style={{ color: getProfitRateColor(profitRate) }}>{profitRate.toFixed(2)}%</span>
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
        if (reason === 'high_volume_breakout_shrink_stall') {
          return (
            <span
              style={{ cursor: 'pointer', borderBottom: '1px dashed #1890ff', color: '#1890ff' }}
              onClick={() => {
                const filtered = records.filter(
                  r => r.type !== 'summery' && r.entryReason === 'high_volume_breakout_shrink_stall'
                );
                navigator.clipboard
                  .writeText(JSON.stringify(filtered, null, 2))
                  .then(() => message.success(`已复制 ${filtered.length} 条记录`))
                  .catch(() => message.error('复制失败'));
              }}
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
        const content = text || '-';
        return (
          <Tooltip
            title={<div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>}
            placement="topLeft"
            overlayStyle={{ background: '#fff', color: '#000' }}
          >
            <div
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
              }}
            >
              {content}
            </div>
          </Tooltip>
        );
      },
    },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const localData = (localRecords || []).filter(r => !r.ignore);
      console.log(`本地数据: ${localData.length} 条`);

      const requestParams = {};
      if (Array.isArray(dateRange) && dateRange.length === 2 && dateRange[0] && dateRange[1]) {
        const latestAllowedEnd = moment().subtract(1, 'day').startOf('day').valueOf();
        const safeEndTime = Math.min(dateRange[1].startOf('day').valueOf(), latestAllowedEnd);
        const safeStartTime = Math.min(dateRange[0].startOf('day').valueOf(), safeEndTime);
        requestParams.startTime = safeStartTime.toString();
        requestParams.endTime = safeEndTime.toString();
      }

      let response = null;
      try {
        response = await authenticatedRequest(
          'GET',
          '/api/v2/mix/position/history-position',
          requestParams
        );
      } catch (remoteError) {
        console.warn('Bitget history-position 请求失败，使用本地数据回退', remoteError);
        setRecords(localData);
        return;
      }

      if (response?.code !== '00000') {
        console.warn('Bitget history-position API 返回错误，使用本地数据回退', response);
        setRecords(localData);
        return;
      }

      const remoteList = response.data?.list || [];
      console.log(`远程数据: ${remoteList.length} 条`);

      const enrichedRemote = await enrichRecordsWithBestPrices(remoteList);

      const localMap = new Map(localData.map(r => [r.positionId, r]));
      const remoteMap = new Map(enrichedRemote.map(r => [r.positionId, r]));
      const mergedData = [];

      // 第一步：加入 enrichedRemote 中不在 localMap 里的新数据（优先展示在前面）
      enrichedRemote.forEach(remote => {
        if (!localMap.has(remote.positionId)) {
          mergedData.push({
            ...remote,
            entryReason: remote.entryReason || '',
            remark: remote.remark || '',
          });
        }
      });

      // 第二步：按 localData 的原始顺序遍历，如果 enrichedRemote 有对应数据就替换，否则保持原样
      localData.forEach(local => {
        if (remoteMap.has(local.positionId)) {
          const remote = remoteMap.get(local.positionId);
          mergedData.push({
            ...local,
            openBestPrice3d: remote.openBestPrice3d,
            openPriceDiff: remote.openPriceDiff,
            closeBestPrice3d: remote.closeBestPrice3d,
            closePriceDiff: remote.closePriceDiff,
          });
        } else {
          mergedData.push(local);
        }
      });

      setRecords(mergedData);
      message.success(`合并成功，共 ${mergedData.length} 条记录`);
    } catch (error) {
      console.warn('TradeRecord fetchData 异常，使用本地数据回退', error);
      setRecords((localRecords || []).filter(r => !r.ignore));
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
    <Card bodyStyle={{ padding: 6 }}>
      <div
        style={{
          marginBottom: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
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
          style={{ fontSize: 12 }}
        >
          只展示标杆
        </Checkbox>
        <Checkbox
          checked={onlyBurstVolume}
          onChange={e => {
            setOnlyBurstVolume(e.target.checked);
          }}
          style={{ fontSize: 12 }}
        >
          只展示放量冲关缩量滞涨
        </Checkbox>
        <Checkbox
          checked={onlyTrades}
          onChange={e => {
            setOnlyTrades(e.target.checked);
          }}
          style={{ fontSize: 12 }}
        >
          只展示成交记录
        </Checkbox>
      </div>

      {/* 统计信息 */}
      {(() => {
        const stats = calculatePatternStats('high_volume_breakout_shrink_stall');
        if (!stats) return null;

        const total = stats.diffLt10 + stats.diff10to20 + stats.diff20to40 + stats.diffGt40;
        const pct10 = total > 0 ? ((stats.diffLt10 / total) * 100).toFixed(1) : 0;
        const pct20 = total > 0 ? ((stats.diff10to20 / total) * 100).toFixed(1) : 0;
        const pct40 = total > 0 ? ((stats.diff20to40 / total) * 100).toFixed(1) : 0;
        const pctGt = total > 0 ? ((stats.diffGt40 / total) * 100).toFixed(1) : 0;

        const items = [
          { label: '胜率', value: `${(stats.winRate * 100).toFixed(2)}%`, color: '#1890ff' },
          {
            label: '均盈/均亏',
            value: `${stats.avgProfitR.toFixed(2)}/${stats.avgLossR.toFixed(2)}`,
            color: '#52c41a',
          },
          {
            label: '期望',
            value: stats.expectation.toFixed(4),
            color: '#52c41a',
            isExpectation: true,
          },
          { label: '开仓最优差<10%', value: `${stats.diffLt10}(${pct10}%)`, color: '#52c41a' },
          { label: '开仓最优差10-20%', value: `${stats.diff10to20}(${pct20}%)`, color: '#13c2c2' },
          { label: '开仓最优差20-40%', value: `${stats.diff20to40}(${pct40}%)`, color: '#faad14' },
          { label: '开仓最优差>40%', value: `${stats.diffGt40}(${pctGt}%)`, color: '#f5222d' },
        ];

        return (
          <div style={{ marginBottom: 0, fontSize: 12 }}>
            放量冲关缩量滞涨(1-30)
            {/* 标题行 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gap: 4,
                color: '#666',
                marginBottom: 0,
              }}
            >
              {items.map((item, idx) => (
                <div key={idx}>{item.label}</div>
              ))}
            </div>
            {/* 数据行 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
              {items.map((item, idx) => {
                if (item.isExpectation) {
                  return (
                    <Tooltip
                      key={idx}
                      title={
                        <div style={{ fontSize: 12, lineHeight: '1.8' }}>
                          <div style={{ marginBottom: 2, fontWeight: 'bold', color: '#fff' }}>
                            期望值 = 胜率×均盈R − 败率×均亏R
                          </div>
                          <div
                            style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 4 }}
                          >
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
                      }
                    >
                      <span
                        style={{
                          fontWeight: 'bold',
                          color: stats.expectation >= 0 ? '#52c41a' : '#f5222d',
                          borderBottom: '1px dashed currentColor',
                          cursor: 'help',
                        }}
                      >
                        {item.value}
                      </span>
                    </Tooltip>
                  );
                }

                return (
                  <div key={idx} style={{ fontWeight: 'bold', color: item.color }}>
                    {item.value}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <Table
        columns={columns}
        dataSource={recordsToDisplay}
        loading={loading}
        size="small"
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
    </Card>
  );
};

export default TradeRecord;
