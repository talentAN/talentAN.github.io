const core = require('@actions/core');
const io = require('@actions/io');

async function createDir(dirPath) {
  await io.mkdirP(dirPath);
  core.debug(`Created directory ${dirPath}`);
  return;
}

async function getHomeDir() {
  let homedir = '';

  if (process.platform === 'win32') {
    homedir = process.env['USERPROFILE'] || 'C:\\';
  } else {
    homedir = `${process.env.HOME}`;
  }

  core.debug(`homeDir: ${homedir}`);

  return homedir;
}

module.exports = {
  createDir,
  getHomeDir,
};
