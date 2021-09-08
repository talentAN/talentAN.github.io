import React from 'react';
import { graphql } from 'gatsby';
import { Layout, Row, Col } from 'antd';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import PostCard from '../../components/PostCard';
import SEO from '../../components/Seo';

const Blog = ({ data }) => {
  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <Header />
        <SEO title="追谏" description="追谏博客列表" path="blog" />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <h1 className="titleSeparate">博文</h1>
          </div>
          <Row gutter={[20, 20]}>
            {data.allMarkdownRemark &&
              data.allMarkdownRemark.edges
                .filter(edge => {
                  const { tags, path } = edge.node.frontmatter;
                  return (
                    !tags.some(t => t === '酝酿池') && // 过滤酝酿池的内容
                    path.indexOf('blog/past-versions') !== 0 // 过滤历史版本内容
                  );
                })
                .map((val, key) => (
                  <Col key={key} xs={24} sm={24} md={12} lg={8}>
                    <PostCard data={val} />
                  </Col>
                ))}
          </Row>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export const query = graphql`
  {
    allMarkdownRemark(
      sort: { fields: [frontmatter___date], order: DESC }
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
