// 格式化访问量
const K = 1000;
const M = K * K;

export const formatNumber = num => {
  num = Number(num);
  if (num < K) {
    return num;
  }
  if (num < M) {
    return `${(num / K).toFixed(2)}K`;
  }
  return `${(num / M).toFixed(2)}K`;
};
