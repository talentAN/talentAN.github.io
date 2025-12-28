import React,{ useState}  from 'react';
import {Operation} from '../column'
import {useStableRiseLine} from '../../hooks/stable-rise'
import { 
  Table, 
  Typography,
  InputNumber
} from 'antd';

const {  Text } = Typography;

const StableRiseTable = ({futureSymbols}) => {
  const [period, setPeriod] = useState(3)
  const [risePencent, setRisePencent] = useState(300)
    const {
      symbols,
      checkedSymbolCount
    } = useStableRiseLine({
      futureSymbols,
      risePencent,
      period
    })
  // 表格列定义
  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '当前价格',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '最低价',
      dataIndex: 'bottomPrice',
      key: 'bottomPrice',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '最高价',
      dataIndex: 'topPrice',
      key: 'topPrice',
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
    <div>
      周期
    <InputNumber value={period} onChange={e=>setPeriod(e)} />
    天
    </div>
    <div>
      累计涨幅
    <InputNumber value={risePencent} onChange={e=>setRisePencent(e)} />
    %
    </div>
    <div>{`共${futureSymbols?.length}，已查看${checkedSymbolCount}，已筛选${symbols.length}`}</div>
      <Table
              columns={columns}
              dataSource={symbols}
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

export default StableRiseTable;