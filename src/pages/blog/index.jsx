import React, { useState, useEffect } from 'react';
import { graphql } from 'gatsby';
import { Layout, Row, Col, Timeline, Radio } from 'antd';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import PostCard from '../../components/PostCard';
import TimeLineItem from '../../components/TimeLineItem';
import SEO from '../../components/Seo';

const blog_list_mode = 'blog_list_mode';

const Blog = ({ data }) => {
  const [mode, setMode] = useState('card');

  useEffect(() => {
    const local_blog_list_mode = window && window.localStorage.getItem(blog_list_mode);
    if (local_blog_list_mode) {
      setMode(local_blog_list_mode);
    }
  }, []);

  const posts = data.allMarkdownRemark.edges.filter(edge => {
    const { tags, path } = edge.node.frontmatter;
    return (
      !tags.some(t => t === '酝酿池') && // 过滤酝酿池的内容
      path.indexOf('blog/past-versions') !== 0 // 过滤历史版本内容
    );
  });

  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <Header />
        <SEO title="追谏" description="追谏博客列表" path="blog" />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <h1 className="titleSeparate">博文</h1>
            <span>视图：</span>
            <Radio.Group
              name="展示方式"
              defaultValue={'card'}
              value={mode}
              onChange={e => {
                if (window) {
                  window.localStorage.setItem(blog_list_mode, e.target.value);
                }
                setMode(e.target.value);
              }}
            >
              <Radio value={'card'}>卡片</Radio>
              <Radio value={'timeline'}>时间轴</Radio>
            </Radio.Group>
          </div>
          {mode === 'card' && (
            <Row gutter={[20, 20]}>
              {posts.map((val, key) => (
                <Col key={key} xs={24} sm={24} md={12} lg={8}>
                  <PostCard data={val} />
                </Col>
              ))}
            </Row>
          )}
          {mode === 'timeline' && (
            <Timeline mode={'left'} style={{ marginTop: '16px' }}>
              {posts.map((val, key) => (
                <TimeLineItem key={key} data={val} />
              ))}
            </Timeline>
          )}
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export const query = graphql`
  {
    allMarkdownRemark(
      sort: { frontmatter: { date: DESC } }
      filter: { fileAbsolutePath: { regex: "/index.md$/" } }
    ) {
      edges {
        node {
          frontmatter {
            date
            path
            title
            tags
            excerpt
            hot
            recommended
            isTranslated
            totalCount
            cover {
              childImageSharp {
                fluid(maxWidth: 288) {
                  ...GatsbyImageSharpFluid_tracedSVG
                }
              }
            }
          }
        }
      }
    }
  }
`;

export default Blog;
