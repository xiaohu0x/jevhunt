# JevHunt 搜索意图与内容规划

规划日期：2026-09-29。依据：项目所有者提供的 Search Console 查询样本。

原始查询、工作表地址、点击、展示、CTR 和排名数据保留在本地审计资料中，不发布到公开仓库。本文件保留内容意图与目标页面；`gsc-intent-plan.json` 的匿名行号供自动测试检查映射完整性。

查询与页面是不同聚合维度。本规划不代表逐查询落地页归因，也不代表搜索量或排名承诺。

| 意图组 | 用户任务 | 内容入口 |
| --- | --- | --- |
| official | 找到官方网站、注册、文档和状态入口 | /faq/#official-site |
| download | 下载客户端、SDK，区分云端模型与本地安装 | /faq/#download |
| fundamentals | 理解 Jev、System One、state 和结构化决策 | /blog/what-is-jev/ |
| examples | 找到 cookbook、应用示例、showcase 和 playground | /blog/jev-cookbook-use-cases/ |
| local-models | 比较独立本地决策模型、开放权重和 CPU/MLX 部署 | /blog/jev-local-alternatives/ |
| adapters | 把已有 LLM 包装成 Jev 风格接口 | /blog/jev-local-alternatives/#adapters |
| agent-routing | 在编码 Agent 中路由模型、工具、技能和任务 | /blog/jev-coding-agent-integrations/ |
| codex | 选择 Jev 与 Codex 的集成方式 | /blog/jev-coding-agent-integrations/#codex |
| opencode | 理解 OpenCode 插件和 Jev 决策层 | /blog/jev-coding-agent-integrations/#opencode |
| hermes | 寻找 Hermes 技能、工具和模型路由集成 | /blog/jev-coding-agent-integrations/#hermes |
| pi-omp | 理解 Pi/Oh My Pi 模型路由和工具审批 | /blog/jev-coding-agent-integrations/#pi-omp |
| sdk | 使用 SDK、CLI 和类型化框架接入 Jev | /blog/jev-api-sdk-guide/#sdk |
| providers | 区分 TypeSafe API、OpenRouter Decisions、模型路由及 Google/Vertex | /blog/jev-api-sdk-guide/#providers |
| compaction | 选择上下文裁剪和压缩方案并保留必要信息 | /blog/jev-context-compaction/ |
| sql | 在 Snowflake 和 DuckDB 内做语义分类及筛选 | /blog/jev-sql-snowflake-duckdb-neo4j/#sql |
| graphs | 使用 Neo4j、知识图谱和实体关系决策 | /blog/jev-sql-snowflake-duckdb-neo4j/#graphs |
| retrieval | 语义代码搜索、RAG 重排和资料筛选 | /blog/jev-semantic-search-rag/ |
| classification | 设计文档分类、标签和人工复核流程 | /blog/jev-document-classification/ |
| guardrails | 工具审批、PII 检测和风险判定 | /blog/jev-guardrails-permissions/ |
| benchmarks | 查找 JevBench/Arena，比较准确率、校准、延迟和成本 | /blog/jev-benchmarks-evaluation/ |
| computer-use | 理解浏览器、视觉和语音控制的外层工具链 | /blog/jev-computer-use-games/#computer-use |
| robotics | 查看具身控制和机器人决策实验 | /blog/jev-computer-use-games/#robotics |
| games | 查看 Doom、Pokemon、Snake、Mario 等游戏 Agent | /blog/jev-computer-use-games/#games |
| desktop-mobile | 找到桌面、手机、Jarvis、聊天和办公客户端 | /blog/jev-desktop-mobile-apps/ |
| ui | UI 组件、调用可视化和浏览器扩展 | /blog/jev-desktop-mobile-apps/#ui |
| trading | 理解交易项目架构和研究局限 | /blog/jev-trading-projects/ |
| research | 理解 JEPA 组合实验、模型能力及 AGI 说法的证据边界 | /blog/jev-benchmarks-evaluation/#research |
| unresolved-entity | 找到名称不明确的 GitHub 项目，先核对实体 | /faq/#find-a-project |

项目名查询优先由仓库详情页承接；专题文章负责选择、解释和工作流问题。不同任务的本地化 FAQ 不声明互译 hreflang。无法核实的实体通过现有发现入口处理，不凭关键词编造内容。
