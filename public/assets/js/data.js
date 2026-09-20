/* ==========================================================================
   JevHunt — data layer
   UI metadata and examples. The generated project catalog lives
   in projects.js and is refreshed by tools/sync-projects.mjs.
   ========================================================================== */

window.JH = window.JH || {};

/* ------------------------------ categories ------------------------------ */
JH.categories = [
  { id: "official",     name: "Official",               icon: "◎", desc: "Official SDKs and open resources" },
  { id: "sdks",         name: "SDKs & Clients",         icon: "{}", desc: "Community clients across languages" },
  { id: "integrations", name: "Integrations",           icon: "⎇", desc: "Frameworks, gateways and platforms" },
  { id: "agents",       name: "Agent Tooling",          icon: "⌘", desc: "Gates, routers, reviewers, MCPs and skills" },
  { id: "browser",      name: "Browser & Computer Use", icon: "◫", desc: "Browser, desktop and mobile automation" },
  { id: "apps",         name: "Applications",           icon: "✦", desc: "Products, utilities and decision pipelines" },
  { id: "games",        name: "Games & Simulations",    icon: "◇", desc: "Playable projects and simulations" },
  { id: "demos",        name: "Demos & Playgrounds",    icon: "▸", desc: "Experiments and interactive playgrounds" },
  { id: "research",     name: "Benchmarks & Research",  icon: "∿", desc: "Evals, calibration studies and open replicas" },
  { id: "lists",        name: "Directories & Lists",    icon: "≡", desc: "Community-maintained Jev collections" },
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
