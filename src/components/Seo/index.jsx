/* Vendor imports */
import React from 'react';
import { Helmet } from 'react-helmet';
import { StaticQuery, graphql } from 'gatsby';
/* App imports */
import Config from '../../../config';
import Utils from '../../utils/pageUtils';

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

const KEYWORDS = [
  'talentan',
  'adam_an02',
  'FullStack developer',
  'Javascript',
  'NodeJS',
  'React',
  'SensorsData',
  '神策数据',
];

function SEO({
  title,
  description,
  keywords = [],
  path,
  lang,
  contentType,
  imageUrl,
  translations,
  meta,
}) {
  return (
    <StaticQuery
      query={detailsQuery}
      render={() => {
        const metaKeywords = { name: 'keywords', content: [...KEYWORDS, ...keywords].join(', ') };
        const pageUrl = Utils.resolvePageUrl(Config.siteUrl, Config.pathPrefix, path);
        const metaImageUrl = Utils.resolveUrl(
          Config.siteUrl,
          imageUrl || 'https://www.sensorsdata.cn/favicon.ico'
        );

        return (
          <Helmet
            title={title} // Page title
            titleTemplate={`%s | ${Config.siteTitle}`}
            meta={
              [
                { name: 'description', content: description }, // Page description
                /* Open Graph */
                { property: 'og:title', content: title },
                { property: 'og:type', content: contentType || 'website' },
                { property: 'og:url', content: pageUrl },
                { property: 'og:description', content: description },
                { property: 'og:image', content: metaImageUrl },
                { property: 'og:image:alt', content: description },
                { property: 'og:site_name', content: Config.siteTitle },
                { property: 'og:locale', content: lang || 'en_US' },
                /* Twitter card */
                { name: 'twitter:card', content: 'summary_large_image' },
                { name: 'twitter:title', content: title },
                { name: 'twitter:description', content: description },
                { name: 'twitter:image', content: metaImageUrl },
                { name: 'twitter:image:alt', content: description },
                { name: 'twitter:site', content: Config.author },
                { name: 'twitter:creator', content: Config.author },
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
