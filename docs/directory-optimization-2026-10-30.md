# JevHunt 目录站优化诊断与对标方案

审计日期：2026-10-30。基线：生产站 `https://jevhunt.com`、`/api/catalog?all=1`、`/api/catalog/status`、`/sitemap.xml`，以及本地 headless Chrome（CDP）实测。本文是分析与实施方案，不代表建议都已上线；文中数字除特别注明外均为当日实测，实验室数据不能替代真实用户 CWV 或 GSC 数据。

## 0. 总结：先做三件事

1. **把"分类"变成真正的导航层。** 现在首页没有任何一个 `/categories/` 链接，`/categories/` 索引本身是 404，5,223 个项目（55%）挤在 `apps` 一个桶里；795 个分页页里有两套几乎相同的全量列表（`/` 与 `/browse/`）。
2. **收敛薄页。** 9,470 个项目页里只有约 100 个有编辑内容；15 种语言把可发现的 URL 放大到约 14.3 万，其中约 98% 是"本地化 UI + 英文原文"的模板页，且全部可索引。
3. **让"发现"真正可用。** 默认按 star 排序，第一屏是 143k star 的 awesome list 和 no-Jev 关联的列表仓库；搜索单次要 2–3 秒且不支持前缀（`classif` 搜不到 `classification`）。

做完这三件，再上 `/alternatives`、`/best`、用例页和边缘缓存，收益会叠加而不是互相抵消。

## 1. 实测基线

| 指标 | 实测值 | 证据 |
| --- | --- | --- |
| 收录项目 | 9,470 | `/api/catalog/status`、`?all=1` |
| 分类分布 | apps 5,223（55.2%）· agents 2,259（23.9%）· research 774 · browser 399 · games 264 · sdks 250 · lists 132 · demos 112 · integrations 53 · official 4 | `/api/catalog/status` |
| Star 分布 | 中位数 **0**；0 star 4,991（52.7%）；<5 7,831（82.7%）；<10 8,414（88.9%）；≥100 仅 143 | `?all=1` 计算 |
| 描述完整度 | 空描述 1,982（20.9%）；<40 字符 2,736（28.9%） | `?all=1` 计算 |
| 编辑内容 | 100 个项目有 4 段解释 + 15 语言正文（约 1.1%） | README、`content/projects/` |
| 可发现 URL | 项目页 9,470；15 语言合计约 14.2 万；分页 795（`/browse/` 395 + 分类 400）；blog 19 | sitemap 11,652 条 + hreflang 集群推算 |
| sitemap | 11,652 条 / 1.2 MB；每个非英语语言仅约 96 条项目 URL | `/sitemap.xml` |
| 搜索延迟 | 2.1–3.1 s（跨网络单次样本）；`classif`→0 条、`browser agent`→72、`decision`→886 | `/api/catalog?q=` |
| HTML 缓存 | `cf-cache-status: DYNAMIC`；首页 TTFB 1.4–2.2 s（单次样本） | 响应头 |
| 首屏 TTFB / LCP / CLS | 桌面 LCP 0.84 s / CLS 0.010；移动 lab LCP 3.0 s / CLS 0.067（冷缓存样本 LCP 6.7 s） | CDP 实测 |
| 缺失路由 | `/categories/`、`/submit`、`/alternatives`、`/compare`、`/best`、`/llms.txt` 均 404；无 RSS/newsletter | 直接请求 |
| 数据新鲜度 | `syncedAt` 2026-10-28T10:14Z；`discoveryStatus=degraded`；`checked24h=0`、`checked72h=1,197`（12.6%）；worker 最近错误 `HTTP 502 /search/repositories` | `/api/catalog/status` |

方法：`curl` + 无头 Chrome 通过 CDP 采集 LCP/CLS/资源与溢出；`/api/catalog?all=1` 做分布统计；单次网络样本只用于发现方向，不作 SLA。

## 2. 结构性瓶颈

### 2.1 有列表，没有导航层

- **分类页近乎孤儿。** 首页分类 chips 是 JS 过滤（`href="#categories"`），首页对 `/categories/<slug>/` 的链接数为 **0**；`/categories/` 索引 404；footer 只有指南、方法、隐私。项目页仅在面包屑里链到 1 个分类。400 个分类分页 URL 主要靠 sitemap 被发现。
- **两套全量列表。** `/`（20/页，474 页）与 `/browse/`（24/页，395 页）内容相同且各自 self-canonical，形成 795 个近似重复页。
- **taxonomy 太浅。** 55% 在 `apps`，一个分类 218 页；没有子类、标签、用例维度。用户只能"按 star 翻页"，这更像 GitHub 搜索，而不是目录。
- **默认排序与定位冲突。** 第 1 名 `awesome-llm-apps`（Resource/directory，143k star）、第 4 名 `chinese-independent-developer`，都不是 Jev 项目；真正的集成（TradingAgents、GPT Researcher、AgentScope）排在后面。页面标题说"Find JEV AI projects you can verify"，首屏却在展示泛 AI 列表。
- **卡片信息不足。** 无 logo/截图；描述被截断且中英混杂；star 数字无单位；"Check pending" 语义不明；分类徽章不可点。

### 2.2 99% 的页面是模板

- 非 reviewed 项目页实测约 611 词，含导航/facts/相似项目，真正独有文字约 100–150 词加上仓库一句话（例：`/projects/pyjalal/monash-hack/`）。
- 15 语言 × 9,470 ≈ **14.2 万**项目 URL 全部返回 200；非英语页只有本地化 UI 和模板句（例：`/de/projects/pyjalal/monash-hack/` 的正文是德语的"Jev 应用、查看证据"模板）。
- sitemap 只收录每个语言约 96 条已审校页（做法正确），但**每个项目页的 hreflang 集群和语言切换链接暴露了全部 14.2 万 URL**，且没有 `noindex`。爬虫会发现并抓取大量近似空页。
- 这是当前最大的站点级质量风险：Google 的 scaled content 政策针对的正是"批量生成、缺少独立价值"的页面。相比之下，"少收录"的代价小得多。

建议分层，而不是一刀切：

| 层 | 条件 | 索引策略 | 页面应有 |
| --- | --- | --- | --- |
| Reviewed | `content/projects/` 有记录 | 索引；15 语言 | 编辑正文、证据、限制、上手方式 |
| Verified | 有证据 + 有效描述 + 近期活跃 | 索引（英文 + 有正文的语言） | README 摘要、安装命令、license、最近核验 |
| Auto | 其余 | `noindex,follow`，保留站内搜索/浏览 | 基础 facts + 外链，不参与索引 |

同时：非英语页在没有本地化正文时 canonical 到英文、从 hreflang 集群移除；sitemap 只列可索引页。

### 2.3 搜索能用，但不够好

- 2–3 秒才出结果，首查体验接近"卡住"；目录只有 9.4k 行，这个延迟来自 `LIKE '%term%'` + 拼接字段 + `json_extract` + 子查询 + 每次 `COUNT(*)`。
- **不支持前缀**：`classif` 搜不到 `classification`；没有拼写容错、同义词、搜索建议。
- 筛选有 URL 状态（好），但没有 facet 计数，用户不知道每个条件会剩多少；空结果也没有推荐替代词。
- 相关代码：`shared/catalog-query.js`（`filters`/`searchOrder`）、`functions/api/catalog.js`、`public/assets/js/main.js`。

### 2.4 缺高意图页面

- 404：`/categories/`、`/submit`、`/alternatives`、`/compare`、`/best`、`/llms.txt`；没有 RSS。
- 现有 19 篇 guide 是唯一内容层；缺少目录站最吃流量的三类页：**替代方案**（"X alternatives"）、**用例/任务**（"best Jev tools for browser automation"）、**榜单**（"Top Jev projects this month"）。
- 项目页的 Similar projects 只用于展示，没有"compare"入口，也没有"Best alternatives"落地页承接这批长尾意图。

### 2.5 提交与留存闭环未建立

- 提交是首页 OAuth modal（`#submit`），没有独立 `/submit` 落地页：外链、搜索、社媒无法直达；也无法解释审核标准、时限、是否收费。
- 没有 newsletter/RSS/收藏/claim/embed badge；"Verified" 状态没有对应的用户权益说明。
- 顶部 GUIDE 横幅指向 `omniakey.com` 第三方博客，且与"Independent from TypeSafe AI"并列出现，容易被读成广告位；若要保留，建议标 `sponsored` 或换成自家指南。

### 2.6 性能与新鲜度

- **HTML 没进边缘缓存。** 响应头有 `s-maxage`，但 `cf-cache-status: DYNAMIC`；API 用了 Cache API，HTML 没有。每次访问都读 D1 + 重渲染，TTFB 1.4–2.2 s。
- **资源串行。** 首页 6 个 JS（locales/data/projects/analytics/main/project-card）+ 3 个 CSS + 4 个字体，没有 preload；移动冷样本 DCL 12 s，主要是一串 RTT。
- **CLS 0.067** 来自筛选 chips 的晚期布局（移动端两次 0.0335 位移）；桌面基本为 0。
- **新鲜度承诺没有兑现。** 首页写 "Last updated Oct 28"（今天 Oct 30）；`checked24h=0`，72 小时只覆盖 12.6%；`discoveryStatus=degraded`。候选池 19,794 条 ready，但最近 20 轮 `checked=0 / published=0`，且全部是 GitHub Search 轮次——发现与核验脱节（推断为限流/配额或队列处理问题，需查 worker 日志）。
- 健康检查仍可能因为"心跳新鲜 + 单源成功"显示 ok，掩盖了"24 小时没有任何项目被核验"。

### 2.7 一次未复现的串页

首次抓取 `/projects/browser-use/jev-ultrafast/` 时，`<title>` 是该项目，但 canonical 和 description 指向 `/projects/tauricresearch/tradingagents/`。随后 24 次并发 + 多次抽查未复现。建议排查 `renderProject` 的请求级缓存/全局状态，或边缘缓存键；这类串页对 SEO 是灾难性的，即使概率很低也值得加断言与日志。

## 3. 对标：六个可复制的机制

| 机制 | 代表站 | 做法 | JevHunt 怎么用 |
| --- | --- | --- | --- |
| 替代方案页 | Uneed `/alternatives/{slug}`；DevHunt 的 compare sitemap（实测 1,824 条） | 每页 8–12 个候选 + 对比表 + FAQ + `ItemList`/`SoftwareApplication`/`Offer`/`FAQPage` | 用现有 "similar projects" 查询扩展；只对 Reviewed/Verified 开放，先做 200–500 页 |
| 分面即页面 | TopAI `/category/{slug}/{free\|opensource\|...}`；Futurepedia 两层分类带计数 | 把筛选组合做成可抓取的稳定 URL | `/categories/<cat>/official`、`/local`、`/python` 等，先开放有量的组合 |
| 任务优先 | There's An AI For That `/tasks/`、`/task/{slug}` | 用户按"要做的事"而不是"产品类型"找工具 | 从证据文本抽 15–25 个任务标签：browser automation、routing、classification、RAG、trading、code review… |
| 榜单/日历 | Product Hunt `leaderboard/{period}/{date}`；Peerlist `week/44` | 时间维度让内容持续更新、可被反复引用 | `/best/<use-case>` 月度更新 + 变更说明；"New this week" |
| 提交闭环 | Uneed 免费队列 + $39.99 加速 + badge/backlink 分级；ai-bot.cn ¥399 含文章 + 48h；Awwwards 收费评审 | 免费收录是内容引擎，付费买"速度/曝光"而不是"收录" | `/submit` 落地页 + 48h SLA + Verified badge + embed badge（先免费） |
| 策展/合集 | Godly、Minimal Gallery、Product Hunt Collections | 人工策展的集合比全量列表更有分享价值 | "Browser agents on Jev"、"Local alternatives"、"Jev for games" 等 10–15 个合集 |

四类站点的共同点：**没有一家靠"全量列表 + 翻页"取胜**。它们卖的是任务入口、对比关系、策展和持续更新。JevHunt 已有的证据链和 15 语言是差异化资产，但需要被组织成用户能完成任务的路径。

## 4. 路线图

### P0（一周内，改动小、直接收益）

| # | 动作 | 改动位置 | 验收 |
| --- | --- | --- | --- |
| 1 | 新增 `/categories/` 索引（10 类 + 计数 + 一句说明 + 链到分类分页）；header/footer 加"分类"；卡片分类徽章改为链接 | 新 `functions/categories/index.js`；`shared/render.js` / `shared/catalog-view.js`；`public/assets/js/main.js` | 首页到分类点击路径存在；404 变 200；分类页收录 |
| 2 | 默认排序改 "Featured"：证据等级 → 近 90 天活跃 → `log(stars)` → 编辑加权；保留 stars 选项；加 "New"；`Resource/directory` 单独 tab 或默认折叠 | `shared/catalog-query.js` 的 `SORT_SQL`；`main.js` 排序 UI | 首页第一屏不再被 awesome list 占据；新旧项目都有曝光 |
| 3 | 薄页治理：非英语且无本地化正文 → `noindex,follow` + canonical 英文 + 移出 hreflang；sitemap 同步 | `functions/[locale]/projects/...`、`functions/_lib/catalog-pages.js`、`shared/render.js`、`functions/sitemap.xml.js` | GSC 中薄页索引占比下降；hreflang 集群只含真实对应页 |
| 4 | 搜索前缀/模糊：`term*` 前缀匹配（FTS5 或 `LIKE 'term%' OR '% term%'`），COUNT 缓存/近似；热门查询进 Cache API | `shared/catalog-query.js`、`functions/api/catalog.js` | `classif` 能命中；P95 < 500 ms |
| 5 | `/browse/` 与 `/` 去重：首页做精选/最新/分类入口，全量列表归 `/browse/`；或 `/browse/` canonical 到 `/` | `functions/index.js`、`functions/browse/[[page]].js` | 两套全量列表不再同时 self-canonical |
| 6 | 性能：HTML 走 `caches.default`（或 Cache Rule）；合并 JS/CSS；preload 首屏字体；GA 延后 | `functions/_lib/catalog-pages.js`、`shared/catalog-view.js`、`public/assets/` | TTFB p75 < 300 ms；移动 LCP < 2.5 s；CLS < 0.05 |

### P1（2–4 周）

7. `/alternatives/<slug>`：基于现有 similar 查询，8–12 个候选 + 对比表 + FAQ + 结构化数据；只对 Reviewed/Verified 开放，避免一次生成 9.4k 薄页。
8. 分面路由 `/categories/<cat>/<facet>`：先做 10 类 × 4 个高价值 facet（official、local、按语言、按类型），带自引用 canonical。
9. 项目页升级：logo（GitHub avatar/OG）、安装命令、README 摘要、license/pricing、最近核验时间、claim、report、compare。
10. `/submit` 落地页 + 48h 审核 SLA + Verified badge + embed badge。
11. newsletter/RSS + "本周新增"（用 `added`/`pushed` 自动生成）。
12. 用例标签与 `/use-cases/<task>/` 页（先 15–25 个任务）。

### P2（1–2 月）

13. `/compare/a-vs-b`（每项目 2–3 个近邻，先不进 sitemap）。
14. `/best/<use-case>` 月度榜单 + 更新日志。
15. `/llms.txt` + 公开 JSON API 文档 + MCP server（让 AI 助手能引用目录）。
16. 本地化收敛：只翻译分类中心页 + Top 100；其余语言 UI-only + `noindex`。
17. 商业化：先 $19–49 加速审核；有流量后再做分类赞助（明确标注 sponsored）。

## 5. 指标

- **索引质量**（GSC）：按模板（首页/分类/项目/alternatives）的已编入、展现、点击、CTR；薄页索引占比目标 < 10%。
- **发现效率**：搜索成功率、零结果率、筛选使用率、详情→GitHub CTR、提交转化（GA4 已有 `search`/`project_open` 等事件，需补 `search_no_results`、`filter_change`、`recommendation_click`）。
- **数据健康**：`checked24h`/`checked72h` 覆盖率、每周新增发布数、候选积压年龄；`/api/health` 应在 24h 零核验时降级。
- **性能**（RUM，不只看 lab）：TTFB p75 < 300 ms、LCP p75 < 2.5 s、CLS < 0.05。

## 6. 不要做

- 不为 URL 数量批量生成 15 语言薄页或全部筛选组合页。
- 不买目录外链、不做群发提交。
- 不用 star 当质量分，不把 awesome list 与真实集成混排。
- 不在没有流量前卖置顶；先做免费收录 + 加速审核。
- 不用"9,470 个项目"当唯一卖点——其中 52.7% 是 0 star，"可验证"才是差异。

## 7. 方法与限制

- 采集：`curl`（HTML/headers/sitemap/API）、无头 Chrome + CDP（LCP/CLS、资源、布局分析）、`/api/catalog?all=1` 全量统计。
- 网络样本为单次跨公网请求，含本地网络与地理位置影响，不能当作 SLA 或 field CWV。
- 未读取 GSC/GA4 数据，因此本文不声称任何关键词的搜索量、排名或现有自然流量。
- 对标站的机制与价格来自其公开页面（2026-10-30 抓取）；具体价格会变，引用时以对方页面为准。
- 本文与 `docs/seo-ux-audit-2026-09-29.md` 不冲突：那份方案里的服务端分页、D1 搜索、SSR 深链已上线；本文聚焦"目录 IA、内容分层、对标增长机制"和 2026-10-30 的新观测。

## 8. 实施记录（2026-10-30，代码与本地验证）

以下为按本方案落地的第一批改动。**未部署生产**；生产仍是旧版本，部署前需要 Cloudflare 凭证。

### 已完成

- **#1 任务入口**：新增 `catalog/tasks.json`（20 个任务）、`/tasks/` 与 `/tasks/<id>/` 分页页、`/categories/` 索引页；首页改为「搜索 → 任务 → 编辑精选 → 新增/核验 → 分类 → 全量列表」；导航、页脚、`page()` 模板加入 Tasks/Categories 真实链接。
- **#2 可信推荐**：`shared/catalog-featured.js` 定义 Featured 集合与证据优先排序；首页精选 6 个项目，`Directories & Lists` 不再进入精选；卡片增加 Verified 徽章、证据等级文案和核验状态。
- **#3 项目页决策化**：logo、证据/关系/归档/待核验徽章、license/语言/更新时间/星数/核验日期摘要、任务 chips、Before you build 提示、非编辑项目提供 clone 命令与 README 入口、格式化日期、Alternatives 入口、报告问题入口；CSP 允许 GitHub 头像。
- **#4 搜索**：支持前缀匹配（`classif` → classification），精确词优先于前缀扩展（`jev paper` 排序保持稳定）；分类筛选显示计数；首屏增加热门任务快捷入口；空结果增加任务入口与提交入口。本地 API 50–120 ms。
- **#5 对比与替代**：`/alternatives/<owner>/<repo>/`（对比表 + 10 个替代项目 + FAQ + CollectionPage/ItemList/FAQPage 结构化数据，评测/精选项目生成静态页并进入 sitemap）、`/compare/?ids=...`（2–3 个项目、noindex）、项目页 Alternatives 按钮；本地生成 188 个 alternatives 页面。
- **#6 首屏速度（部分）**：匿名 HTML 走 Cache API（首页 120 s、项目页 300 s、列表 120 s），命中后本地 TTFB 3–4 ms（未命中 130 ms）；首屏字体 preload；`public/_headers` 的 CSP 同步允许 GitHub 头像。

### 验证

- `npm run build` 通过；`npm test` 171 个测试全部通过。
- 本地 `wrangler pages dev`：`/`、`/categories/`、`/tasks/`、`/tasks/classification/`、`/alternatives/browser-use/jev-ultrafast/`、`/compare/?ids=...` 均 200；Cache 命中响应头 `x-jh-cache: hit`。
- 390 px 移动端 `scrollWidth=390`，无横向溢出；新任务网格 2 列可读。
- sitemap 去掉重复生成项后保持幂等，并加入分类/任务/alternatives 页面；`/compare/` 刻意不进 sitemap。

### 第二批（回访、移动、供给侧）

- **#7 回访机制**：`catalog/collections.json` 定义 12 个规则型策展合集（官方、SDK、浏览器代理、本地替代、研究、Coding agents、交易、RAG、游戏、Demo、Agent 工具、应用）；新增 `/collections/` 与分页合集页；动态 `/rss.xml`（最近收录 20 条，边缘缓存 300 s）；导航与页脚加入 Collections / RSS。
- **#8 移动密度**：移动端任务卡只展示 8 个、精选 4 个、新增 4 条（保留「全部」入口）；列表默认 12 张卡 +「Show all on this page」展开；`dir__meta` 吸顶；hero、卡片、描述收紧。390 px 下页面高度从 11,037 px 降到 8,647 px。
- **#9 提交与认领**：独立 `/submit/` 页（收录范围、审核内容、两个工作日目标、免费与不卖排名、claim 流程、badge 嵌入代码）；项目页增加 Claim this listing；新增 `/badge.svg`。

### 第三批（发布榜与首页改版）

借鉴 Product Hunt 的组织方式：按发布日分组、同一天内排名、首页只放达到门槛的发布、每天都能翻到全量。票用 GitHub star，不自建投票。规则集中在 `shared/catalog-launches.js`。

- **什么算发布**：发布日是仓库 `created`（UTC）。必须 active、非 fork、未归档、日期合法、有描述，且分类不是 `lists`。其余仓库仍在目录里，只是不上榜。
- **首页榜单**：最近 3 个有项目达到门槛的发布日，每天最多 6 行，门槛 5 star（`LAUNCH_MIN_STARS`，`launch.lead` 和 `launch.empty` 的文案里也写了这个数字）；另列 30 天内 star 最多的 8 个，只重复日榜内容时隐藏。30 天窗口以最新发布日为锚点，发现管线停一周榜单也不会空。
- **发布量柱状条**：30 根柱，统计全部发布（含 5 star 以下）。最新发布在近 30 天内时截止到今天，没有发布的日子显示为空柱；更旧时截止到最新发布日，不会整条空白。
- **日页**：`/launches/<date>/[page]/` 与 `/<locale>/launches/...`，每页 50 个，列当天全部发布，`noindex`、不进 sitemap，缓存 300 s。`/launches/` 302 到最新发布日；没有数据或查询失败时回到首页 `#launches`。
- **与 §6 的关系**：star 只代表关注度，不是质量，所以标题写「star 最多」而不写「最佳」，每行同时显示关系标签和证据引用。awesome list 不算发布，按分类而不是关系判断，因为窗口内 88 个 list 里有 22 个的关系被标成了 `local-alternative`。
- **数据库**：`migrations/0010_launch_index.sql` 新增 `idx_catalog_created`，由 `npm run deploy` 里的 `db:migrate:remote` 执行。未命中缓存的首页多 4 条 D1 查询，首页 HTML 按语言缓存 120 s。
- **导航**：宽度 ≥1181 px 时单行显示，Model / Playbooks / Timeline 收到页脚和菜单；非英语访客的单行导航不显示纯英文页面的链接，这些链接仍在页脚。≤1180 px 时所有语言折叠进菜单，筛选仍在 ≤760 px 才折叠。
- **明确不做**：站内投票、评论、付费位、发布日倒计时。站内投票需要账号和防刷，流量不足时只会出现一排 0 票；付费位与 §6 冲突。

### 仍待完成 / 明确未做

- 首页和日页的发布行会让访客浏览器向 GitHub 请求头像（背景图，不懒加载，日页最多 50 个）；隐私政策尚未说明这一点。
- `/privacy/`、`/terms/`、`/security/` 与 404 页仍是旧的深色主题；对比表的行标题仍是等宽大写。

- 生产部署与真实 RUM/GSC 验证；`project_content` 需要在生产 D1 发布后，项目页编辑正文才会出现在运行时（本地 seed 不含该表数据，静态构建包含）。
- newsletter 需要邮件服务商与隐私流程，本轮只提供 RSS 与「New and recently verified」。
- 资源合并（真正打包 JS/CSS）未做：当前用边缘缓存 + 字体 preload 降低首屏成本；CLS 未做现场测量。
- 项目截图未存储，项目页使用 GitHub 头像作为视觉标识；截图需要额外的媒体抓取与存储管线。
