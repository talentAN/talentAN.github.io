import React, { useState, useEffect, useRef } from 'react';
import { Layout, Button } from 'antd';
import { graphql } from 'gatsby';
import Img from 'gatsby-image';
import Valine from 'gatsby-plugin-valine';
import Header from '../../components/PageLayout/Header';
import SidebarWrapper from '../../components/PageLayout/Sidebar';
import SEO from '../../components/Seo';
import support from '../../images/support.jpg';

import 'prismjs/themes/prism-solarizedlight.css';
import './highlight-syntax.less';
import style from './post.module.less';

const Post = ({ data }) => {
  const [showSupport, setShowSupport] = useState(false);
  const { html, frontmatter } = data.markdownRemark;
  const {
    title,
    cover: {
      childImageSharp: { fluid },
    },
    excerpt,
    path,
    isTranslated = false,
    keywords = [],
    prePage = '',
    nextPage = '',
  } = frontmatter;

  const hasLinkPage = prePage || nextPage; // 是否有上一页 | 下一页

  const goSupportRef = useRef();
  const supportCodeRef = useRef();

  useEffect(() => {
    const hideSupport = e => {
      if (e.target !== supportCodeRef.current && e.target !== goSupportRef.current) {
        setShowSupport(false);
      }
    };
    document.addEventListener('click', hideSupport);
    return () => {
      document.removeEventListener('click', hideSupport);
    };
  }, []);

  return (
    <Layout className="outerPadding">
      <Layout className="container">
        <SEO title={title} description={excerpt} path={path} keywords={keywords} />
        <Header />
        <SidebarWrapper>
          <div className="marginTopTitle">
            <h1>{`${isTranslated ? '[译] ' : ''}${title}`}</h1>
            <div className={style.bannerImgContainer}>
              <Img className={style.bannerImg} fluid={fluid} title={excerpt} alt={title} />
            </div>
            <article className={style.blogArticle} dangerouslySetInnerHTML={{ __html: html }} />
            <Valine
              appId="54IT3YbBjdv98afrYDGxAyhv-gzGzoHsz"
              appKey="aijtas9PQHTSFT9y53JTquND"
              path={path}
              placeholder="没启用验证码，相信你不会恶意留言🤓"
              highlight={false}
              meta={['nick', 'mail']}
              avatar={'mp'} // 头像
            />
            {hasLinkPage && (
              <div className={style.links}>
                <Button href={`/${prePage}`} type="link" disabled={!prePage}>
                  上一章
                </Button>
                <Button href={`/${nextPage}`} type="link" disabled={!nextPage}>
                  下一章
                </Button>
              </div>
            )}
            <div className={style.announcement}>
              <span className={style.label}>
                <span style={{ marginRight: '8px', color: '#fa8c16', fontSize: '15px' }}>⚠️</span>
                {isTranslated
                  ? `著作权归原作者所有，本译文仅供学习分享，禁做商用。`
                  : `著作权归作者所有。商业转载请联系作者获得授权；非商业转载请注明作者、出处。`}
              </span>
            </div>
          </div>
          <div
            className={style.hamburgerText}
            onClick={() => setShowSupport(true)}
            ref={goSupportRef}
          >
            赞赏
          </div>
          {showSupport && <img src={support} className={style.supportImg} ref={supportCodeRef} />}
        </SidebarWrapper>
      </Layout>
    </Layout>
  );
};

export const pageQuery = graphql`
  query ($postPath: String!) {
    markdownRemark(frontmatter: { path: { eq: $postPath } }) {
      html
      timeToRead
      frontmatter {
        title
        date(formatString: "DD MMM YYYY")
        tags
        path
        excerpt
        keywords
        isTranslated
        prePage
        nextPage
        cover {
          childImageSharp {
            fluid(maxWidth: 1000) {
              ...GatsbyImageSharpFluid_tracedSVG
            }
          }
        }
      }
    }
    allMarkdownRemark(
      filter: {
        frontmatter: { path: { ne: $postPath } }
        fileAbsolutePath: { regex: "/index.md$/" }
      }
    ) {
      edges {
        node {
          frontmatter {
            path
            title
            tags
            excerpt
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
  }
`;

export default Post;
