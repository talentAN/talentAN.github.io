import React from 'react';

const isProd = process.env.NODE_ENV === 'production';

const Home = props => {
  const {
    htmlAttributes,
    headComponents,
    bodyAttributes,
    body,
    preBodyComponents,
    postBodyComponents,
  } = props;

  return (
    <html lang="zh-CN" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {headComponents}
      </head>
      <body {...bodyAttributes} className="light">
        {preBodyComponents}
        <div key="body" id="___gatsby" dangerouslySetInnerHTML={{ __html: body }} />
        {postBodyComponents}
        {/* 本地 develop 不要挂 AdSense：广告脚本常被拦/回 HTML，浏览器解析成 Unexpected token '<' */}
        {isProd ? (
          <script
            async
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4960355918807996"
            crossOrigin="anonymous"
          />
        ) : null}
      </body>
    </html>
  );
};

export default Home;
