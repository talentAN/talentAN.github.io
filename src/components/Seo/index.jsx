/* Vendor imports */
import React from 'react';
import { Helmet } from 'react-helmet';
import { StaticQuery, graphql } from 'gatsby';
/* App imports */
import Config from '../../../config';
import Utils from '../../utils/pageUtils';
import favicon from '../../../static/favicon.ico';

const detailsQuery = graphql`
  query DefaultSEOQuery {
    file(name: { eq: "sensorsdata" }) {
      childImageSharp {
        fixed(width: 600) {
          ...GatsbyImageSharpFixed_noBase64
        }
      }
    }
  }
`;

function SEO({ title, description, keywords, path, imageUrl, translations, meta }) {
  keywords = Array.isArray(keywords) ? keywords : [];
  return (
    <StaticQuery
      query={detailsQuery}
      render={() => {
        const metaKeywords = {
          name: 'keywords',
          content: [...Config.keywords, ...keywords].join(', '),
        };
        const pageUrl = Utils.resolvePageUrl(Config.siteUrl, Config.pathPrefix, path);
        const metaImageUrl = Utils.resolveUrl(Config.siteUrl, favicon);

        return (
          <Helmet
            title={title} // Page title
            titleTemplate={`%s | ${Config.siteTitle}`}
            meta={
              [
                { name: 'description', content: description }, // Page description
                /* Open Graph */
                { property: 'og:title', content: title },
                { property: 'og:type', content: 'website' },
                { property: 'og:url', content: pageUrl },
                { property: 'og:description', content: description },
                { property: 'og:image', content: metaImageUrl },
                { property: 'og:image:alt', content: description },
                { property: 'og:site_name', content: Config.siteTitle },
                { property: 'og:locale', content: 'zh-CN' },
              ]
                .concat(metaKeywords) // Keywords
                .concat(meta || []) // Other provided metadata
            }
            link={[
              { rel: 'canonical', href: pageUrl }, // Canonical url
            ]
              // Translated versions of page
              .concat(
                translations
                  ? translations.map(obj => ({
                      rel: 'alternate',
                      hreflang: obj.hreflang,
                      href: Utils.resolvePageUrl(Config.siteUrl, Config.pathPrefix, obj.path),
                    }))
                  : []
              )}
          />
        );
      }}
    />
  );
}

export default SEO;
