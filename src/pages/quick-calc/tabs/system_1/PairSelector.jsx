import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Button, Typography, Space, Divider, Spin, Collapse } from 'antd';
import { ReloadOutlined, MenuOutlined } from '@ant-design/icons';
import RiseToFallTable from '../../../../container/bitget/components/rise-to-fall';
import { getTradingPairs } from '../../../../container/bitget/api';

const { Title, Text } = Typography;

const PairSelector = () => {
  const [tradingPairs, setTradingPairs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const loadData = () => {
    setLoading(true);
    getTradingPairs()
      .then(res => {
        setTradingPairs(res);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, []);

  const detailsContent = (
    <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 4 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Text strong>策略：高点缩量横盘</Text>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text strong>筛选条件：</Text>
          <ul>
            <li>价格处于近80日阻力位附近（高点）</li>
            <li>成交量缩小（相对于之前的水平）</li>
            <li>价格横盘波动（缺乏明确方向）</li>
          </ul>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text strong>交易逻辑：</Text>
          <ul>
            <li>这种形态表现为上升乏力，可能即将回调</li>
            <li>适合寻找空头机会或止盈点</li>
            <li>需配合其他技术指标确认</li>
          </ul>
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text type="secondary">下方列表展示符合条件的交易对，点击可查看详情</Text>
        </div>
      </Space>
    </div>
  );

  return (
    <Row gutter={16}>
      {showDetails && (
        <Col span={12}>
          <Card>
            <Title level={3}>筛选说明</Title>
            {detailsContent}
          </Card>
        </Col>
      )}
      <Col span={showDetails ? 12 : 24}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Title level={3} style={{ margin: 0 }}>高点缩量横盘币对</Title>
            <Space>
              <Button 
                icon={<MenuOutlined />}
                onClick={() => setShowDetails(!showDetails)}
                title={showDetails ? '隐藏说明' : '显示说明'}
              />
              <Button 
                type="primary" 
                icon={<ReloadOutlined />} 
                onClick={loadData}
                loading={loading}
              >
                刷新
              </Button>
            </Space>
          </div>
          <Spin spinning={loading}>
            {tradingPairs.length > 0 ? (
              <RiseToFallTable futureSymbols={tradingPairs} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="secondary">
                  {loading ? '加载中...' : '点击刷新获取数据'}
                </Text>
              </div>
            )}
          </Spin>
        </Card>
      </Col>
    </Row>
  );
};

export default PairSelector;
