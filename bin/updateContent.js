const fs = require('fs');
const process = require('process');
const path = require('path');
const totalCounts = require('../googleAnalytics/totalCount');

//-----------------helpers start---------------------------------------------
// 读取文件对应访问量
const _getTotalCount = variables => {
  const key = 'title:';
  const path_content = variables
    .find(v => v.indexOf(key) === 0)
    .slice(key.length, 200)
    .trim();
  return totalCounts[path_content] || 0;
};

//-----------------helpers end-----------------------------------------------

// 修改文章顶部变量
const modifyVariables = header => {
  const [unUsed, variables] = header.split('---');
  const variableArr = variables.split('\n');
  // 设置统计分析数据
  let hasAnalysis = false;
  const _variableArr = variableArr.filter(v => !!v);
  const totalCount = _getTotalCount(_variableArr);
  _variableArr.forEach((variable, i) => {
    // 处理统计数据
    if (variable.indexOf('totalCount:') === 0) {
      hasAnalysis = true;
      _variableArr[i] = `totalCount: ${totalCount}`;
    }
  });
  if (!hasAnalysis) {
    _variableArr.push('totalCount: 0');
  }
  // 补全注释
  _variableArr.push('---');
  _variableArr.unshift('---');
  return _variableArr.join('\n');
};

// 修改文章内容
const modifyContent = path_content => {
  const markdown = fs.readFileSync(path_content, 'utf8');
  const last_index_of_variable = markdown.indexOf('---', 5) + 3;
  const header = markdown.slice(0, last_index_of_variable);
  const content = markdown.substring(last_index_of_variable);

  const newHeader = modifyVariables(header);
  const newContent = newHeader + content;
  fs.writeFileSync(path_content, newContent);
};

// 遍历文件夹
const goOverDir = path_abs_dir => {
  // 校验统计数据
  const isDataValid =
    typeof totalCounts === 'object' &&
    Object.values(totalCounts).every(val => typeof val === 'number');
  if (isDataValid) {
    const contentDir = fs.readdirSync(path_abs_dir);
    contentDir.forEach(child => {
      const path_child = path.resolve(path_abs_dir, child);
      // 如果是入口文件
      if (child === 'index.md') {
        modifyContent(path_child);
      }
      // 如果是文件夹，继续递归
      if (fs.lstatSync(path_child).isDirectory()) {
        goOverDir(path_child);
      }
    });
  } else {
    throw new Error('数据不合法');
  }
};

console.info('=> update analytics data start');

goOverDir(path.resolve(process.cwd(), 'content'));

console.info('=> update analytics data end');
