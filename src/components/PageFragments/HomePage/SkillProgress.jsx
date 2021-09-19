import React from 'react';
import { Row, Col } from 'antd';
import ProgressBar from '../../Progress';

const SkillsProgress = () => (
  <div>
    <h2>技能</h2>
    <Row gutter={[20, 20]}>
      <Col xs={24} sm={24} md={12}>
        <ProgressBar percent={91} text="Javascript" />
        <ProgressBar percent={95} text="ReactJS" />
        <ProgressBar percent={89} text="NodeJS" />
      </Col>
      <Col xs={24} sm={24} md={12}>
        <ProgressBar percent={83} text="可视化" />
        <ProgressBar percent={80} text="PostgreSQL" />
        <ProgressBar percent={90} text="大数据分析" />
      </Col>
    </Row>
  </div>
);

export default SkillsProgress;
