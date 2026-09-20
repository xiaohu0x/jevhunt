/* ==========================================================================
   JevHunt — data layer
   Seed catalog. In the next phase this moves to a JSON file / CMS / API.
   ========================================================================== */

window.JH = window.JH || {};

/* ------------------------------ categories ------------------------------ */
JH.categories = [
  { name: "Coding Agents",   icon: "⌘", desc: "Context compaction, review, refactors", zh: "编码智能体" },
  { name: "Classification",  icon: "⩆", desc: "Intents, sentiment, triage, scoring",   zh: "分类" },
  { name: "Routing",         icon: "⑃", desc: "Agent branching & model selection",     zh: "路由" },
  { name: "Document AI",     icon: "▤", desc: "Invoices, contracts, forms, receipts",  zh: "文档智能" },
  { name: "Voice & Live",    icon: "◉", desc: "Real-time and conversational AI",       zh: "语音与实时" },
  { name: "Computer Vision", icon: "◨", desc: "Visual sorting, scoring, edge demos",   zh: "计算机视觉" },
  { name: "Data & Analytics",icon: "▦", desc: "Enrichment, labeling, pipelines",       zh: "数据与分析" },
  { name: "Automation",      icon: "⟠", desc: "Workflow gates & typed decisions",      zh: "自动化" },
  { name: "Playgrounds",     icon: "✢", desc: "Try Jev in the browser, no setup",      zh: "在线试验场" },
];

/* ------------------------------ apps ------------------------------------ */
/* status: live | beta | preview | recipe | wanted                            */
JH.apps = [
  {
    name: "fast-jev-compaction",
    author: "tamaratran",
    desc: "Claude Code plugin that uses Jev to decide which tool calls and results are still relevant. Keeps the useful context verbatim and drops what's stale.",
    cat: "Coding Agents", status: "live", signal: 98,
    tags: ["Claude Code", "Context", "Open source"],
    href: "https://github.com/tamaratran/fast-jev-compaction",
  },
  {
    name: "jevlike",
    author: "vinnylarouge",
    desc: "Jev-style visual scoring demos for Apple Silicon. Shared context, direct candidate scoring and a three-color product sorting experiment on edge hardware.",
    cat: "Computer Vision", status: "preview", signal: 91,
    tags: ["Edge AI", "Apple Silicon", "Open source"],
    href: "https://github.com/vinnylarouge/jevlike",
  },
  {
    name: "Intent Router",
    author: "JevHunt recipe",
    desc: "Turn unstructured input into a typed intent decision and branch your agent graph on the result — no prose parsing, no fallback strings.",
    cat: "Routing", status: "recipe", signal: 88,
    tags: ["mode: router", "Agents", "Classification"],
    href: "#playbooks",
  },
  {
    name: "Triage Lens",
    author: "community",
    desc: "Support-ticket triage with calibrated confidence. Act autonomously above your threshold, escalate the uncertain 12% to a human queue.",
    cat: "Classification", status: "beta", signal: 86,
    tags: ["Confidence", "Support", "Thresholds"],
    href: "#submit",
  },
  {
    name: "Invoice Classifier",
    author: "JevHunt recipe",
    desc: "Categorize invoices and route them into accounting workflows at scale. Structured fields land directly in your ledger schema.",
    cat: "Document AI", status: "recipe", signal: 83,
    tags: ["Accounting", "Extraction", "Batch"],
    href: "#playbooks",
  },
  {
    name: "Live Product Recommender",
    author: "community",
    desc: "Pair Jev with a live voice model to pick the right product mid-conversation and hand the agent a decision instead of a paragraph.",
    cat: "Voice & Live", status: "preview", signal: 80,
    tags: ["GPT Live", "Recommendations", "Real-time"],
    href: "#submit",
  },
  {
    name: "Schema Forge",
    author: "wanted",
    desc: "Generate TypeScript / JSON Schema definitions from a plain description of the decision you need. Not built yet — claim it.",
    cat: "Playgrounds", status: "wanted", signal: 76,
    tags: ["DX", "JSON Schema", "TypeScript"],
    href: "#submit",
  },
  {
    name: "Route Warden",
    author: "JevHunt recipe",
    desc: "A router-mode guard that inspects each step of an agent and decides whether to continue, retry or hand off to a stronger model.",
    cat: "Routing", status: "recipe", signal: 74,
    tags: ["mode: router", "Agents", "Cost"],
    href: "#playbooks",
  },
  {
    name: "Calibration Board",
    author: "wanted",
    desc: "Visualize how well-calibrated your Jev decisions are over time — bucket by confidence and track realized accuracy per decision.",
    cat: "Data & Analytics", status: "wanted", signal: 72,
    tags: ["Evals", "Calibration", "Dashboard"],
    href: "#submit",
  },
  {
    name: "Ledger Eyes",
    author: "community",
    desc: "Reconcile bank transactions with Jev-typed match decisions and a review queue for everything under your confidence floor.",
    cat: "Automation", status: "beta", signal: 70,
    tags: ["Fintech", "Matching", "Review queue"],
    href: "#submit",
  },
  {
    name: "DocGate",
    author: "community",
    desc: "Gate document pipelines on typed quality decisions: accept, reject or request a better scan, with a reason code attached.",
    cat: "Document AI", status: "beta", signal: 68,
    tags: ["Quality", "KYC", "Pipeline"],
    href: "#submit",
  },
  {
    name: "Browser Playground",
    author: "wanted",
    desc: "A zero-setup page to test classify, score and router modes right in the browser and share the results as a permalink.",
    cat: "Playgrounds", status: "wanted", signal: 66,
    tags: ["No-code", "Demos", "Share"],
    href: "#submit",
  },
];

/* ------------------------------ playbooks -------------------------------- */
JH.playbooks = [
  {
    id: "classify",
    label: "classify",
    file: "classify.py",
    mode: "mode · classify",
    desc: "Turn a free-text state into typed labels with a probability attached to every choice.",
    list: ["Declare your enum inline", "Read p= to set thresholds", "Batch states for throughput"],
    code: `<span class="tk-kw">import</span> typesafe

client = typesafe.<span class="tk-fn">Client</span>(api_key=<span class="tk-str">"jev_..."</span>)

decision = client.<span class="tk-fn">decide</span>(
    model=<span class="tk-str">"jev-1"</span>,
    state=support_ticket_text,
    questions={
        <span class="tk-str">"intent"</span>: [<span class="tk-str">"refund"</span>, <span class="tk-str">"bug"</span>, <span class="tk-str">"billing"</span>, <span class="tk-str">"other"</span>],
        <span class="tk-str">"needs_human"</span>: <span class="tk-kw">bool</span>,
        <span class="tk-str">"urgency"</span>: (<span class="tk-str">"score"</span>, <span class="tk-num">1</span>, <span class="tk-num">5</span>),
    },
)

<span class="tk-com"># → {"intent": ("refund", p=0.94),</span>
<span class="tk-com">#    "needs_human": (false, p=0.88),</span>
<span class="tk-com">#    "urgency": (4, confidence=0.91)}</span>`,
  },
  {
    id: "route",
    label: "router",
    file: "route.py",
    mode: "mode · router",
    desc: "Branch an agent graph on a single decision — continue, retry, or escalate to a stronger model.",
    list: ["One decision per hop", "Log the confidence", "Fail closed below 0.7"],
    code: `<span class="tk-kw">import</span> typesafe

client = typesafe.<span class="tk-fn">Client</span>(api_key=<span class="tk-str">"jev_..."</span>)

step = client.<span class="tk-fn">decide</span>(
    model=<span class="tk-str">"jev-1"</span>,
    mode=<span class="tk-str">"router"</span>,
    state=agent_transcript,
    questions={
        <span class="tk-str">"next"</span>: [<span class="tk-str">"continue"</span>, <span class="tk-str">"retry"</span>, <span class="tk-str">"escalate"</span>, <span class="tk-str">"stop"</span>],
    },
)

action, p = step[<span class="tk-str">"next"</span>]
<span class="tk-kw">if</span> p &lt; <span class="tk-num">0.7</span>:
    action = <span class="tk-str">"escalate"</span>   <span class="tk-com"># fail closed on uncertainty</span>`,
  },
  {
    id: "score",
    label: "score",
    file: "score.py",
    mode: "mode · score",
    desc: "Rank candidates directly instead of asking a model to write a review you then have to parse.",
    list: ["Score in a bounded range", "Compare, don't describe", "Sort in your own code"],
    code: `<span class="tk-kw">import</span> typesafe

client = typesafe.<span class="tk-fn">Client</span>(api_key=<span class="tk-str">"jev_..."</span>)

result = client.<span class="tk-fn">decide</span>(
    model=<span class="tk-str">"jev-1"</span>,
    mode=<span class="tk-str">"score"</span>,
    state=user_request,
    questions={
        <span class="tk-str">"fit"</span>: (<span class="tk-str">"score"</span>, <span class="tk-num">0</span>, <span class="tk-num">100</span>),
        <span class="tk-str">"reason"</span>: [<span class="tk-str">"price"</span>, <span class="tk-str">"speed"</span>, <span class="tk-str">"quality"</span>],
    },
)

ranked = <span class="tk-fn">sorted</span>(candidates, key=<span class="tk-kw">lambda</span> c: c.fit, reverse=<span class="tk-kw">True</span>)`,
  },
  {
    id: "extract",
    label: "extract",
    file: "extract.py",
    mode: "mode · extract",
    desc: "Pull a fixed set of fields out of messy input into a schema your database already understands.",
    list: ["Schema in, schema out", "Nulls are honest", "Validate before writing"],
    code: `<span class="tk-kw">import</span> typesafe

client = typesafe.<span class="tk-fn">Client</span>(api_key=<span class="tk-str">"jev_..."</span>)

invoice = client.<span class="tk-fn">decide</span>(
    model=<span class="tk-str">"jev-1"</span>,
    mode=<span class="tk-str">"extract"</span>,
    state=raw_invoice_text,
    questions={
        <span class="tk-str">"vendor"</span>: <span class="tk-kw">str</span>,
        <span class="tk-str">"total"</span>: <span class="tk-kw">float</span>,
        <span class="tk-str">"category"</span>: [<span class="tk-str">"software"</span>, <span class="tk-str">"travel"</span>, <span class="tk-str">"ops"</span>],
        <span class="tk-str">"paid"</span>: <span class="tk-kw">bool</span>,
    },
)

<span class="tk-kw">if</span> invoice.is_confident(<span class="tk-num">0.9</span>):
    db.<span class="tk-fn">insert</span>(<span class="tk-str">"invoices"</span>, **invoice.values)`,
  },
];

/* ------------------------------ timeline --------------------------------- */
JH.timeline = [
  {
    date: "D-0 · Launch",
    title: "TypeSafe AI introduces System One Models & Jev",
    desc: "After two years in stealth, Jev ships: typed decisions, calibrated confidence, and a price point that makes machine-native intelligence practical.",
  },
  {
    date: "D+1 · Ecosystem",
    title: "First community tools appear",
    desc: "Open-source plugins like fast-jev-compaction land within hours, wiring Jev into existing coding agents.",
  },
  {
    date: "D+2 · Today",
    title: "JevHunt opens its catalog",
    desc: "A neutral place to find and compare everything built on Jev — apps, recipes, schemas and experiments.",
  },
  {
    date: "Next · Submissions",
    title: "Community submissions go live",
    desc: "Submit your app, get a listing page, and let builders filter by mode, latency and use case.",
    future: true,
  },
  {
    date: "Later · Benchmarks",
    title: "Independent Jev benchmarks",
    desc: "Reproducible, community-run comparisons of Jev against chat models on System One tasks — accuracy per dollar, per millisecond.",
    future: true,
  },
];

/* ------------------------------ i18n ------------------------------------ */
JH.i18n = {
  en: {},
  zh: {
    "nav.about": "模型",
    "nav.apps": "应用",
    "nav.playbooks": "食谱",
    "nav.timeline": "时间线",
    "nav.submit": "提交应用",

    "hero.eyebrow": "Jev 生态导航 — 模型上线仅 2 天",
    "hero.title": '在<em>机器原生</em>软件的前沿狩猎。',
    "hero.sub": '<strong>JevHunt</strong> 收录所有基于 <strong>Jev</strong> 构建的应用、食谱与工具 —— Jev 是 TypeSafe AI 的 System One 模型，返回<em>带校准置信度的类型化决策</em>。发现生态正在构建什么，然后发布你自己的作品。',
    "hero.search": "搜索应用、食谱与 Schema…",
    "hero.cta1": "浏览目录",
    "hero.cta2": "Jev 官方文档 ↗",

    "stat.apps": "已收录应用",
    "stat.cats": "分类",
    "stat.speed": "快于对话模型",
    "stat.age": "上线天数",

    "about.title": "Jev 是什么？",
    "about.lead": "一类全新的模型：它输出的是决策，而不是段落。",
    "f1.title": "决策，而非字符串",
    "f1.body": "Jev 返回你的软件可以直接使用的类型化结果 —— 枚举、布尔、打分整数。无需解析散文，也不依赖脆弱的正则。",
    "f2.title": "校准置信度",
    "f2.body": "每个决策都附带模型对自身把握程度的估计。高于阈值自动执行，低于阈值升级给人工。",
    "f3.title": "零幻觉",
    "f3.body": "Jev 不写散文，因此没有可幻觉的内容。输出始终被约束在你调用时声明的 Schema 之内。",
    "f4.title": "更像代码",
    "f4.body": "可靠、快速、自洽且类型安全 —— 由全新架构、采样器与名为 RLCD 的训练算法构建。",

    "bench.label": "工作流智能 vs. 成本",
    "bench.title": "每一美元的智能，<em>高到离谱</em>。",
    "bench.s1": "System One 任务提速",
    "bench.s2": "单工作流更便宜",
    "bench.s3": "每十亿输入 token",
    "bench.s4": "输入价格低于对话模型",

    "apps.title": "应用目录",
    "apps.lead": "基于 Jev 构建的应用、食谱与开源工具。筛选、搜索、上线。",
    "apps.search": "按名称、标签或用例搜索…",
    "apps.sort": "按信号排序",
    "apps.empty": "没有匹配的应用 —— 换个标签试试。",

    "cats.title": "按用例浏览",
    "cats.lead": "当今机器原生决策创造最大杠杆的领域。",

    "pb.title": "食谱",
    "pb.lead": "最常用的模式，开箱即用的代码模板。",
    "pb.copy": "复制",
    "pb.docs": "阅读官方文档 ↗",

    "tl.title": "两天之内",
    "tl.lead": "Jev 全新上线。这是已发生的一切 —— 以及接下来。",

    "cta.eyebrow": "开放提交",
    "cta.title": "用 Jev 做了东西？<br />让它被狩猎。",
    "cta.lead": "目录随社区一起成长。提交应用、模式食谱、类型化 Schema 或开源插件，我们会把它收录进目录。",
    "cta.ph": "https://github.com/you/your-jev-thing",
    "cta.btn": "提交审核",
    "cta.note": "点子、Demo、半成品实验 —— 全都欢迎。",

    "foot.blurb": "独立、社区运营的 Jev 生态导航站，与 TypeSafe AI 无隶属关系。",
    "foot.explore": "探索",
    "foot.official": "官方",
    "foot.community": "社区",
    "foot.made": "为构建者而做。",

    "cat.coding": "编码智能体",
    "cat.classification": "分类",
    "cat.routing": "路由",
    "cat.docs": "文档智能",
    "cat.voice": "语音与实时",

    "auth.signin": "登录",
    "auth.signout": "退出登录",
    "auth.signedout": "已退出登录",
    "auth.signoutfail": "退出失败，请重试",
    "auth.unavailable": "Google 登录尚未配置",
    "auth.err.cancelled": "已取消登录",
    "auth.err.exchange": "Google 登录失败，请重试",
    "auth.err.state": "登录会话已过期，请重试",
    "auth.err.config": "Google 登录尚未配置",
    "auth.err.generic": "登录失败",
  },
};

/* category zh labels used by the app cards / filters */
JH.catZh = Object.fromEntries(JH.categories.map(c => [c.name, c.zh]));
