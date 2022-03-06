---
title: 代码质量好一点，同事爱你多一点
path: blog/please-write-better-code
tags: [前端]
cover: ./cover.png
date: 2020-11-30
excerpt: 接手整理新业务代码后的总结。愿世界和平，愿所有的程序员都能被同类温柔以待...
keywords: ['优化', '代码质量']
prePage: ''
nextPage: ''
totalCount: 14
---

### 起因

入职伊始看到这坨时，我的内心是崩溃的...

```javascript
const Operation = props => {
  const { record, allowManage, global = {}, systemConfigs = {} } = props;
  const isSystem = record.system;
  return (
    <Fragment>
      {...其他操作}
      {record.status === 'READY_TO_PUBLISH' &&
        !record.waiting_approval_pass &&
        (!allowManage ||
        (systemConfigs.USE_APPROVAL === 'true' &&
          _.get(global, 'userinfo.role') !== 'admin') ? null : isSystem ? (
          <span className={`${styles.btn} ${styles.disabled}`}>{intl('上线')}</span>
        ) : (
          <Popconfirm
            title={**}
            okText={intl('确定')}
            cancelText={intl('取消')}
            onConfirm={() => {
              handleOperator('PUBLISH');
            }}>
            <span className={styles.btn}>{intl('**')}</span>
          </Popconfirm>
        ))}
    </Fragment>
  );
};
```

我还是个萌新... 我还不清楚业务... 我还不知道每个字段代表了啥...

加个逻辑简单，但我得知道根啊。毕竟日后是我维护啊，该上还是要上...

### “解码”

一眼撸去，大概是根据一堆判断决定是否展示「\*\*按钮」，并且这个「按钮」根据 isSystem 字段有两个不同的状态。

<font color="#0f0">先把逻辑和 view 分开吧, 再给逻辑结果加上一个小小的变量</font>

```javascript
const Operation = props => {
  const showOnline = !(record.status === 'READY_TO_PUBLISH' &&
        !record.waiting_approval_pass &&
        (!allowManage ||
        (systemConfigs.USE_APPROVAL === 'true' &&
          _.get(global, 'userinfo.role') !== 'admin'))
  return (
    <Fragment>
      {...其他操作}
      { showOnline ? isSystem ? (
          <span className={`${styles.btn} ${styles.disabled}`}>{**}</span>
        ) : (
          <Popconfirm
            title={**}
            okText={intl('确定')}
            cancelText={intl('取消')}
            onConfirm={() => {
              handleOperator('PUBLISH');
            }}>
            <span className={styles.btn}>{**}</span>
          </Popconfirm>
        )) : null}
    </Fragment>
  );
};
```

问了下同事 isSystem 字段的含义，原来代表是否为「系统内置」，而且除了「\*\*按钮」，其他按钮的状态也会受其影响。好吧:

<font color="#0f0">业务逻辑加个注释，免得后人不懂。</font>

```javascript
const Operation = props => {
  const {record} = props
  const {
    system: isPreset // system为***，主要为了***。
    } = record;
  const showEdit = ...
  const showOnline = ...

  return ... ;
};

```

接下来可以梳理这坨判断逻辑了...

一共涉及 4 个变量，record，system，global，allowManage。前三个是对象，最后一个是 bool，先看看它是干啥的？

“哦,prop 传进来的，那我去父组件看看”

“又是从父组件传进来的... 好吧，再去看一层... ”

“卧槽，还是父组件传进来的？？？”

“......”

终于找到了

```javascript
const allowManage = !!_.get(global, `userinfo.permissions.${PERMISSIONS_MAP.MANAGE_SECTION.id}`);
```

<font color="#0f0">如果组件同时需要变量 a 和 b，且 b 是 a 的派生态，那么请不要把 b 传进来。</font>

<font color="#0f0">如果组件只需要变量 b，不要在很遥远的地方计算出来后，然后传递 N 层给到组件，请直接在组件内由 a 计算。孩子们会感谢你的...</font>

继续理逻辑，如果 a && b && (c || d) 就

<font color="#f00">**不展示**</font>「上线按钮」...

<font color="#f00">**不展**</font>示「按钮」...

<font color="#f00">**不**</font>展示...

放弃了放弃了，没有勇气对每个条件取反... 求助产品和同事吧...

...

好的，逻辑已经理解了。策略的状态 \* 审批状态 \* 角色权限决定了是否展示上线按钮。but 我决定重写了...

怎么忍心让后人继续踩坑... 🤦‍♂️

整理后的代码

```javascript
// 是否显示「上线」按钮
const shouldShowOnline = (strategyInfo, sectionInfo, global, systemConfigs) => {
  const status = getStatus(strategyInfo);

  const allowWithoutApproval =
    !isUseApproval(systemConfigs) &&
    (status === STATUS.FINISH_CALCULATE || status === STATUS.READY_TO_PUBLISH);

  const allowWithApproval =
    isAdminRole(systemConfigs, global) &&
    (status === STATUS.READY_TO_PUBLISH || status === APPROVAL_STATUS.REJECTED);
  return (
    couldManageCurrentSection(sectionInfo, global) && (allowWithApproval || allowWithoutApproval)
  );
};

const Operation = props => {
  const { record: bannerInfo, sectionInfo, global = {}, systemConfigs = {} } = props;
  const {
    system: isPreset // system为***，主要为了***。
  } = bannerInfo;

  // 显示「**」
  const showOnline = shouldShowOnline(bannerInfo, sectionInfo, global, systemConfigs);

  return (
    <Fragment>
      {isPreset ? (
        <Fragment>
          {showEdit && <span className={disableButtonStyle}>{intl('编辑')}</span>}
          {showOnline && <span className={disableButtonStyle}>{OPERATION_LABEL.SAFE_ONLINE}</span>}
        </Fragment>
      ) : (
        <Fragment>
          {showEdit && (
            <span onClick={() => handleOperator('EDIT')} className={styles.btn}>
              {intl('编辑')}
            </span>
          )}
          {showOnline && (
            <Popconfirm
              title={**}
              okText={intl('确定')}
              cancelText={intl('取消')}
              onConfirm={() => {
                handleOperator('PUBLISH');
              }}>
              <span className={styles.btn}>{**}</span>
            </Popconfirm>
          )}
        </Fragment>
      )}
    </Fragment>
  );
};

```

不觉一天就过去了... 回顾一天，花了大部分的时间试图理解代码逻辑，还花费了产品和同事的时间，最后加了一个小小的功能... 忽然觉得人生好空虚... 😩

总结一下(<font color="#0f0">敲黑板！！！</font>)：

- 「展示层」 和 「逻辑计算」请尽量分开 => <font color="#1890ff">不要让后人在「展示」和「计算」中反复纠结；</font>
- 请给你的「逻辑判断」或「计算结果」一个可理解的变量 => <font color="#1890ff">一个可理解的变量会极大的降低业务理解成本；</font>
- 「约定」和有业务意义的「字段」请加个注释 => <font color="#1890ff">新人不会那么熟悉业务逻辑，这会加速新人上手；</font>
- 计算「派生数据」时，请牢记「就近原则」 => <font color="#1890ff">prop 一层层找起来很麻烦的；</font>
- 如果已经有了「原始数据」，就不要再存储「派生数据」 => <font color="#1890ff">除非你有一个让人无法拒绝的理由；</font>
- 通用的方法能抽取尽量抽取 =><font color="#1890ff">日后业务需求改变，自己改代码也方便不是？</font>

没人愿意写烂代码，尤其当业务需求一周七天都做不完的时候，哪有精力想代码质量，心里想的只有下班...

所以，如<font color="#0f0">**时间精力允许**</font>，还是尽量努努力吧。自己、同事、公司都会因之而受益。

愿世界和平，愿所有的程序员都能被同类温柔以待...

### 后记

![](./comment.png)
