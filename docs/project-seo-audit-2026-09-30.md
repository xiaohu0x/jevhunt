# 仓库详情页 SEO 改造验收

日期：2026-09-30。本文件记录部署前的代码、构建与验收结果；后续发布状态以 Cloudflare 部署记录为准。

## 原有问题

线上 TradingAgents 页实际输出为：

```text
Title: TauricResearch/TradingAgents — Integration | JevHunt
Description: TradingAgents: Multi-Agents LLM Financial Trading Framework
H1: TradingAgents
```

主要不足是作者占据标题开头，关系标签泛化，描述没有解释 Jev 的具体作用。中文、日文页面仍使用同一段英文 description。既有独立 URL、服务端 HTML、canonical、hreflang 和可抓取链接已有基础；本次重点修正文案与页面内容的一致性。

## 最终规则与示例

完整规则见 [project-seo-rules.md](project-seo-rules.md)。默认顺序是项目名 → Jev 关系 / 用途 → JevHunt；作者只为同名仓库消歧。Title、H1、可见摘要、meta description、社交描述和结构化数据共同生成。

| 语言 | 新 Title |
| --- | --- |
| 英语 | TradingAgents + Jev — Multi-Agent Trading \| JevHunt |
| 简体中文 | TradingAgents + Jev：多智能体交易框架 \| JevHunt |
| 日语 | TradingAgents × Jev｜マルチエージェント取引 \| JevHunt |

新的中文 Description：

> TradingAgents 是多智能体交易框架，可选用 Jev 筛选社交帖子。查看 Jev 关联依据、Python 源码与同类项目，判断是否适合你的需求。

这里的「可选」有 README 来源。它说明的是 Jev 对社交帖子的筛选用途，不是整个框架都由 Jev 驱动。

## 全量检查范围

| 数据集 | 仓库数 | 语言版本 | 生成并核对的最终 HTML | 静态文件一致性 | 错误 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 生产目录快照 | 5,151 | 15 | 77,265 | 不适用 | 0 |
| 仓库内构建快照 | 3,906 | 15 | 58,590 | 3,906 个英文回退文件 | 0 |

生产数据来自只读的 `/catalog.json`，目录版本为 `254a8d14-279b-462f-b175-9accc1669d0c`，源更新时间为 `2026-09-30T05:54:46.000Z`。这次检查使用该快照通过新渲染器生成 HTML，不表示这些新页面已经在线，也不是对 Google 索引的检查。

每种语言都拥有 5,151 个互不重复的 Title 和 5,151 个互不重复的 Description。检查还覆盖了 H1 数量、项目名位置、占位符、canonical、16 个语言 alternate（含 x-default）、可索引状态、可见摘要、Open Graph、Twitter 和 JSON-LD 描述的一致性。

详细结果位于本地：

- `reports/project-seo-live/summary.json`：生产快照验收统计及 15 种语言示例。
- `reports/project-seo-live/metadata.ndjson`：77,265 行逐页改前 / 改后文案；旧文案按旧模板与同一数据快照重建。
- `reports/project-seo-live/review.ndjson`：待补充用途、超长标题和源分类冲突。
- `reports/project-seo-static/summary.json`：静态构建验收结果。

这些报告由 `npm run audit:project-seo` 重新生成，保存在 Git 忽略的本地 `reports/` 中。全量检查也已接入 CI。

## 通过的验证

- `npm run build` 成功。
- `npm test`：117 / 117 通过。
- 两套数据的逐仓库、逐语言元数据验收全部通过；英文静态回退与动态生成一致。
- Pages Functions 编译成功；同步 Worker 的 `--dry-run` 编译成功，没有执行部署。
- 真实 Python SDK 的四个示例及文档分类示例通过离线验证。系统 Python 未装 SDK，验证使用现有的 `.cache/sdk-test-env`（`typesafe-sdk==0.7.1`）。
- `git diff --check` 通过。

## 仍须区分的内容质量问题

1. **612 个仓库没有简介。** 共有 2,597 个仓库使用事实性类别摘要，这个数字包含缺简介的仓库，以及用途未被当前词表可靠识别的简介。所有这些页面已经应用新规则，但不能称为逐仓库补齐了独立功能说明。原始简介和来源引用继续可见，复查清单记录了具体仓库。
2. **330 组同名项目。** 新规则使用标题末尾的作者消歧；动态查询包含未归档但仍有效的仓库，排除已撤回的条目。
3. **18 个源分类冲突。** 某些目录或 benchmark 被旧数据标为本地替代。详情页按简介中明确的项目性质修正显示，并保留复查标记。D1 原记录、列表过滤等上游分类仍应通过正常数据纠错流程统一。
4. **少数标题超过编辑长度阈值。** 英文为 17 个；其它语言统计在报告中。为保留完整项目名、用途和必要作者，未进行生硬截断。Description 全部在本次编辑预算内。长度阈值不代表 Google 的硬限制。
5. **语言检查为模型审核。** 15 种语言的句式和词表完整，但未声称通过人工母语审核或各地区实时搜索量验证。

## 生产生效与效果验证

本报告生成时尚未提交、推送或部署，也未请求搜索引擎重新索引。生产发布需要包含新的 Pages 代码和常规迁移流程中的 `0007_project_name_lookup.sql`；新增仓库之后会直接使用相同规则，无需逐条重写数据库 SEO 字段。

发布后才能通过 GSC 核实抓取版本、索引、查询与详情页对应关系及 CTR。TDH 改善的是页面表达与匹配依据，不能据此宣布所有仓库都会被索引、获得排名或超过 GitHub。
