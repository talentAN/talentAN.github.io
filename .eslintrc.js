module.exports = {
  extends: ['prettier'],
  plugins: [],
  parser: '@babel/eslint-parser',
  env: { browser: true, es6: true, node: true },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 6,
    env: { es6: true },
    allowImportExportEverywhere: false,
    ecmaFeatures: { globalReturn: false, jsx: true },
    babelOptions: { configFile: './babel.config.js' },
  },
};
