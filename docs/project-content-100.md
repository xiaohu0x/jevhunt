# 首批 100 个仓库的内容维护

本批范围是 `content/project-selection.json` 固定的 100 个 GitHub 仓库，来自
2026-09-30 线上目录快照，按当时 Star 数优先。每个仓库提供 15 个语言版本，
共 1,500 个详情页。它不是全站约 5,200 个仓库已经全部完成的声明。
后续 Star 变化不自动替换本批名单。

## 页面与搜索意图

页面帮助读者判断「这个项目做什么、Jev 在哪里起作用、如何开始、有什么限制」。
项目名放在 Title/H1 前部，标题中的任务及 Jev 关系必须得到来源支持。
Description 先说明项目及实际用途，再保留重要的可选条件或限制；不使用未经
核实的「免费、最快、完整教程」来吸引点击。正文提供用途、Jev 作用、使用方式、
范围限制四节，并链接到固定提交的对应源码行。

TradingAgents 的标题以项目名开头，明确可选 Jev 筛选。正文区分交易研究框架
和 Jev 对 StockTwits、Reddit 帖子的预处理，说明 API key 缺失时跳过筛选。
本地模型、SDK、研究项目和资源集合按实际关系描述，不统一包装成云端集成。

15 个版本为 en、zh-cn、zh-tw、ja、ko、es、fr、de、pt-br、ru、hi、id、vi、tr、it。
对应语言中的技术实体保留原名，其他文案按该语言重写。查询意图依据项目事实和
语言习惯推断；没有逐市场可审核的 SERP 或查询量数据，不声称已验证排名或 CTR。
Title 的 76 显示单位及 Description 的长度预算属于编辑提醒，不是 Google 的
固定限制。必要时保留完整项目名和限定词，不机械截断。

## 来源与审阅记录

`content/projects/<owner>/<repo>.json` 保存稳定 GitHub ID、展示名称、分类、关系、
事实审阅日期、来源提交/hash、英文 claim ledger 及 15 个语言的内容。
每一节关联明确的 claim ID；每项 claim 引用具体来源及行范围。
来源是项目第一方 README、文档或源码，不把搜索摘要作为事实证明。

本批由三个 Codex 子代理分工编写，再交叉进行语义和语言检查。记录中的
`language: model-reviewed` 表示模型审阅，不表示母语人工审稿。
`semantic: source-checked` 表示材料与来源对照，不表示运行过这些项目。
`searchIntent: inferred` 保留搜索意图的真实证据水平。未使用额外付费模型 API。

所有 15 个版本已有独立 URL、self-canonical、互相对应的 hreflang；本批全部
加入 sitemap。外部 GitHub 引文保留源码语言。方法说明、隐私条款等共享说明页
仍为英语，其他未改造仓库的推荐卡片可能保留原简介；不声称整个站点旅程已经
完成全量内容本地化。

## 构建与来源校验

```sh
npm run build                    # 结构、claim ledger、构建；不宣称重新核验来源文件
npm test
npm run content:verify:static    # 本批 1,500 个渲染结果及 100 个英文静态回退
npm run audit:project-seo -- --static  # 整个目录的 15 语言技术 SEO
```

日常开发和 CI 不依赖未提交的来源缓存。正式发布必须另外通过严格来源校验：

```sh
npm run content:check
```

该命令要求 `.cache/project-content/manifest.json` 包含本批每个项目的完整来源
文件，并逐个验证 SHA-256 和引用段落。空 manifest、缺失 packet/文档、hash
不一致或引用行不匹配都会失败。`--ledger-only` 显式表示没有执行归档来源核验，
不能代替发布前的严格检查。

新 checkout 可以按内容中记录的固定 URL 恢复来源，而不重新猜测当前 README：

```sh
node tools/restore-project-sources.mjs --out .cache/project-content
npm run content:check
```

恢复工具只下载已记录来源并验证既有 hash；不会自动接受源码改变或编写事实。
通用 `content:collect` 则面向新的 live catalog 调研，保留独立的采集范围和记录。
缓存、原始调研和详细机器报告位于忽略提交的 `.cache/`、`reports/`。

## 本地和生产发布

```sh
npm run db:migrate:local
npm run catalog:seed:local
npm run content:publish:local
npm run dev
```

需要与其他开发进程隔离时，迁移、seed、publisher 和 Pages dev 使用同一个
`--persist-to .cache/project-content/preview-state`。不能让独立 workerd 进程
同时操作另一开发会话正在使用的 SQLite 文件。

```sh
node tools/publish-project-content.mjs --remote  # 生成可检查的 SQL，不写 D1
npm run deploy                                # 已获部署授权后执行
node tools/publish-project-content.mjs --remote --verify-only
npm run content:verify:production
```

Publisher 按仓库路径与稳定 ID 双重匹配，尊重撤回，处理同一 ID 的规范路径变更。
它只更新已审阅的展示/分类/证据字段，不覆盖同步器刚更新的 Star、活动时间和
当前提交。全文与语言摘要独立存入 D1，目录接口不会发送全部 15 种语言正文。
发布后验证 100 条记录的内容 hash、1,500 份语言内容及搜索摘要，并确认列表分类
与详情一致。生产验收再读取全部 1,500 个真实 URL，检查标题、描述、H1、四节正文、
引用、canonical、hreflang、schema、可索引状态、sitemap 和本地化搜索。

## 后续同步和下一批

`project_content_queue` 记录尚无内容或源码提交发生变化的仓库。同步器保留已审阅
内容和更正的分类；旧事实仍有固定来源日期，新的提交进入待复核队列，不冒充完成
了新的事实审阅。它不会调用付费模型、批量自动翻译或自动发布未经核对的事实。
同一 GitHub ID 改名后，旧路径会重定向，新路径在完成身份和内容复核前使用通用
摘要；复核并按新路径发布后恢复独立文案，不把旧路径的内容直接附给不同 ID。

下一批先扩展 selection 并采集来源，再补全 claim ledger、15 语言正文及独立
交叉审阅，最后通过相同的校验和发布流程。已审阅内容优先于
`catalog/project-seo.json` 的旧元数据补充；未改造仓库继续使用既有规则。

上线验收证明页面按预期返回，不证明 Google 已抓取、索引或给予排名。实际效果
需要继续按项目详情路径、语言和查询观察 GSC 展现、CTR、排名及 URL Inspection。

## 本批发布前验收（2026-09-30）

- 100 个仓库、1,500 份语言内容，全部通过来源与结构检查；没有英文正文回退。
- 重新下载 111 份固定版本来源，SHA-256 与记录一致；658 处完整引用行匹配。
- 161 项代码测试通过；真实 SDK 的四个示例及文档分类示例通过离线传输测试。
- 本批 1,500 个最终 HTML、100 个英文静态回退、1,500 个 sitemap URL 通过核验。
- 全站 5,191 个项目 × 15 语言（77,865 个渲染结果）及 5,191 个英文静态回退
  通过技术 SEO 审计，错误为 0。这不代表其余 5,091 个仓库完成了独立内容改造。
- Pages Functions 和定时 Worker 编译通过；隔离的本地 Pages + D1 返回新正文，
  中文“基本面”搜索能命中 TradingAgents。

语言审阅是模型交叉审阅，搜索意图仍为推断。桌面和移动端截图检查因当前电脑
使用接口不可用而未完成：内置浏览器不可用，Chrome 无可访问窗口，Safari 超时。
已完成 HTML、DOM 交互和真实 HTTP 路由检查，不把它们称为截图或人工视觉验收。
生产结果另由 `content:verify:production` 保存到本地忽略提交的验收报告，匹配
部署 build ID 后再判定发布生效。
