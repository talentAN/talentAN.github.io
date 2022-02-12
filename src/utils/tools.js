// 格式化访问量
// const K = 1000;
// const M = K * K;

// export const formatNumber = num => {
//   num = Number(num);
//   if (num < 0) {
//     return `${(num * 100).toFixed(2)}%`;
//   }
//   if (num < K) {
//     return Math.round(num) === num ? num : num.toFixed(2);
//   }
//   if (num < M) {
//     return `${(num / K).toFixed(2)} K`;
//   }
//   return `${(num / M).toFixed(2)} M`;
// };

export const formatNumber = num => {
  var str = Math.floor(num) === num ? num.toString() : Number(num).toFixed(2).toString();
  var reg = str.indexOf('.') > -1 ? /(\d)(?=(\d{3})+\.)/g : /(\d)(?=(?:\d{3})+$)/g;
  return str.replace(reg, '$1,');
};
