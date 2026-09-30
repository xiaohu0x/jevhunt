import profiles from "../catalog/project-seo.json" with { type: "json" };
import { PROJECT_SEO_COPY, TOPIC_KEYS } from "./project-seo-copy.js";
import { matchingProjectContent } from "./project-content.js";

export const PROJECT_SEO_VERSION = "project-intent-v1";
// Soft editorial display budgets, never indexing gates or Google character limits.
export const PROJECT_SEO_LIMITS = { title: 76, heading: 76, description: 190, cjkDescription: 240 };
const clean = value => String(value ?? "").replace(/\s+/gu, " ").trim();
const fill = (template, values) => clean(template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
const sourceCode = { en: "source code", "zh-cn": "源码", "zh-tw": "原始碼", ja: "ソースコード", ko: "소스 코드", es: "código fuente", fr: "code source", de: "Quellcode", "pt-br": "código-fonte", ru: "исходный код", hi: "सोर्स कोड", id: "kode sumber", vi: "mã nguồn", tr: "kaynak kodunu", it: "codice sorgente" };

// These are conservative summaries of explicit repository descriptions. Never use
// an owner's name, a README code sample, stars, or a related-project list as a use case.
const TOPIC_RULES = [
  ["multiAgentTrading", /(?:multi[- ]?agents?|多智能体|多代理).{0,60}(?:trading|交易)|(?:trading|交易).{0,60}(?:multi[- ]?agents?|多智能体|多代理)/i],
  ["startup", /startup idea|business idea|创业(?:点子|想法)|創業(?:構想|點子)/i],
  ["compaction", /\bcompact(?:ion|ing)?\b|context.{0,25}(?:compress|prun|sieve)|(?:trim|prun).{0,30}(?:output|context)|上下文压缩|上下文壓縮|コンテキスト圧縮/i],
  ["routing", /(?:model|llm|agent).{0,25}rout(?:e|er|ing)|rout(?:e|er|ing).{0,35}(?:model|llm|agent)|模型路由/i],
  ["guardrails", /guardrails?|tool.{0,25}(?:permission|approval)|permission.{0,20}(?:review|gate)|工具权限|安全护栏/i],
  ["moderation", /content moderation|(?:spam|toxicity|toxic content|slop).{0,20}(?:detect|filter)|内容审核|內容審核/i],
  ["classification", /(?:text|document|ticket|email).{0,25}classif|文本分类|文字分類|テキスト分類/i],
  ["search", /semantic.{0,15}search|codebase search|grep.{0,30}meaning|filters lines by meaning|语义搜索|語意搜尋|セマンティック検索/i],
  ["rag", /\bRAG\b|retrieval[- ]augmented|检索增强|檢索增強/i],
  ["trading", /\b(?:trading|trader|trade decision)\b|\bbacktest(?:ing)?\b|交易(?:工具|系统|框架)|交易(?:工具|系統|框架)/i],
  ["ui", /generative UI|\bUI (?:framework|components)|morphs into.{0,15}UI|生成式(?:界面|介面)/i],
  ["codeReview", /code[- ]review|\b(?:code |semantic code )?lint(?:ing)?\b|(?:debugging|debugger)|代码审查|程式碼審查/i],
  ["memory", /\b(?:agentic|agent|project) memory\b|智能体记忆|代理記憶/i],
  ["voice", /\bvoice\b|spoken word|talk to your Mac|语音控制|語音控制/i],
  ["email", /\b(?:email|e-mail) (?:platform|client|assistant|tool)|邮件(?:平台|客户端|工具)/i],
  ["structuredData", /structured outputs?|type[- ]safe generation|typed JSON|结构化输出|結構化輸出/i],
  ["dataCuration", /dataset.{0,25}(?:sift|curat|filter)|数据集筛选|資料集篩選/i],
  ["webSearch", /search the web|web search|网页搜索|網頁搜尋/i],
  ["researchAssistant", /deep research|research (?:tool|assistant)|研究助手|研究助理/i],
  ["extension", /(?:browser|chrome|firefox).{0,15}extension|浏览器扩展|瀏覽器擴充/i],
  ["browser", /(?:browser|web).{0,25}(?:agent|automat|operations)|browser[- ]use|computer[- ]use|浏览器自动|瀏覽器自動/i],
  ["coding", /coding agent|coding assistant|code generation|编程智能体|程式開發代理/i],
  ["mcp", /\bMCP\b|model context protocol/i],
  ["cli", /\bCLI\b|command[- ]line|\bterminal\b|shell history|zsh history|命令行|命令列/i],
  ["mobile", /\bmobile\b|\bandroid\b|\biOS\b|手机|手機|移动应用|行動應用/i],
  ["desktop", /\bdesktop\b|\bmacOS app\b|桌面(?:应用|工作台)|桌面應用/i],
  ["chat", /chat ?bot|chat assistant|conversational assistant|聊天.{0,12}(?:助手|助理|回复)|对话副驾|對話助理/i],
  ["games", /\b(?:game|gaming|pokemon|doom|mario|minecraft)\b|游戏|遊戲/i],
  ["robotics", /\b(?:robot(?:ics)?|drone)\b|机器人|機器人/i],
  ["sql", /\b(?:SQL|Snowflake|DuckDB|Neo4j|Postgres(?:ql)?)\b/i],
  ["benchmarks", /\bbenchmark|\bevaluat(?:ion|or)\b|\bcalibration\b|leaderboard|基准测试|基準測試|ベンチマーク/i],
  ["training", /fine[- ]?tun(?:e|ing)|model training|train.{0,30}model|模型训练|模型訓練/i],
  ["workflows", /workflow automation|automate.{0,15}workflow|工作流自动|工作流程自動/i],
  ["monitoring", /\bmonitoring\b|\bobservability\b|监控|監控/i],
  ["sdk", /\bSDK\b|\bAPI client\b|\bclient library\b|(?:client|library).{0,30}(?:API|Jev|TypeSafe)/i],
  ["localModels", /(?:local|open[- ]weight|self[- ]hosted).{0,30}(?:decision|model)|本地决策模型|本機決策模型/i],
  ["resources", /\bcurated\b|\bdirectory\b|\bcatalog\b|awesome (?:list|jev)|project discovery|public resources|项目导航|專案目錄/i],
  ["decisionModels", /decision (?:models?|engines?)|typed decisions|System[- ]1 (?:model|decision)|决策模型|決策模型/i],
  ["demos", /\bdemo\b|\bplayground\b|\bexamples\b|演示|範例/i],
  ["agents", /\bagents?\b|智能体|代理工具|エージェント/i],
];
const CATEGORY_TOPICS = { sdks: "sdk", integrations: "app", agents: "agents", browser: "browser", apps: "app", games: "games", demos: "demos", research: "research", lists: "resources", official: "resources" };
const PLATFORMS = [["Claude Code", /\bClaude Code\b/i], ["OpenCode", /\bOpenCode\b/i], ["Codex", /\bCodex\b/i], ["Hermes", /\bHermes\b/i], ["Oh My Pi", /\bOh My Pi\b|\bOMP\b/i]];

export const projectName = project => clean(project.name) || clean(project.repo).split("/").at(-1) || "Project";
export const projectNameKey = project => projectName(project).toLowerCase();
export function duplicateProjectNames(projects) {
  const seen = new Set(), duplicates = new Set();
  for (const project of projects) {
    const key = projectNameKey(project);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

function positiveMatch(text, expression) {
  const match = expression.exec(text);
  if (!match) return false;
  const before = text.slice(Math.max(0, match.index - 40), match.index);
  return !/(?:\b(?:not|no|without|unlike)\s+(?:\w+\s+){0,3}|不是|并非|並非)$/i.test(before);
}

export function projectIntent(project) {
  const description = clean(project.desc);
  const profile = profiles.projects[clean(project.repo).toLowerCase()];
  let topic = profile?.topic, basis = topic ? "editorial" : "description";
  if (!topic) topic = TOPIC_RULES.find(([, expression]) => positiveMatch(description, expression))?.[0];
  if (!topic) {
    topic = project.relationship === "local-alternative" ? "localModels" : project.relationship === "sdk" ? "sdk" : CATEGORY_TOPICS[project.cat] || "app";
    basis = "catalog-facts";
  }
  const platforms = ["coding", "compaction", "routing", "guardrails", "mcp"].includes(topic)
    ? PLATFORMS.filter(([, expression]) => positiveMatch(description, expression)).map(([name]) => name) : [];
  // Only publish a scoped editorial claim when current catalog evidence still
  // supports it. A profile never rewrites the catalog's relationship label.
  const scoped = profile?.summaryKey && project.relationship === "integration" && new RegExp(profile.evidencePattern, "i").test(project.evidenceDetail?.excerpt || "");
  return { topic, basis, platform: platforms.length === 1 ? platforms[0] : null, profile, scoped: !!scoped };
}

// An editorial display budget, not a Google character limit or a pixel metric.
// Count wide scripts twice and combining marks zero; never cut graphemes or names.
export function displayUnits(value) {
  return [...value].reduce((total, char) => total + (/\p{Mark}/u.test(char) ? 0 : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 2 : 1), 0);
}

const descriptionBudget = locale => ["zh-cn", "zh-tw", "ja", "ko"].includes(locale)
  ? PROJECT_SEO_LIMITS.cjkDescription : PROJECT_SEO_LIMITS.description;

export function projectSeoLengthDiagnostics({ title = "", heading = "", description = "" }, { localeKey = "en" } = {}) {
  const locale = Object.hasOwn(PROJECT_SEO_COPY, localeKey) ? localeKey : "en";
  const fields = {
    // The renderer appends the site suffix; owner disambiguation is already in title.
    title: { units: displayUnits(title + " | JevHunt"), budget: PROJECT_SEO_LIMITS.title },
    heading: { units: displayUnits(heading), budget: PROJECT_SEO_LIMITS.heading },
    description: { units: displayUnits(description), budget: descriptionBudget(locale) },
  };
  return { ...fields, flags: Object.entries(fields).filter(([, value]) => value.units > value.budget).map(([field]) => "long-" + field) };
}

function withLengthDiagnostics(metadata, locale) {
  const lengthDiagnostics = projectSeoLengthDiagnostics(metadata, { localeKey: locale });
  // Diagnose the actual copy without clipping a name, qualification or grapheme.
  return { ...metadata, lengthDiagnostics, flags: [...metadata.flags, ...lengthDiagnostics.flags] };
}

function metadataRelationship(project) {
  const relation = project.relationship;
  if (relation !== "local-alternative") return relation;
  const description = clean(project.desc);
  // Some legacy catalog records picked up an alternative mentioned in a list
  // or benchmark. The repository's explicit primary purpose takes precedence;
  // do not turn a comparison OF alternatives into an alternative model itself.
  if (/\bcurated (?:list|directory)\b|\bdirectory of\b|\bcatalog of.{0,40}projects\b|^awesome jev\b|\bcollection and survey\b/i.test(description)) return "resource";
  if (/^benchmark\b|^.{0,40}\bbenchmark (?:and evaluation|of |suite|harness)|^an independent.{0,30}\bbenchmark\b/i.test(description)) return "research";
  return relation;
}

export function projectSeo(project, { localeKey = "en", duplicateName = false, content = null } = {}) {
  const locale = Object.hasOwn(PROJECT_SEO_COPY, localeKey) ? localeKey : "en";
  const copy = PROJECT_SEO_COPY[locale];
  if (matchingProjectContent(project, content) && content.locales[locale]) {
    const localized = content.locales[locale];
    const name = content.displayName || projectName(project);
    const owner = clean(project.repo).split("/")[0];
    return withLengthDiagnostics({ title: localized.title + (duplicateName ? ` (${owner})` : ""), heading: localized.h1,
      description: duplicateName ? localized.description.replace(name, `${name} (${owner})`) : localized.description,
      name, topic: localized.sections.find(section => section.kind === "purpose")?.heading,
      relationship: content.relationship, sourceHeading: copy.sourceHeading, intent: "source-backed",
      basis: "reviewed-content", scoped: true, duplicateName, flags: content.status === "source-limited" ? ["source-limited"] : [] }, locale);
  }
  const intent = projectIntent(project);
  const name = intent.profile?.name || projectName(project);
  const owner = clean(project.repo).split("/")[0];
  const language = project.language && project.language !== "unknown" ? clean(project.language) : "";
  const resolvedRelationship = metadataRelationship(project);
  const relationship = Object.hasOwn(copy.roles, resolvedRelationship) ? resolvedRelationship : "unclassified";
  let topic = copy.topics[TOPIC_KEYS.indexOf(intent.topic)];
  if (intent.platform) topic = fill(copy.platform, { topic, platform: intent.platform });
  const role = fill(copy.roles[relationship === "sdk" && project.evidenceLevel === "official" ? "officialSdk" : relationship], { language }).replace(/(^|\s)-SDK/g, "$1SDK");
  const connected = ["jev-app", "integration"].includes(relationship);
  const namedConnection = name + (/jev/i.test(name) ? "" : copy.connection);
  let heading;
  if (connected && (intent.basis !== "catalog-facts" || intent.topic !== "app")) heading = namedConnection + copy.separator + topic;
  else if (relationship === "research" && intent.basis !== "catalog-facts") heading = name + copy.separator + topic + " · Jev";
  else heading = name + copy.separator + role;
  // Owner identity is useful for collisions, never the first keyword by default.
  const title = heading + (duplicateName ? ` (${owner})` : "");
  const identity = name + (duplicateName ? ` (${owner})` : "");
  const subject = ["local-alternative", "sdk", "resource", "unclassified"].includes(relationship) || intent.topic === "app" ? role : topic;
  const opening = intent.scoped ? copy[intent.profile.summaryKey].replace(name, identity) : fill(copy.opening, { name: identity, topic: subject });
  const sentence = text => /[.!?。！？।]$/u.test(text) ? text : text + copy.sentence.trim();
  const join = sentences => sentences.filter(Boolean).map(sentence).join(/[。]/u.test(copy.sentence) ? "" : " ");
  const code = language ? fill(copy.code, { language }) : sourceCode[locale];
  const archived = project.archived === true ? copy.archived : "";
  const candidates = [join([opening, archived, fill(copy.action, { code })]), join([opening, archived, copy.shortAction])];
  const budget = descriptionBudget(locale);
  // Drop optional copy as complete sentences, rather than clipping a promise,
  // a word, an emoji, or an identifier at an arbitrary 160 UTF-16 code units.
  const description = candidates.find(text => displayUnits(text) <= budget) || candidates.at(-1);
  return withLengthDiagnostics({ title, heading, description, name, topic, relationship, sourceHeading: copy.sourceHeading,
    intent: intent.topic, basis: intent.basis, scoped: intent.scoped, duplicateName,
    flags: [intent.basis === "catalog-facts" ? "needs-specific-description" : "", resolvedRelationship !== project.relationship ? "source-relationship-conflict" : ""].filter(Boolean) }, locale);
}
