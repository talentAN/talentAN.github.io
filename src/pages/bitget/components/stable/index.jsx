import React from 'react';
import { 
  Table, 
  Typography
} from 'antd';
import {Operation} from '../column'
import {useStableLine} from '../../hooks/stable-type'

const {  Text } = Typography;

const StableTable = ({tradingPairs}) => {
    const  {
      stablePairs,
      checkedSymbolCount
    } = useStableLine(tradingPairs)
  // 表格列定义
  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '7日稳定',
      dataIndex: 'isOneWeekStable',
      key: 'isOneWeekStable',
      render: (text) => <Text strong>{text ? '✅':''}</Text>
    },
    {
      title: '30日稳定',
      dataIndex: 'isOneMonkStable',
      key: 'isOneMonkStable',
      render: (text) => <Text strong>{text ? '✅':''}</Text>
    },
    {
      title: '7日平均成交额',
      dataIndex: 'avsTradingValueLast7Days',
      key: 'avsTradingValueLast7Days',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => <Operation record={record}/> 
    }
  ];

  

  return (
    <>
    <div>{`共${tradingPairs.length}，已查看${checkedSymbolCount}，已筛选${stablePairs.length}`}</div>
      <Table
              columns={columns}
              dataSource={stablePairs}
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 个交易对`
              }}
              scroll={{ x: 800 }}
            />
    </>
  );
};

export default StableTable;