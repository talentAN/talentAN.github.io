import React from 'react';
import { Operation } from '../column';
import { useRiseToFallLine } from '../../hooks/rise-to-fall';
import { Table, Typography, Tag } from 'antd';

const { Text } = Typography;

const RiseToFallTable = ({ futureSymbols }) => {
  const { symbols, checkedSymbolCount, volumeSpikeData } = useRiseToFallLine({
    futureSymbols,
  });

  // 格式化成交量为 K、M 单位
  const formatVolume = volume => {
    const num = parseFloat(volume);
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    }
    return num.toString();
  };

  return (
    <>
      <div>{`共${futureSymbols?.length}，已查看${checkedSymbolCount}，已筛选${symbols.length}`}</div>
      <Table
        columns={[
          {
            title: '币对',
            dataIndex: 'symbol',
            key: 'symbol',
            width: '10%',
          },
          {
            title: '最新价格',
            dataIndex: 'currentPrice',
            key: 'currentPrice',
            width: '10%',
            render: text => <Text strong>{text}</Text>,
          },
          {
            title: '昨日成交量',
            dataIndex: 'yesterdayVolume',
            key: 'yesterdayVolume',
            width: '12%',
            render: volume => formatVolume(volume),
          },
          {
            title: '爆炸成交量',
            dataIndex: 'spikeVolume',
            key: 'spikeVolume',
            width: '12%',
            render: volume => formatVolume(volume),
          },
          {
            title: '过去20天平均',
            dataIndex: 'avgVolume',
            key: 'avgVolume',
            width: '12%',
            render: volume => formatVolume(volume),
          },
          {
            title: '倍数',
            dataIndex: 'ratio',
            key: 'ratio',
            width: '10%',
            render: ratio => <Tag color="green">{ratio}x</Tag>,
          },
          {
            title: '操作',
            key: 'action',
            width: '18%',
            render: (_, record) => <Operation record={record} />,
          },
        ]}
        dataSource={volumeSpikeData.map((item, index) => ({
          ...item,
          key: index,
        }))}
        pagination={{ pageSize: 20 }}
        locale={{
          emptyText:
            checkedSymbolCount < futureSymbols?.length ? '检查中...' : '暂无符合条件的币对',
        }}
      />
    </>
  );
};

export default RiseToFallTable;
