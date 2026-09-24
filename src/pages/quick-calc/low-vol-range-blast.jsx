import React from 'react';
import Layout from './index';
import { Card } from 'antd';
import LiveScanner from './tabs/low_vol_range_blast/LiveScanner';

const LowVolRangeBlastPage = ({ location }) => (
  <Layout location={location}>
    <Card bodyStyle={{ padding: '10px 12px 12px' }}>
      <LiveScanner />
    </Card>
  </Layout>
);

export default LowVolRangeBlastPage;