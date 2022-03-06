import React from 'react';
import { Layout } from 'antd';

import { Responsive, WidthProvider } from 'react-grid-layout';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import SEO from '../../components/Seo';
import LayoutWrapper from '../../components/LayoutWrapper';
import HeatChart from '../../components/HeatChart';
import NumberChart from '../../components/Charts/Number';
import { WIDTH_MOBILE } from '../../configs/layout';
import { data } from '../../../googleAnalytics/static';
import 'react-grid-layout/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

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
 *
 * - 数据量太大，统计页面加载太慢，先用简单数据吧。crossfilter后面再说
 */
const tables = [
  {
    name: '整体阅读量',
    type: 'number',
  },
  {
    name: '累计阅读时长',
    type: 'number',
  },
  {
    name: '每日阅读量',
    type: 'HeatChart',
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
  const { filteredData, total, total_time } = data;
  const layouts = {
    lg: [
      { i: 'total', x: 0, y: 0, w: 8, h: 3, static: false },
      { i: 'total_time', x: 8, y: 0, w: 8, h: 3, static: false },
      { i: 'total_article', x: 16, y: 0, w: 8, h: 3, static: false },
      { i: 'last_year', x: 0, y: 3, w: 24, h: 5, static: false },
    ],
    sm: [
      { i: 'total', x: 0, y: 0, w: 12, h: 3, static: true },
      { i: 'total_time', x: 0, y: 3, w: 12, h: 3, static: true },
      { i: 'total_article', x: 0, y: 6, w: 12, h: 3, static: true },
      { i: 'last_year', x: 0, y: 9, w: 12, h: 5, static: true },
    ],
  };
  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <SEO title="统计数据" path="data" />
        <Header />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <h1 className="titleSeparate">统计</h1>
          </div>
          <ResponsiveGridLayout
            breakpoints={{ lg: 800, sm: WIDTH_MOBILE }}
            cols={{ lg: 30, sm: 12 }}
            layouts={layouts}
            rowHeight={30}
            isDraggable={true}
            verticalCompact={true}
            margin={[8, 8]}
          >
            <div key="total">
              <LayoutWrapper title="累计访问量">
                <NumberChart data={total} />
              </LayoutWrapper>
            </div>
            <div key="total_time">
              <LayoutWrapper title="累计阅读时长(h)">
                <NumberChart data={total_time / 3600} />
              </LayoutWrapper>
            </div>
            <div key="total_article">
              <LayoutWrapper title="累计文章数">
                <NumberChart data={29} />
              </LayoutWrapper>
            </div>
            <div key="last_year">
              <LayoutWrapper key="last_year" title="近一年访问日期分布">
                <HeatChart data={filteredData} />
              </LayoutWrapper>
            </div>
          </ResponsiveGridLayout>
          <div style={{ visibility: 'hidden', wordBreak: 'break-all' }}>
            临时方案。屏幕宽度渐变RGL会忽然变小，有空看看啥问题
          </div>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export default Contact;
