const fs = require('fs');
const path = require('path');
const process = require('process');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const io = require('@actions/io');
const { cp } = require('shelljs');

async function copyContent(contentDir, destDir) {
  if (!fs.existsSync(destDir)) {
    await io.mkdirP(destDir);
  }
  cp('-RfL', [`${contentDir}/*`, `${contentDir}/.*`], destDir);
}

async function setRepo(inps, remoteURL, workDir) {
  const originDir = process.env.GITHUB_WORKSPACE;
  await io.mkdirP(workDir);
  const result = {
    exitcode: 0,
    output: '',
  };
  result.exitcode = await exec.exec(
    'git',
    ['clone', '--single-branch', '--branch', inps.PublishBranch, remoteURL, workDir],
    {
      listeners: {
        stdout: data => {
          result.output += data.toString();
        },
      },
    }
  );
  if (result.exitcode === 0) {
    // 替换更新的「数据源」和「content」
    process.chdir(workDir);
    await exec.exec('git', ['rm', '-r', 'content', 'googleAnalytics']);
    const [path_content, path_data] = [
      path.join(originDir, 'content'),
      path.join(originDir, 'googleAnalytics'),
    ];
    process.chdir(workDir);
    await copyContent(path_content, path.join(workDir, 'content'));
    await copyContent(path_data, path.join(workDir, 'googleAnalytics'));
  }
}

async function run() {
  try {
    // 准备配置数据'
    const inps = {
      GithubToken: process.env.github_token,
      PublishBranch: 'master',
    };

    const remoteURL = `https://x-access-token:${inps.GithubToken}@github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;

    // ---------------------分割线-------------------------------------------

    core.startGroup('clone项目');
    const date = new Date();
    const unixTime = date.getTime();
    const workDir = path.join(process.env.HOME, `actions_github_pages_${unixTime}`);
    await setRepo(inps, remoteURL, workDir);
    core.endGroup();

    // ---------------------分割线-------------------------------------------

    core.startGroup('配置Git');
    try {
      await exec.exec('git', ['remote', 'rm', 'origin']);
    } catch (e) {
      core.info(`[INFO] ${e.message}`);
    }
    await exec.exec('git', ['remote', 'add', 'origin', remoteURL]);
    await exec.exec('git', ['add', '--all']);
    // 设置提交人
    await exec.exec('git', ['config', 'user.name', process.env.GITHUB_ACTOR]);
    await exec.exec('git', [
      'config',
      'user.email',
      `${process.env.GITHUB_ACTOR}@users.noreply.github.com`,
    ]);
    core.endGroup();

    // ---------------------分割线-------------------------------------------

    core.startGroup('创建Commit');
    const commitMessage = `[更新GA数据]-${new Date().toDateString()}`;
    process.chdir(workDir);
    await exec.exec('git', ['add', '.']);
    await exec.exec('git', ['commit', '-m', commitMessage]);
    core.endGroup();

    core.startGroup('推送远程分支');
    try {
      process.chdir(workDir);
      await exec.exec('git', ['push', 'origin', inps.PublishBranch]);
    } catch (e) {
      core.info(`[INFO] ${e.message}`);
    }
    core.endGroup();

    // ---------------------分割线-------------------------------------------
  } catch (e) {
    throw new Error(e.message);
  }
}
run();
