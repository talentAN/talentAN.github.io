/* Vendor imports */
const path = require('path');
/* App imports */
const config = require('./config');
const utils = require('./src/utils/pageUtils');

exports.createPages = ({ actions, graphql }) => {
  const { createPage } = actions;

  return graphql(`
    {
      allMarkdownRemark(sort: { order: DESC, fields: [frontmatter___date] }) {
        edges {
          node {
            frontmatter {
              path
              tags
              keywords
              prePage
              nextPage
            }
            fileAbsolutePath
          }
        }
      }
    }
  `).then(result => {
    if (result.errors) return Promise.reject(result.errors);

    const { allMarkdownRemark } = result.data;

    /* Post pages */
    allMarkdownRemark.edges.forEach(({ node }) => {
      // Check path prefix of post
      if (node.frontmatter.path.indexOf(config.pages.blog) !== 0) {
        // eslint-disable-next-line no-throw-literal
        throw `Invalid path prefix: ${node.frontmatter.path}`;
      }

      createPage({
        path: node.frontmatter.path,
        component: path.resolve('src/templates/post/post.jsx'),
        context: {
          postPath: node.frontmatter.path,
          translations: utils.getRelatedTranslations(node, allMarkdownRemark.edges),
        },
      });
    });
    const regexForIndex = /index\.md$/;
    // Posts in default language, excluded the translated versions
    const defaultPosts = allMarkdownRemark.edges.filter(({ node: { fileAbsolutePath } }) =>
      fileAbsolutePath.match(regexForIndex)
    );

    /* Tag pages */
    const allTags = [];
    defaultPosts.forEach(({ node }) => {
      node.frontmatter.tags.forEach(tag => {
        if (allTags.indexOf(tag) === -1 && tag !== '酝酿池') allTags.push(tag);
      });
    });
    allTags.forEach(tag => {
      // 想修改一下「聪明人的个人成长」标签名称，但为了避免有人收藏过页面导致无法访问，所以保持路径不变。特殊处理下。
      const page_path = tag === '聪明人的个人成长' ? 'Personal Development for Smart People' : tag;
      createPage({
        path: utils.resolvePageUrl(config.pages.tag, page_path),
        component: path.resolve('src/templates/tags/index.jsx'),
        context: {
          tag,
        },
      });
    });

    return 1;
  });
};
