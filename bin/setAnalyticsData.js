const fs = require('fs');
const path = require('path');
const process = require('process');
const { google } = require('googleapis');
const moment = require('moment');
// 常量
const IDS = 'ga:239799573';
const startDate = '2021-03-01';
const today = 'today';
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
  'end-date': today,
  metrics: metrics.pageViews,
  dimensions: dimensions.pagePath,
};

// 统计数据截止到上一天
const lastday = moment().format('YYYY-MM-DD');
const static_page_params = {
  ids: IDS,
  'start-date': lastday,
  'end-date': lastday,
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

/** 设置「统计页」数据
 *  - google每次查询限制1000条
 *  - 还是用增量操作较好，每次全部重写不可持续;
 *  - 后面做crossfilter, 增量操作也方面进行数据库查询啥的
 */
const setStaticPageData = rows => {
  if(!rows || rows.length === 0){
    console.info('无更新数据');
    return;
  }
  console.info('开始 => 增量写入「统计页」访问数据');
  // 获取文件存储路径
  const pre = 'export const data = ';
  // const path_all = path.join(__dirname, '../googleAnalytics/all.js');
  const path_all = path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/all.js');
  // 获取原始数据, 生成新数据
  const originData = fs.readFileSync(path_all, 'utf8');
  const oldData = originData.split(pre)[1];
  const newData = oldData.substring(0, oldData.length -1) + ','+ JSON.stringify(rows).substring(1);
  fs.writeFileSync(path_all, pre + newData);
  console.info('完成 => 增量写入「统计页」访问数据');
  
  console.info('开始 => 增量计算「统计页」展示数据');
  // 计算好的派生数据
  // const path_static = path.join(__dirname, '../googleAnalytics/static.js');
  const path_static = path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/static.js');
  const static_data = JSON.parse(fs.readFileSync(path_static, 'utf8').split(pre)[1]);
  rows.forEach(row=>{
    const [path_blog, date, pageViews, avgTimeOnPage] = row;
    // 当日访问量
    static_data.filteredData[date] = static_data.filteredData[date] || 0;
    static_data.filteredData[date] += pageViews * 1;
    // 累计访问量
    static_data.total = static_data.total*1 + pageViews * 1;
    // 累计阅读时长
    static_data.total_time = static_data.total_time + pageViews * avgTimeOnPage;
  })
  fs.writeFileSync(path_static, pre + JSON.stringify(static_data));
  console.info('完成 => 增量计算「统计页」展示数据');
};

// 本地调试用
// const private_key ='-----BEGIN PRIVATE KEY-----';
// const client_email = 'github-action';

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
