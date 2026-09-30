# 仓库详情页 Title、Description、H1 规则

版本：2026-09-30 / `project-intent-v1`。适用于现有和新增的全部有效仓库，以及全部 15 个语言版本。

## 目标与搜索意图

用户搜索项目时，通常首先识别项目名称和任务。本站优先承接「项目名 + Jev」「项目名 + Jev 接入」「项目名 + 用途」等查询。纯项目名查询通常也有查找 GitHub、官网的导航意图；目录页应提供与 Jev 有关的清晰解释和可检查的来源，不能承诺排在原仓库之前。

以 TradingAgents 为例，`TradingAgents Jev`、`Trading Agents Jev`、`TradingAgents Jev integration` 是合理的查询假设。它们不是已测得的搜索量或逐页 GSC 查询。保留正式名称 `TradingAgents`，不把 `trading agnets` 等错拼塞进标题，也不创建仅更换拼写的重复页面。

## Title

1. **项目名在最前面**，保留仓库或已核实品牌名称的拼写。默认不使用 `owner/repo` 开头。
2. 应用和集成使用「项目名 + Jev + 具体用途」，例如 `TradingAgents + Jev — Multi-Agent Trading | JevHunt`。名称已含 Jev 时，避免重复追加 Jev。
3. SDK 使用「项目名 + 编程语言 + SDK + Jev」。只有目录已有官方来源证据时，才加「官方」。
4. 本地替代使用「项目名 + Jev 本地替代方案」，不能暗示它调用 Jev 云端 API。研究和资源目录分别使用研究、评测、资源类表述。
5. 同名仓库在标题末尾、站点品牌之前加作者，例如 `… (owner) | JevHunt`。活跃目录中没有同名项目时，不占用这个位置。大小写不同也按同名处理；撤回的仓库不参与消歧。
6. 用途来自仓库简介中的明确描述或有来源的编辑配置。作者名、Star 数、推荐项目、孤立的代码示例都不能拿来推断项目用途。
7. 不堆砌「最佳、免费、最快、教程、下载」。未核实的性能和收费信息不写入元数据。
8. 76 个显示单位是本项目的**编辑检查阈值**，不是 Google 的字符限制或像素测量。宽文字计 2，普通字符计 1，组合附加符号计 0。超长标题进入复查清单，不截断品牌名称。

## Description

结构为「项目是什么 / 已核实用途 + 真实 Jev 关联 + 页面能提供的下一步」。下一步必须与页面实际内容一致：源码、关联依据、同类项目；没有安装步骤时不能用「完整安装教程」吸引点击。

TradingAgents 的已核实范围是：多智能体交易框架，可选用 Jev 筛选 StockTwits 和 Reddit 帖子，再交给 Sentiment Analyst 阅读。不能写成整个交易系统由 Jev 驱动，也不能暗示盈利或实测性能。

英文示例：

> TradingAgents is a multi-agent trading framework with optional Jev screening of social posts. Explore the Jev references, Python source code and similar projects.

简体中文示例：

> TradingAgents 是多智能体交易框架，可选用 Jev 筛选社交帖子。查看 Jev 关联依据、Python 源码与同类项目，判断是否适合你的需求。

描述优先保留项目身份、用途及重要限定词。长度预算不足时，替换为完整的短句，不用 `slice(0, 160)` 切断句子、Unicode 字符或含义。归档状态会明示。编程语言未知时使用自然的「源码」表述，不输出 `unknown`。

简介为空、过于简略或暂时无法可靠识别用途时，采用已知类别、关系和源码信息生成当地语言的事实性摘要，并标记 `needs-specific-description`。这是待补充内容，不意味着仓库已逐项通过语义审核。不会据此新增 noindex。

## H1 与正文一致性

- H1 使用与 Title 相同的项目名和用途，不加站点品牌，也不把消歧作者重复塞入标题。
- 页面首段与 meta description 使用同一份本地化摘要。
- GitHub 原始简介单独标注为原文，保留完整内容供核对；源码引用保持原文。
- Open Graph、Twitter 描述以及结构化数据中的 description 与页面摘要一致。
- `SoftwareSourceCode.name` 保留项目实体名，不填整个 SEO 标题。

## 语言表达

每个语言版本有完整的用途词表、关系文案、句式和点击动机，不把 GitHub 的英文简介直接当作所有语言的 meta description。项目名、Jev、SDK、MCP、编程语言名称等技术实体保留原名。

| 版本 | TradingAgents 标题核心 | 常用关系表达 |
| --- | --- | --- |
| en | TradingAgents + Jev — Multi-Agent Trading | Integration / Local Alternative |
| zh-cn | TradingAgents + Jev：多智能体交易框架 | 接入 / 本地替代方案 |
| zh-tw | TradingAgents + Jev：多代理交易框架 | 串接 / 本機替代方案 |
| ja | TradingAgents × Jev｜マルチエージェント取引 | 連携 / ローカル代替モデル |
| ko | TradingAgents + Jev — 멀티 에이전트 트레이딩 | 연동 / 로컬 대안 |
| es | TradingAgents + Jev — Trading multiagente | Integración / Alternativa local |
| fr | TradingAgents + Jev — Trading multi-agent | Intégration / Alternative locale |
| de | TradingAgents + Jev — Multi-Agenten-Trading | Integration / Lokale Alternative |
| pt-br | TradingAgents + Jev — Trading com múltiplos agentes | Integração / Alternativa local |
| ru | TradingAgents + Jev — Мультиагентный трейдинг | Интеграция / Локальная альтернатива |
| hi | TradingAgents + Jev — मल्टी-एजेंट ट्रेडिंग | इंटीग्रेशन / लोकल विकल्प |
| id | TradingAgents + Jev — Trading multiagen | Integrasi / Alternatif lokal |
| vi | TradingAgents + Jev — Giao dịch đa tác tử | Tích hợp / Giải pháp thay thế chạy cục bộ |
| tr | TradingAgents + Jev — Çok ajanlı alım satım | Entegrasyon / Yerel alternatif |
| it | TradingAgents + Jev — Trading multiagente | Integrazione / Alternativa locale |

语言文案经过模型编写和检查，未声称经过母语人工审核。这里根据技术语言习惯选择表达，并未验证 15 个市场的搜索量、难度或 CTR。实际优化以按国家、语言、查询和页面划分的 GSC 表现继续验证。

## 实现与扩展

- `shared/project-seo.js` 是唯一生成器，动态路由和静态生成共同使用。
- `shared/project-seo-copy.js` 管理 15 种语言的完整句式与用途词表。
- `catalog/project-seo.json` 只记录有来源、日期的编辑补充。TradingAgents 的具体用途摘要还要求当前证据片段继续支持相应功能，否则退回普通摘要。
- 生产详情页读取实时 D1 数据，新增仓库自动使用规则，无需逐条写入 SEO 字段。`0007_project_name_lookup.sql` 为同名查询添加索引。
- 构建生成英文静态回退；其他语言继续由已有动态详情路由生成。URL、canonical、15 个语言版本的 hreflang 和可索引状态保持原有策略。
- 摘要忠实度仍依赖源简介和关系分类。如果仓库简介过时或分类错误，应修正 `catalog/overrides.json` / 证据采集，并加入有来源的精确编辑说明；不能只为了关键词改关系标签。
- 对一种已观察到的旧分类冲突做显示修正：简介明确自述为目录或基准测试，却被旧数据标成「本地替代」。详情标题、摘要、关系事实与 schema 按明确用途显示为资源或研究，同时记录 `source-relationship-conflict` 供上游数据复核。这不会写入 D1；目录列表及筛选中的历史分类仍应在后续同步时修正。

## 验证与验收

```sh
npm run build
npm test
npm run audit:project-seo -- --static
npm run audit:project-seo -- --catalog /path/to/live-catalog.json --out reports/project-seo-live
npx wrangler pages functions build functions --outdir=.cache/functions
```

审计逐仓库、逐语言生成最终 HTML，检查 Title、Description、H1、可见首段、结构化数据、社交元数据、canonical、hreflang、重复元数据与未展开占位符。`--static` 还核对每一个英文构建产物与动态生成结果。报告包含 `summary.json`、逐页改前/改后 `metadata.ndjson` 和 `review.ndjson`。

测试覆盖现有与新入库数据、同名跨类别仓库、撤回与改名、缺失简介、归档状态、语言完整性、注入转义，以及源码限定条件改变后的安全回退。

## SEO 依据与实际效果判定

- [Google：标题链接](https://developers.google.com/search/docs/appearance/title-link)：描述准确、简洁，避免空泛模板和关键词堆砌；标题与主要内容语言一致。Google 也会参考 H1、可见内容和链接文字。
- [Google：搜索摘要](https://developers.google.com/search/docs/appearance/snippet)：大型数据库型站点可以程序化生成准确、独特的描述；摘要可能取自正文，并可按查询改写。
- [Google：多语言站点](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)：仅翻译界面而保留主要内容原语言不足以建立良好的本地化体验。
- [TradingAgents 固定提交的 README](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/README.md)：具体用途及可选 Jev 社交帖子筛选的事实来源。

以上资料于 2026-09-30 读取。直接搜索请求没有取得可审核的完整 Google SERP，不能把查询假设写成已观察排名。仓库内已有的 2026-09-29 GSC 记录可用于优先级参考，但其查询表和页面表不能被拼成未经提供的 query-page 对应关系。

代码与全量 HTML 验收证明规则生效，不证明 Google 已抓取、索引或提升排名。上线后应以项目详情路径为筛选条件，观察实体词 + Jev 查询对应的落地页、展现、CTR 和位置；同时检查 URL Inspection 的抓取版本、canonical 和索引状态。
