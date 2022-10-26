// GA4 数据设置
const fs = require('fs');
const path = require('path');
const process = require('process');
const {BetaAnalyticsDataClient} = require('@google-analytics/data');
const moment = require('moment');
// 常量
const GA4_ID = '323022959';
const today = 'today';
const lastday = moment().format('YYYY-MM-DD'); // 根据CI执行时间决定的

// TODO: 上线前别忘了改！！！
const mode = 'online'; // debug | online

// 调试路径 和 线上路径
const paths =  {
  debug: {
    path_static_all : path.join(__dirname, '../../googleAnalytics/all.js'),
    path_static_detail:  path.join(__dirname, '../../googleAnalytics/static.js'),
    path_old_ua_data: path.join(__dirname, '../../googleAnalytics/totalCount_old_UA.json'),
    path_totalCount: path.join(__dirname, '../../googleAnalytics/totalCount.json')
  },
  online: {
    path_static_all: path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/all.js'),
    path_static_detail: path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/static.js'),
    path_old_ua_data: path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/totalCount_old_UA.json'),
    path_totalCount: path.join(process.env.GITHUB_WORKSPACE, 'googleAnalytics/totalCount.json')
  }
}

const dimensions = {
  pagePath: 'pagePath', // 网页路径
  date: 'date', // 日期
};
const metrics = {
  screenPageViews: 'screenPageViews', // 用户访问数
  userEngagementDuration: 'userEngagementDuration', // 页面平均停留时间
};
// ----------------------------------变量------------------------------
// 统计数据截止到上一天
const static_page_params = {
  property: `properties/${GA4_ID}`,
  dateRanges: [{
      startDate: lastday,
      endDate: lastday,
    }],
  dimensions: Object.values(dimensions).map(name=>({name})),
  metrics: Object.values(metrics).map(name=>({name})),
}

// 博客页访问数据
const blog_page_params = {
  property: `properties/${GA4_ID}`,
  dateRanges: [{
    startDate: '2022-10-25', // 2022-10-24之前用老的UA数据，从25号切换到GA4,
    endDate: today,
  }],
  dimensions: [{ name: dimensions.pagePath }],
  metrics: [{ name: metrics.userEngagementDuration }]
};

// 设置「博客页」访问数据
const setBlobPageData = rows => {
  console.info('开始 => 设置「博客页」访问数据');
  const path_old_ua_data = paths[mode].path_old_ua_data;
  const totalCounts = JSON.parse(fs.readFileSync(path_old_ua_data, 'utf8'));
  // 麻蛋，node15以下居然不支持replaceAll...
  String.prototype.replaceAll = function (target, payload) {
    let value =  this.valueOf();
    while(value.indexOf(target) !== -1){
      value = value.replace(target, payload);
    }
    return value
};
  rows.forEach(row => {
    const [title, count] = row;
    const title_key = title.toString().replaceAll('%20', ' '); // GA4读来的路径没替换空格
    totalCounts[title_key] = Number(count) + (totalCounts[title_key] * 1 || 0);
  });

  // 获取文件存储路径
  const path_totalCount = paths[mode].path_totalCount

  fs.writeFileSync(path_totalCount, JSON.stringify(totalCounts));
  console.info('完成 => 设置「博客页」访问数据');
};

/** 设置「统计页」数据
 *  - google每次查询限制1000条
 *  - 还是用增量操作较好，每次全部重写不可持续;
 */
const setStaticPageData = rows => {
  if(!rows || rows.length === 0){
    console.info('无更新数据');
    return;
  }
  console.info('static data=>',rows)
  console.info('开始 => 增量写入「统计页」访问数据');
  // 获取文件存储路径
  const pre = 'export const data = ';
  // 获取原始数据
  const path_all = paths[mode].path_static_all;
  const originData = fs.readFileSync(path_all, 'utf8');
  const oldData = originData.split(pre)[1];
  // 生成新数据
  const newData = oldData.substring(0, oldData.length -1) + ','+ JSON.stringify(rows).substring(1);
  fs.writeFileSync(path_all, pre + newData);
  console.info('完成 => 增量写入「统计页」访问数据');
  
  console.info('开始 => 增量计算「统计页」展示数据');
  // 计算好的派生数据
  const path_static = paths[mode].path_static_detail;
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

const setAnalyticsData = async () => {
// 本地调试用
// const ga4_private_key = "-----BEGIN PRIVATE KEY-----";
// const ga4_client_email = ".com";

// TODO: 上线前别忘了改！！！ 生产环境用
const { ga4_private_key, ga4_client_email } = process.env;

  const analyticsDataClient = new BetaAnalyticsDataClient({
    credentials:{
      client_email: ga4_client_email,
      private_key: ga4_private_key,
    }
  });

  // 获取、设置「统计页」访问数据
  const [res_static] = await analyticsDataClient.runReport(static_page_params);
  setStaticPageData(res_static.rows.map(row=>[
    row.dimensionValues[0].value, // 路径
    row.dimensionValues[1].value, // 日期
    row.metricValues[0].value, // 访问量
    row.metricValues[1].value, // 平均访问时长
  ]));

  // 获取「博客页」访问数据
  const [res_blog] = await analyticsDataClient.runReport(blog_page_params);
  setBlobPageData(res_blog.rows.map(row=>[
    row.dimensionValues[0].value, // 路径
    row.metricValues[0].value, // 访问量
  ]));
};

try {
  setAnalyticsData();
} catch (e) {
  throw new Error(e.message);
}
