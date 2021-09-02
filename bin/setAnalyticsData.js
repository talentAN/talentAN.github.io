const fs = require('fs');
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const setAnalyticsData = async () => {
  const { client_email, private_key } = process.env;

  const jwtClient = new google.auth.JWT(
    client_email,
    null,
    private_key.replace(/\\n/gm, '\n'),
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

  const params = {
    ids: 'ga:239799573',
    'start-date': '2021-03-01',
    'end-date': 'today',
    metrics: 'ga:pageviews',
    dimensions: 'ga:pagePath',
  };

  await analytics.data.ga.get(params, (err, res) => {
    if (err) {
      console.error(err);
      throw err;
    }
    const rows = res.data.rows;
    const totalCounts = {};
    rows.forEach(row => {
      const [title, count] = row;
      totalCounts[title] = Number(count);
    });
    // 获取文件存储路径
    const path_totalCount = path.join(
      process.env.GITHUB_WORKSPACE,
      'googleAnalytics/totalCount.js'
    );

    // 写入数据
    const newTotalCountStr =
      'const totalCounts = ' + JSON.stringify(totalCounts) + '\n' + 'module.exports = totalCounts;';

    fs.writeFileSync(path_totalCount, newTotalCountStr);
    console.info('Set Analytics Data Done');
  });
};

try {
  setAnalyticsData();
} catch (e) {
  throw new Error(e.message);
}
