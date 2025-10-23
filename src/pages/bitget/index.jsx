import React, { useState } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Table, 
  Button, 
  Tag,
  Typography
} from 'antd';
import { 
  ReloadOutlined,
} from '@ant-design/icons';
import StableTable from '../../container/bitget/components/stable'
import BurstTable from '../../container/bitget/components/burst'
import {getTradingPairs,getSpotTradingPairs} from '../../container/bitget/api'

const { Title, Text } = Typography;

// 按1h涨跌排序，相同则按24h涨跌排序
const sortPair = (pairs)=>{
  pairs.sort((a, b) => {
    if(!b.changePercent1h && !a.changePercent1h){
      return b.changePercent - a.changePercent;
    }
    if(!b.changePercent1h){
      return -1
    }
    if(!a.changePercent1h){
      return 1
    }
    return (b.changePercent1h) - (a.changePercent1h)
  });
  return [...pairs]
}

const BitgetPage = () => {
  const [loading, setLoading] = useState(false);
  // 合约
  const [tradingPairs, setTradingPairs] = useState([]);
  // 现货
  const [spotTradingPairs, setSpotTradingPairs] = useState([]);

  // 模式设置
  const [mode, _setMode] = useState(localStorage?.getItem('mode')||'stable')

  const setMode = v=>{
    localStorage.setItem('mode',v)
    _setMode(v)
  }

  const refresh = ()=>{
    getTradingPairs().then(res=>{
      setTradingPairs(res)
    })
    getSpotTradingPairs().then(res=>{
      setSpotTradingPairs(res)
    })
  }

  // 表格列定义
  const columns = [
    {
      title: '交易对',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text) => <Text strong>{text}</Text>
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      render: (price) => <Text>{`$${price.toFixed(4)}`}</Text> 
    },
    {
      title: '1h涨跌',
      dataIndex: 'changePercent1h',
      key: 'changePercent1h',
      render: (percent) => (
        <Tag 
          color={percent >= 0 ? 'green' : 'red'}
        >
          {percent >= 0 ? '+' : ''}{Number(percent).toFixed(2)}%
        </Tag>
      )
    },
    {
      title: '24h涨跌',
      dataIndex: 'changePercent',
      key: 'changePercent',
      render: (percent) => (
        <Tag 
          color={percent >= 0 ? 'green' : 'red'}
        >
          {percent >= 0 ? '+' : ''}{Number(percent).toFixed(2)}%
        </Tag>
      )
    },
    {
      title: '24h成交量',
      dataIndex: 'volume',
      key: 'volume',
      render: (volume) => `$${(volume / 1000000).toFixed(2)}M`
    },
    {
      title: '24h最高',
      dataIndex: 'high24h',
      key: 'high24h',
      render: (high) => `$${high.toFixed(4)}`
    },
    {
      title: '24h最低',
      dataIndex: 'low24h',
      key: 'low24h',
      render: (low) => `$${low.toFixed(4)}`
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Button 
          type="link" 
          onClick={() => {
            window.open(`https://www.bitget.com/zh-CN/futures/usdt/${record.symbol}`, '_blank');
          }}
        >
          查看图表
        </Button>
      )
    }
  ];
 
  return (
    <div className="bitget-page">
      <div className="page-header">
        <Title level={2}>Web3 币对数据监控</Title>
        <Text type="secondary">实时监控多个交易所的加密货币交易数据</Text>
      </div>

      {/* 控制面板 */}
      <Card className="control-panel" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col span={3}>
            <Button 
              type={"primary"}
              onClick={()=>setMode('stable')}
            >
              stable
            </Button>
          </Col>
          <Col span={3}>
            <Button 
              onClick={()=>setMode('burst')}
            >
              burst
            </Button>
          </Col>
          <Col span={3}>
            <Button 
              type="primary" 
              icon={<ReloadOutlined />} 
              onClick={refresh}
              loading={loading}
            >
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>
        <Card title="Bitget 合约交易对列表">
          {mode === 'stable' ? <StableTable  futureSymbols={tradingPairs} spotSymbols={spotTradingPairs}/>:null}
          {mode === 'burst' ? <BurstTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs}/>:null}
          {mode === 'default' ?   <Table
            columns={columns}
            dataSource={tradingPairs}
            loading={loading}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 个交易对`
            }}
            scroll={{ x: 800 }}
          />:null}
        
      </Card>
    </div>
  );
};

export default BitgetPage;