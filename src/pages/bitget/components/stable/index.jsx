import React, { useMemo } from 'react';
import { 
  Table, 
  Typography
} from 'antd';
import {Operation} from '../column'
import {useStableLine} from '../../hooks/stable-type'

const {  Text } = Typography;

const StableTable = ({futureSymbols,spotSymbols}) => {
    const  {
      stablePairs:stableFutureSymbols,
      checkedSymbolCount:checkedFutureSymbolCount
    } = useStableLine({
      symbols: futureSymbols,
      type: 'future'
    })
    const  {
      stablePairs:stableSpotSymbols,
      checkedSymbolCount:checkedSpotSymbolCount
    } = useStableLine({
      symbols: spotSymbols,
      type: 'spot'
    })
  const data = useMemo(()=>{
    const ret = stableFutureSymbols.map(f=>({
      ...f,
      isFutureOneWeekStable: f.isOneWeekStable,
      isFutureOneMonStable:f.isOneMonStable

    }));
    stableSpotSymbols.forEach(item=>{
      const target = ret.find(r=>r.symbol === item.symbol);
      if(target){
        target.isSpotOneWeekStable = item.isOneWeekStable
        target.isSpotOneMonStable = item.isOneWeekStable
      }else{
        ret.push({...item,
          isSpotOneWeekStable: item.isOneWeekStable,
          isSpotOneMonStable:item.isOneMonStable
        })
      }
    })
    return ret;
  },[stableSpotSymbols,stableFutureSymbols])
  // 表格列定义
  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '现货一周稳定',
      dataIndex: 'isSpotOneWeekStable',
      key: 'isSpotOneWeekStable',
      render: (text) => <Text strong>{text ? '✅':''}</Text>
    },
    {
      title: '现货30日稳定',
      dataIndex: 'isSpotOneMonStable',
      key: 'isSpotOneMonStable',
      render: (text) => <Text strong>{text ? '✅':''}</Text>
    },
    {
      title: '合约一周稳定',
      dataIndex: 'isFutureOneWeekStable',
      key: 'isFutureOneWeekStable',
      render: (text) => <Text strong>{text ? '✅':''}</Text>
    },
    {
      title: '合约30日稳定',
      dataIndex: 'isFutureOneMonStable',
      key: 'isFutureOneMonStable',
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
    <div>{`合约共${futureSymbols.length}，已查看${checkedFutureSymbolCount}，已筛选${stableFutureSymbols.length}`}</div>
    <div>{`现货共${spotSymbols.length}，已查看${checkedSpotSymbolCount}，已筛选${stableSpotSymbols.length}`}</div>
      <Table
              columns={columns}
              dataSource={data}
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