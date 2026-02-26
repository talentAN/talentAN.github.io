import CryptoJS from 'crypto-js';

/**
 * 生成 Bitget API 请求签名
 * @param {string} timestamp - 时间戳（毫秒）
 * @param {string} method - 请求方法 GET/POST
 * @param {string} requestPath - 请求路径（包含查询参数）
 * @param {string} body - 请求体（POST 请求时使用，GET 请求为空字符串）
 * @param {string} secretKey - API Secret Key
 * @returns {string} Base64 编码的签名
 */
 const generateSignature = (timestamp, method, requestPath, body, secretKey) => {
  const message = timestamp + method + requestPath + body;
  const hmac = CryptoJS.HmacSHA256(message, secretKey);
  return CryptoJS.enc.Base64.stringify(hmac);
};

/**
 * 生成 Bitget API 请求头
 * @param {Object} config - 配置对象
 * @param {string} config.apiKey - API Key
 * @param {string} config.apiSecret - API Secret
 * @param {string} config.passphrase - API Passphrase
 * @param {string} config.method - 请求方法 GET/POST
 * @param {string} config.requestPath - 请求路径（包含查询参数）
 * @param {string} [config.body=''] - 请求体（可选，默认为空字符串）
 * @returns {Object} 请求头对象
 */
export const generateHeaders = ({ apiKey, apiSecret, passphrase, method, requestPath, body = '' }) => {
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, requestPath, body, apiSecret);

  return {
    'ACCESS-KEY': apiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
    'locale': 'zh-CN'
  };
};
