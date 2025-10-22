import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Table, 
  Input, 
  Button, 
  Tag,
  Typography
} from 'antd';
import { 
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons';
import StableTable from './components/stable'
import {getTradingPairs} from './api'

const { Search } = Input;
const { Title, Text } = Typography;

// 交易所API配置 - 合约数据
const EXCHANGE_APIS = {
  bitget: {
    name: 'Bitget',
    baseUrl: 'https://api.bitget.com',
    tickerUrl: '/api/v2/mix/market/tickers',
    klineUrl: '/api/v2/mix/market/candles'
  }
  // 可扩展其他交易所配置
  // binance: { ... },
  // okx: { ... }
};

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
  const selectedExchange = 'bitget'; // 固定使用Bitget
  const [tradingPairs, _setTradingPairs] = useState([]);
  const [filteredPairs, setFilteredPairs] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [selectedPair, setSelectedPair] = useState(null);
  const [marketStats, setMarketStats] = useState({});
  const [isConnected, setIsConnected] = useState(false); // 轮询状态
  const [updateInterval, setUpdateInterval] = useState(null); // 轮询定时器

  // 新设置
  const [mode, setMode] = useState('stable')

  const pairRef = useRef([])

  const setTradingPairs = (p)=>{
    _setTradingPairs(p)
    pairRef.current = p
  }

  const refresh = ()=>{
    getTradingPairs().then(res=>{
      setTradingPairs(res)
    })
  }

  // 获取交易对数据
  const fetchTradingPairs = useCallback(async () => {
    setLoading(true);
    try {
      // 处理Bitget数据格式
      let processedPairs = await getTradingPairs()
        .filter(item => item.symbol && item.symbol.endsWith('USDT'))
        .map(item => ({
          key: item.symbol,
          symbol: item.symbol,
          price: parseFloat(item.lastPr || 0),
          change: parseFloat(item.change24h || 0),
          changePercent: parseFloat(item.change24h || 0) * 100,
          volume: parseFloat(item.quoteVolume || 0),
          high24h: parseFloat(item.high24h || 0),
          low24h: parseFloat(item.low24h || 0),
          change1h: 0,
          changePercent1h: 0
        }));

      const sorted = sortPair(processedPairs)

      setTradingPairs(sorted);
      setFilteredPairs(sorted);
      
      // 计算市场统计
      const totalVolume = processedPairs.reduce((sum, pair) => sum + pair.volume, 0);
      const gainers = processedPairs.filter(pair => pair.changePercent > 0).length;
      const losers = processedPairs.filter(pair => pair.changePercent < 0).length;
      
      setMarketStats({
        totalPairs: processedPairs.length,
        totalVolume,
        gainers,
        losers
      });

    } catch (error) {
      console.error('Error fetching trading pairs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedExchange]);

  // 启动轮询更新
  const startPolling = useCallback(() => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
    
    setIsConnected(true);
    const interval = setInterval(() => {
      fetchTradingPairs();
    }, 2*60*1000); // 5秒更新一次
    
    setUpdateInterval(interval);
  }, [updateInterval, fetchTradingPairs]);

  // 停止轮询更新
  const stopPolling = useCallback(() => {
    if (updateInterval) {
      clearInterval(updateInterval);
      setUpdateInterval(null);
    }
    setIsConnected(false);
  }, [updateInterval]);

  // 批量获取1小时前的价格数据
  const fetch1HourData = async () => {
    const pairs = pairRef.current
    try {
      const exchange = EXCHANGE_APIS[selectedExchange];
      const symbols = pairRef.current.map(pair => pair.symbol);
      
      // 分批处理，每批最多10个币对
      const batchSize = 8;
      const batches = [];
      
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        batches.push(batch);
      }
      for(let i=0; i<batches.length; i++){
        setTimeout(async ()=>{
          const batch = batches[i];
          const batchPromises = batch.map(async (symbol) => {
            const response1H = await fetch(`${exchange.baseUrl}/${exchange.klineUrl}?symbol=${symbol}&granularity=1H&limit=2&productType=USDT-FUTURES`);
            const response1Min = await fetch(`${exchange.baseUrl}/${exchange.klineUrl}?symbol=${symbol}&granularity=1m&limit=2&productType=USDT-FUTURES`);
            const klineData1H = await response1H.json();
            const klineData1Min = await response1Min.json();

            return [klineData1H?.data?.[0],klineData1Min?.data?.[0]];
          });
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach((result,i) => {
            const symbol = batch[i]
            const pair = pairs.find(p => p.symbol === symbol);
            if (pair ) {
              const [, , highPrice1H, lowPrice1H] = result?.[0] ??[]
              const [,,highPrice1Min, lowPrice1Min] = result?.[1] ??[]
              const max = Math.max(highPrice1H,highPrice1Min,lowPrice1Min)
              if(lowPrice1H){
                const change1h = max - lowPrice1H
                const changePercent1h = ((max- lowPrice1H) / lowPrice1H) * 100;
                pair.change1h = change1h;
                pair.changePercent1h = changePercent1h;

              }
            }
          });
          setTradingPairs(sortPair(pairs));
        },i * 1000)
      }
    } catch (error) {
      console.error('Error fetching 1h data:', error);
    }
  };
  // 搜索过滤
  const handleSearch = (value) => {
    setSearchText(value);
    const filtered = tradingPairs.filter(pair => 
      pair.symbol.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredPairs(filtered);
  };

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
 
  // 页面加载时获取数据
  useEffect(() => {
    refresh()
  }, []);

  // // 自动启动轮询
  // useEffect(() => {
  //   if (tradingPairs.length > 0 && !isConnected) {
  //     startPolling();
  //   }
  // }, [tradingPairs.length, isConnected, startPolling]);

  // // 页面卸载时清理定时器
  // useEffect(() => {
  //   return () => {
  //     if (updateInterval) {
  //       clearInterval(updateInterval);
  //     }
  //   };
  // }, [updateInterval]);

  // // 获取1小时前的价格数据来计算1h涨跌
  // useEffect(()=>{
  //   fetch1HourData();
  // },[tradingPairs.length])

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
              type={isConnected ? "default" : "primary"}
              onClick={()=>setMode('stable')}
            >
              stable
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
      <Row gutter={16}>
        <Col span={selectedPair ? 14 : 24}>
          <Card title="Bitget 合约交易对列表">
            {mode === 'stable' ? <StableTable tradingPairs={tradingPairs}/>:null}
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
        </Col>
      </Row>
    </div>
  );
};

export default BitgetPage;