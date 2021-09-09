import React from 'react';
import { Layout } from 'antd';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import SEO from '../../components/Seo';
import HeatChart from './HeatChart';
import { data } from '../../../googleAnalytics/all';

/**
 * 下期：
 * - 支持更多图标
 * - 支持crossfilter联动
 */

/**
 *
 * 我准备弄哪些统计数据呢？
 * - 一个饼状图，看最热博文？
 * - 看累计时长
 * - 几个有趣的指标
 *  - 累计访问量
 *  - 月访问量 => 折线图
 *  - 累计阅读时间
 *  - 最热
 *  - 表太多估计要用到immer
 */
const tables = [
  {
    name: '整体阅读量',
  },
  {
    name: '累计阅读时长',
  },
  {
    name: '每日阅读量',
    dimension: 'date',
    measure: 'count',
  },
  {
    name: '阅读热力图',
    dimension: ['path', 'date'],
    measure: 'count',
    tip: '二维表格，近30天，用颜色表示阅读热度，hover显示具体数量',
  },
  {
    name: '单篇阅读量',
    dimension: '日期',
    measure: '阅读量',
  },
];

const Contact = () => {
  const filteredData = {};
  data.forEach(d => {
    const [path, date, pageViews] = d;
    filteredData[date] = filteredData[date] || 0;
    filteredData[date] += pageViews * 1;
  });

  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <SEO title="统计数据" path="data" />
        <Header />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <h1 className="titleSeparate">统计</h1>
            <HeatChart data={filteredData} />
          </div>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export default Contact;
