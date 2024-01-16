const config = require('./config');

module.exports = [
  'gatsby-plugin-react-helmet',
  'gatsby-transformer-sharp',
  'gatsby-plugin-sharp',
  'gatsby-plugin-less',
  'gatsby-plugin-offline',
  // {
  //   resolve: `gatsby-plugin-valine`,
  //   options: {
  //     appId: `54IT3YbBjdv98afrYDGxAyhv-gzGzoHsz`,
  //     appKey: `aijtas9PQHTSFT9y53JTquND`,
  //     avatar: `robohash`,
  //   },
  // },
  {
    resolve: `gatsby-plugin-valine-comment`,
    options: {
      appId: `54IT3YbBjdv98afrYDGxAyhv-gzGzoHsz`,
      appKey: `aijtas9PQHTSFT9y53JTquND`,
      avatar: `robohash`,
    },
  },
  {
    resolve: 'gatsby-source-filesystem',
    options: {
      name: 'images',
      path: `${__dirname}/src/images`,
    },
  },
  {
    resolve: 'gatsby-plugin-manifest',
    options: {
      name: 'talentan',
      short_name: 'talentan',
      start_url: '/',
      background_color: '#304CFD',
      theme_color: '#304CFD',
      display: 'standalone',
      icon: 'src/images/icon.png', // This path is relative to the root of the site.
      legacy: true, // this will add apple-touch-icon links to <head>. Required for
    },
  },
  {
    resolve: 'gatsby-source-filesystem',
    options: {
      name: 'markdown-pages',
      path: `${__dirname}/content`,
    },
  },
  {
    resolve: 'gatsby-transformer-remark',
    options: {
      plugins: [
        {
          resolve: 'gatsby-remark-images',
          options: {
            maxWidth: 1000,
            quality: 80,
            showCaptions: true,
            linkImagesToOriginal: false,
          },
        },
        {
          resolve: 'gatsby-remark-external-links',
          options: {
            rel: 'nofollow',
          },
        },
        'gatsby-remark-prismjs',
      ],
    },
  },
  {
    resolve: 'gatsby-plugin-i18n',
    options: {
      langKeyDefault: config.defaultLanguage,
      useLangKeyLayout: false,
    },
  },
  'gatsby-plugin-sitemap',
  'gatsby-plugin-robots-txt',
  {
    resolve: 'gatsby-plugin-antd',
    options: {
      javascriptEnabled: true,
    },
  },
  // 老UA数据统计
  // {
  //   resolve: 'gatsby-plugin-google-analytics',
  //   options: {
  //     // The property ID; the tracking code won't be generated without it
  //     trackingId: config.googleAnalyticTrackingId,
  //     // Defines where to place the tracking script - `true` in the head and `false` in the body
  //     head: false,
  //   },
  // },
  // 新GA4数据统计
  {
    resolve: `gatsby-plugin-google-gtag`,
    options: {
      // You can add multiple tracking ids and a pageview event will be fired for all of them.
      trackingIds: [
        config.googleAnalytic_UA_TrackingId,
        config.googleAnalytic_GA4_TrackingId, // Google Analytics / GA
        // "AW-CONVERSION_ID", // Google Ads / Adwords / AW
        // "DC-FLOODIGHT_ID", // Marketing Platform advertising products (Display & Video 360, Search Ads 360, and Campaign Manager)
      ],
      // This object gets passed directly to the gtag config command
      // This config will be shared across all trackingIds
      // 暂时不需要这些配置功能
      // gtagConfig: {
      //   optimize_id: "OPT_CONTAINER_ID",
      //   anonymize_ip: true,
      //   cookie_expires: 0,
      // },
      // This object is used for configuration specific to this plugin
      pluginConfig: {
        // Puts tracking script in the head instead of the body
        head: false,
        // Avoids sending pageview hits from custom paths
        // exclude: ["/preview/**", "/do-not-track/me/too/"],
        // Defaults to https://www.googletagmanager.com
        // origin: "YOUR_SELF_HOSTED_ORIGIN",
      },
    },
  },
  {
    resolve: 'gatsby-plugin-nprogress',
    options: {
      // Setting a color is optional.
      color: 'black',
      // Disable the loading spinner.
      showSpinner: true,
    },
  },
];
