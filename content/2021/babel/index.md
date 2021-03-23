---
title: Babel通识
path: blog/general-knowledge-babel
tags: [javascript, 通识]
cover: ./babel.png
date: 2021-03-25
excerpt: babel的基本目的，核心流程概念。建议阅读此篇后再去看官方文档学习使用。
---

### why babel?

我们想获得某个对象的深层次属性

```javascript
// 麻烦
const a = a && a.b && a.b.c;
// 简单
const a = a?.b?.c;
```

语言的改动跟法律的改动一样，是有滞后性的。一个提案可能要好几年才会得以实施。

如果有某种工具能把

```javascript
const a = a?.b?.c;
```

转化成

```javascript
const a = a && a.b && a.b.c;
```

就好了，于是 babel 出现了。

### 核心概念

babel 的处理流程： Tokenizer => Parser => Traverser(Transformer) => Generator

Parser 需要知道最新的语法；

plugins 进行转化

### 发展

一组 plugins，babel 采取了 preset 配置，更方便。

为啥 Parser 不支持 plugin？ 我们应该维持语言上的统一认知。

plugin 太灵活，都不知道啥时候干了啥... macro 了解下

### 后记

追谏曰：规范促进稳定，但无法阻挡人们的追求。技术如是，人亦如是。把”大象装进冰箱里“这个问题曾被当笑话看，现在看来这个答案何其朴实。

工具的出现必然是为解决某些问题，解决问题往往会分为。
