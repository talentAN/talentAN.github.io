import React, { useState } from 'react';
import { Card, Row, Col, Button, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import StableTable from '../../../container/bitget/components/stable';
import BurstTable from '../../../container/bitget/components/burst';
import StableRiseTable from '../../../container/bitget/components/stable-rise';
import RiseToFallTable from '../../../container/bitget/components/rise-to-fall';
import { getTradingPairs, getSpotTradingPairs } from '../../../container/bitget/api';
import { PATTERN } from '@root/src/consts';

const BitgetMonitor = ({ mode: externalMode }) => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [spotTradingPairs, setSpotTradingPairs] = useState([]);
  const [mode, _setMode] = useState(externalMode || 'stable');

  React.useEffect(() => {
    if (externalMode) {
      _setMode(externalMode);
      refresh();
    }
  }, [externalMode]);

  const setMode = v => {
    localStorage.setItem('mode', v);
    _setMode(v);
  };

  const refresh = () => {
    getTradingPairs().then(res => {
      setTradingPairs(res);
    });
    if (mode === 'stable-rise') {
      getSpotTradingPairs().then(res => {
        setSpotTradingPairs(res);
      });
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col span={3}>
            <Button
              block
              type={mode === PATTERN.LONG_STABLE ? 'primary' : ''}
              onClick={() => setMode(PATTERN.LONG_STABLE)}
            >
              低波动横盘
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={mode === PATTERN.SWITCH_TO_DECREASE ? 'primary' : ''}
              onClick={() => setMode(PATTERN.SWITCH_TO_DECREASE)}
            >
              高点缩量横盘
            </Button>
          </Col>
          <Col span={3}>
            <Button block type={mode === 'burst' ? 'primary' : ''} onClick={() => setMode('burst')}>
              burst
            </Button>
          </Col>
          <Col span={3}>
            <Button
              block
              type={mode === 'stable-rise' ? 'primary' : ''}
              onClick={() => setMode('stable-rise')}
            >
              stable-rise
            </Button>
          </Col>
          <Col span={3}>
            <Button block type="primary" icon={<ReloadOutlined />} onClick={refresh}>
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      <Card title="Bitget 合约交易对列表">
        {mode === PATTERN.LONG_STABLE ? <StableTable futureSymbols={tradingPairs} /> : null}
        {mode === PATTERN.SWITCH_TO_DECREASE ? (
          <RiseToFallTable futureSymbols={tradingPairs} />
        ) : null}
        {mode === 'burst' ? <BurstTable futureSymbols={tradingPairs} /> : null}
        {mode === 'stable-rise' ? (
          <StableRiseTable futureSymbols={tradingPairs} spotSymbols={spotTradingPairs} />
        ) : null}
      </Card>
    </div>
  );
};

export default BitgetMonitor;
