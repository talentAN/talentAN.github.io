const fs = require('fs');
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

// 常量
const IDS = 'ga:239799573';
const startDate = '2021-03-01';
const endDate = 'today';
const dimensions = {
  pagePath: 'ga:pagePath',
  date: 'ga:date',
};
const metrics = {
  pageViews: 'ga:pageviews',
  avgTimeOnPage: 'ga:avgTimeOnPage', // 页面平均停留时间
  timeOnPage: 'ga:timeOnPage', // 在跳到下一页前，在此页的停留时间（直接关闭此页的数据没有统计在内），看了下统计数据，如果有人在这个页面期间去干了别的事儿，误差很大，还是上面的指标好用一点。
};
// ----------------------------------变量------------------------------

const blog_page_params = {
  ids: IDS,
  'start-date': startDate,
  'end-date': endDate,
  metrics: metrics.pageViews,
  dimensions: dimensions.pagePath,
};

const static_page_params = {
  ids: IDS,
  'start-date': startDate,
  'end-date': endDate,
  metrics: Object.values(metrics).join(','),
  dimensions: Object.values(dimensions).join(','),
};

// 设置「博客页」访问数据
const setBlobPageData = rows => {
  console.info('开始 => 设置「博客页」访问数据');
  const totalCounts = {};
  rows.forEach(row => {
    const [title, count] = row;
    totalCounts[title] = Number(count);
  });
  // 获取文件存储路径
  const path_totalCount = path.join(
    process.env.GITHUB_WORKSPACE,
    'googleAnalytics/totalCount.json'
  );

  fs.writeFileSync(path_totalCount, JSON.stringify(totalCounts));
  console.info('完成 => 设置「博客页」访问数据');
};
// 设置「统计页」数据
const setStaticPageData = rows => {
  console.info('开始 => 写入「统计页」访问数据');

  // 获取文件存储路径
  const path_all = path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/all.js');
  fs.writeFileSync(path_all, 'export const data = ' + JSON.stringify(rows));
  console.info('完成 => 写入「统计页」访问数据');
};

const setAnalyticsData = async () => {
  const { client_email, private_key } = process.env;

  const jwtClient = new google.auth.JWT(
    client_email,
    null,
    private_key.replace(/\\n/gm, '\n'),
    // private_key,
    [
      'https://www.googleapis.com/auth/analytics',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
    null
  );

  const analytics = google.analytics({
    version: 'v3',
    auth: jwtClient,
  });

  // 获取「博客页」访问数据
  await analytics.data.ga.get(blog_page_params, (err, res) => {
    if (err) {
      console.error(err);
      throw err;
    }
    setBlobPageData(res.data.rows);
  });

  // 获取「统计页」访问数据
  await analytics.data.ga.get(static_page_params, (err, res) => {
    if (err) {
      console.error(err);
      throw err;
    }
    setStaticPageData(res.data.rows);
  });
};

try {
  setAnalyticsData();
} catch (e) {
  throw new Error(e.message);
}
