// 格式化访问量
const K = 1000;
const M = K * K;

export const formatNumber = num => {
  num = Number(num);
  if (num < 0) {
    return `${(num * 100).toFixed(2)}%`;
  }
  if (num < K) {
    return Math.round(num) === num ? num : num.toFixed(2);
  }
  if (num < M) {
    return `${(num / K).toFixed(2)}K`;
  }
  return `${(num / M).toFixed(2)}M`;
};