import React, { useState } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Button, 
  Typography
} from 'antd';
import { 
  ReloadOutlined,
} from '@ant-design/icons';
import StableTable from '../../../container/bitget/components/stable';
import BurstTable from '../../../container/bitget/components/burst';
import StableRiseTable from '../../../container/bitget/components/stable-rise';
import { getTradingPairs, getSpotTradingPairs } from '../../../container/bitget/api';

const { Title, Text } = Typography;

const BitgetMonitor = () => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [spotTradingPairs, setSpotTradingPairs] = useState([]);
  const [mode, _setMode] = useState('stable');

  const setMode = v => {
    localStorage.setItem('mode', v);
    _setMode(v);
  };

  const refresh = () => {
    getTradingPairs().then(res => {
      setTradingPairs(res);
    });
    getSpotTradingPairs().then(res => {
      setSpotTradingPairs(res);
    });
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col span={3}>
            <Button 
              type={mode === 'stable' ? "primary" : ''}
              onClick={() => setMode('stable')}
            >
              stable
            </Button>
          </Col>
          <Col span={3}>
            <Button 
              type={mode === 'burst' ? "primary" : ''}
              onClick={() => setMode('burst')}
            >
              burst
            </Button>
          </Col>
          <Col span={3}>
            <Button 
              type={mode === 'stable-rise' ? "primary" : ''}
              onClick={() => setMode('stable-rise')}
            >
              stable-rise
            </Button>
          </Col>
          <Col span={3}>
            <Button 
              type="primary" 
              icon={<ReloadOutlined />} 
              onClick={refresh}
            >
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      <Card title="Bitget 合约交易对列表">
        {mode === 'stable' ? <StableTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs} /> : null}
        {mode === 'burst' ? <BurstTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs} /> : null}
        {mode === 'stable-rise' ? <StableRiseTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs} /> : null}
      </Card>
    </div>
  );
};

export default BitgetMonitor;
