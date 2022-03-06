import React from 'react';
import Utils from './pageUtils';
export const formatNumber = num => {
  var str = Math.floor(num) === num ? num.toString() : Number(num).toFixed(2).toString();
  var reg = str.indexOf('.') > -1 ? /(\d)(?=(\d{3})+\.)/g : /(\d)(?=(?:\d{3})+$)/g;
  return str.replace(reg, '$1,');
};

export const parseQuery = () => {
  let query = location.search.substr(1);
  let queryObj = {};
  query.split('&').forEach(item => {
    let [key, value] = item.split('=');
    queryObj[key] = value;
  });
  return queryObj;
};

// 获取博客卡片的展示信息
export const getPostSubtract = frontmatter => {
  const {
    hot = false, // 热门
    recommended = false,
    isTranslated = false,
    title: _title,
    path,
    totalCount,
  } = frontmatter;

  const showHot = !!hot;
  const showRecommended = !showHot && recommended;
  let title = _title;
  if (isTranslated) {
    title = `[译] ${_title}`;
  }
  if (showHot) {
    title = (
      <>
        <span style={{ marginRight: '4px' }}>🔥</span>
        {title}
      </>
    );
  }
  if (showRecommended) {
    title = (
      <>
        <span style={{ marginRight: '4px' }}>👍</span>
        {title}
      </>
    );
  }
  const contentUrl = Utils.resolvePageUrl(path);
  const label_viewed = `${formatNumber(totalCount)}阅`;

  return {
    title,
    contentUrl,
    label_viewed,
  };
};
