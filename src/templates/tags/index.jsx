/* Vendor imports */
import React from 'react';
import { graphql } from 'gatsby';
import Img from 'gatsby-image';
import { Layout, Row, Col } from 'antd';
/* App imports */
import SEO from '../../components/Seo';
import Header from '../../components/PageLayout/Header';
import PostCard from '../../components/PostCard';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import Config from '../../../config';
import Utils from '../../utils/pageUtils';
import style from './tags.module.less';

const TagPage = ({ data, pageContext }) => {
  const { tag } = pageContext;
  const tagName = Config.tags[tag].name || Utils.capitalize(tag);
  const tagPagePath = Config.pages.tag;
  const tagImage = data.allFile.edges.find(edge => edge.node.name === tag).node.childImageSharp
    .fluid;
  const posts = data.allMarkdownRemark.edges;
  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <Header />
        <SEO
          title={tagName}
          description={`关于${tagName}. ${Config.tags[tag].description}的所有博客`}
          path={Utils.resolvePageUrl(tagPagePath, tag)}
          keywords={[tagName]}
        />
        <SidebarWrapper>
          <div className={`marginTopTitle ${style.tagsList}`}>
            <h1>#{tagName}</h1>
            <div className={style.bannerImgContainer}>
              <Img className={style.bannerImg} fluid={tagImage} alt={tagName} />
            </div>
            <h4 className="textCenter">{Config.tags[tag].description}</h4>
          </div>
          <Row gutter={[20, 20]}>
            {posts.map((post, key) => (
              <Col key={key} xs={24} sm={24} md={12} lg={8}>
                <PostCard data={post} />
              </Col>
            ))}
          </Row>
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export const pageQuery = graphql`
  query ($tag: String!) {
    allMarkdownRemark(
      filter: { frontmatter: { tags: { in: [$tag] } }, fileAbsolutePath: { regex: "/index.md$/" } }
      sort: { fields: [frontmatter___date], order: DESC }
    ) {
      edges {
        node {
          frontmatter {
            title
            date(formatString: "MMMM DD, YYYY")
            path
            tags
            excerpt
            isTranslated
            keywords
            totalCount
            cover {
              childImageSharp {
                fluid(maxWidth: 600) {
                  ...GatsbyImageSharpFluid_tracedSVG
                }
              }
            }
          }
        }
      }
    }
    allFile(filter: { name: { eq: $tag }, dir: { regex: "/tags$/" } }) {
      edges {
        node {
          name
          childImageSharp {
            fluid(maxHeight: 600) {
              ...GatsbyImageSharpFluid_tracedSVG
            }
          }
        }
      }
    }
  }
`;

export default TagPage;
