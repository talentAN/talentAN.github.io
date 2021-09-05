import React from 'react';
import { Layout, Row, Col } from 'antd';
import { graphql } from 'gatsby';
import Header from '../../components/PageLayout/Header';
import SEO from '../../components/Seo';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import TagCard from '../../components/TagCard';
import Config from '../../../config';

const Tags = ({ data }) => {
  const {
    allFile: { edges },
  } = data;
  const tagData = Config.tags;
  // 排序
  const _edges = Object.keys(tagData).map(tag => {
    return edges.find(e => e.node.name === tag);
  });
  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <Header />
        <SEO title="标签" description="追谏博客标签分类" path="tags" />
        <SidebarWrapper>
          <>
            <div className="marginTopTitle">
              <h1 className="titleSeparate">#标签</h1>
            </div>
            <Row gutter={[30, 20]}>
              {_edges.map(val => (
                <Col key={val.node.name} xs={24} sm={24} md={12} lg={8}>
                  <TagCard
                    img={val.node.childImageSharp.fluid.src}
                    name={tagData[val.node.name].name}
                    description={tagData[val.node.name].description}
                    color={tagData[val.node.name].color}
                  />
                </Col>
              ))}
            </Row>
          </>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export const query = graphql`
  {
    allMarkdownRemark(filter: { fileAbsolutePath: { regex: "/index.md$/" } }) {
      edges {
        node {
          frontmatter {
            tags
          }
        }
      }
    }
    allFile(filter: { relativeDirectory: { eq: "tags" } }) {
      edges {
        node {
          name
          childImageSharp {
            fluid(maxWidth: 400) {
              ...GatsbyImageSharpFluid_tracedSVG
            }
          }
        }
      }
    }
  }
`;

export default Tags;
