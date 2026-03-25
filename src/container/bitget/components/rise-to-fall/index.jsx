import React from 'react';
import { Operation } from '../column';
import { useRiseToFallLine } from '../../hooks/rise-to-fall';
import { Table, Typography } from 'antd';

const { Text } = Typography;

const RiseToFallTable = ({ futureSymbols }) => {
  const { symbols, checkedSymbolCount } = useRiseToFallLine({
    futureSymbols,
  });

  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '当前价格',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '阻力位(前80日最高)',
      dataIndex: 'resistancePrice',
      key: 'resistancePrice',
      render: text => <Text strong>{text}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => <Operation record={record} />,
    },
  ];

  return (
    <>
      <div>{`共${futureSymbols?.length}，已查看${checkedSymbolCount}，已筛选${symbols.length}`}</div>
      <Table
        columns={columns}
        dataSource={symbols}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: total => `共 ${total} 个交易对`,
        }}
        scroll={{ x: 800 }}
      />
    </>
  );
};

export default RiseToFallTable;
