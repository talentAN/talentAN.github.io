import React, { useState, useEffect } from 'react';
import { Card, Table, Button, message, DatePicker, Tag } from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import { authenticatedRequest } from '../../../container/bitget/utils/auth';
import { enrichRecordsWithBestPrices } from '../../../container/bitget/utils/record';
import localRecords from '../../../../contract-record/all.json';
import moment from 'moment';

const { RangePicker } = DatePicker;

const TradeRecord = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState([moment().subtract(30, 'days'), moment()]);

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

  const columns = [
    {
      title: '开仓时间',
      dataIndex: 'ctime',
      key: 'ctime',
      width: 120,
      fixed: 'left',
      render: (time, record) => {
        if (record.type === 'summery') {
          return {
            children: (
              <div style={{ whiteSpace: 'pre-wrap', padding: '10px', background: '#f0f0f0' }}>
                {record.content}
              </div>
            ),
            props: { colSpan: 17 },
          };
        }
        return moment(time * 1).format('YYYY-MM-DD');
      },
    },
    {
      title: '合约',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 100,
      render: (_, record) => (record.type === 'summery' ? { props: { colSpan: 0 } } : _),
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
      width: 60,
      render: (lev, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return lev ? `${lev}x` : '-';
      },
    },
    {
      title: '开仓价',
      dataIndex: 'openAvgPrice',
      key: 'openAvgPrice',
      width: 90,
      render: (price, record) =>
        record.type === 'summery' ? { props: { colSpan: 0 } } : parseFloat(price).toFixed(4),
    },
    {
      title: '3日开仓最优',
      dataIndex: 'openBestPrice3d',
      key: 'openBestPrice3d',
      width: 120,
      render: (price, record) =>
        record.type === 'summery'
          ? { props: { colSpan: 0 } }
          : price
            ? parseFloat(price).toFixed(4)
            : '-',
    },
    {
      title: '开仓最优差',
      dataIndex: 'openPriceDiff',
      key: 'openPriceDiff',
      width: 100,
      render: (diff, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return diff ? (
          <span style={{ color: getDiffColor(diff) }}>{parseFloat(diff).toFixed(2)}%</span>
        ) : (
          '-'
        );
      },
    },
    {
      title: '平仓时间',
      dataIndex: 'utime',
      key: 'utime',
      width: 120,
      render: (time, record) =>
        record.type === 'summery'
          ? { props: { colSpan: 0 } }
          : moment(time * 1).format('YYYY-MM-DD'),
    },
    {
      title: '平仓价',
      dataIndex: 'closeAvgPrice',
      key: 'closeAvgPrice',
      width: 90,
      render: (price, record) =>
        record.type === 'summery' ? { props: { colSpan: 0 } } : parseFloat(price).toFixed(4),
    },
    {
      title: '3日平仓最优',
      dataIndex: 'closeBestPrice3d',
      key: 'closeBestPrice3d',
      width: 120,
      render: (price, record) =>
        record.type === 'summery'
          ? { props: { colSpan: 0 } }
          : price
            ? parseFloat(price).toFixed(4)
            : '-',
    },
    {
      title: '平仓最优差',
      dataIndex: 'closePriceDiff',
      key: 'closePriceDiff',
      width: 100,
      render: (diff, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return diff ? (
          <span style={{ color: getDiffColor(diff) }}>{parseFloat(diff).toFixed(2)}%</span>
        ) : (
          '-'
        );
      },
    },
    {
      title: '净盈亏',
      dataIndex: 'netProfit',
      key: 'netProfit',
      width: 90,
      render: (profit, record) => {
        if (record.type === 'summery') return { props: { colSpan: 0 } };
        return (
          <span style={{ color: parseFloat(profit) >= 0 ? 'green' : 'red' }}>
            {parseFloat(profit).toFixed(4)}
          </span>
        );
      },
    },
    {
      title: '收益比',
      dataIndex: 'profitRate',
      key: 'profitRate',
      width: 80,
      fixed: 'right',
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
      title: '入场理由',
      dataIndex: 'entryReason',
      key: 'entryReason',
      width: 120,
      fixed: 'right',
      render: (_, record) => (record.type === 'summery' ? { props: { colSpan: 0 } } : '-'),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      width: 300,
      fixed: 'right',
      render: (text, record) =>
        record.type === 'summery' ? { props: { colSpan: 0 } } : text || '-',
    },
  ];

  const fetchData = async () => {
    setLoading(true);
    try {
      const localData = localRecords || [];
      console.log(`本地数据: ${localData.length} 条`);

      const response = await authenticatedRequest('GET', '/api/v2/mix/position/history-position', {
        startTime: dateRange[0].valueOf().toString(),
        endTime: dateRange[1].valueOf().toString(),
      });

      if (response.code !== '00000') {
        message.error(`API 错误: ${response.msg}`);
        return;
      }

      const remoteList = response.data?.list || [];
      console.log(`远程数据: ${remoteList.length} 条`);

      const enrichedRemote = await enrichRecordsWithBestPrices(remoteList);

      const localMap = new Map(localData.map(r => [r.positionId, r]));
      const mergedData = [];

      enrichedRemote.forEach(remote => {
        if (localMap.has(remote.positionId)) {
          const local = localMap.get(remote.positionId);
          mergedData.push({
            ...local,
            openBestPrice3d: remote.openBestPrice3d,
            openPriceDiff: remote.openPriceDiff,
            closeBestPrice3d: remote.closeBestPrice3d,
            closePriceDiff: remote.closePriceDiff,
          });
          localMap.delete(remote.positionId);
        } else {
          mergedData.push(remote);
        }
      });

      localMap.forEach(local => mergedData.push(local));

      setRecords(mergedData);
      message.success(`合并成功，共 ${mergedData.length} 条记录`);
    } catch (error) {
      message.error('获取失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (records.length === 0) {
      message.warning('没有数据可复制');
      return;
    }
    const text = JSON.stringify(records, null, 2);
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
    <Card>
      <div style={{ marginBottom: 16 }}>
        <RangePicker value={dateRange} onChange={setDateRange} style={{ marginRight: 8 }} />
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={fetchData}
          loading={loading}
          style={{ marginRight: 8 }}
        >
          查询合并
        </Button>
        <Button icon={<CopyOutlined />} onClick={handleCopy}>
          复制数据
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={records}
        loading={loading}
        rowKey={record => record.positionId}
        pagination={{ pageSize: 100 }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
};

export default TradeRecord;
