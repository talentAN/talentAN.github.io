import React from 'react';

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
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4960355918807996"
     crossorigin="anonymous"></script>
      </body>
    </html>
  );
};

export default Home;
