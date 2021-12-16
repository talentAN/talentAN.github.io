import React from 'react';
import { Row, Col } from 'antd';
import ProgressBar from '../../Progress';
import links from '../../../configs/links'

export const Recommends = ()=>{
  return   <div>
      <h2>推荐</h2>
      {links.map(({key,value})=>{
        return <div style={{marginBottom:'8px'}}><a href={value} target="_blank">{key}</a></div>
      })}
        </div>

}
const SkillsProgress = () => (
  <div  style={{ marginBottom: '36px' }}>
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
