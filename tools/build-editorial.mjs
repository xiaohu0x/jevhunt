import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { JSDOM } from "jsdom";
import editorial from "../content/editorial.json" with { type: "json" };
import { EDITORIAL_ROUTES, editorialNavigation } from "../shared/editorial-routes.js";
import { loadData, page, esc, ORIGIN } from "./lib/site.mjs";

const { i18n } = loadData();
const styles = ["/assets/css/editorial.css"];
const bySlug = new Map(editorial.articles.map(article => [article.slug, article]));
const copy = {
  en: { contents: "On this page", reviewed: "Sources checked", author: "By", faq: "FAQ", guides: "Guides", related: "Related guides", sources: "About these guides", note: "These guides synthesize the linked documentation and repository sources. Community features are documented capabilities; this is not a runtime certification.", method: "Evidence policy" },
  ja: { contents: "このページの内容", reviewed: "参照資料の確認日", author: "作成", faq: "FAQ", sources: "参照資料について", note: "公式文書とリンク先の資料に基づいています。英語の資料にはリンクの言語を明記しています。コミュニティのアプリの動作や安全性を保証するものではありません。", method: "資料の確認方針（英語）" },
  ko: { contents: "페이지 목차", reviewed: "자료 확인일", author: "작성", faq: "FAQ", sources: "참고 자료", note: "공식 문서와 연결된 자료를 바탕으로 작성했습니다. 영어 자료는 링크에 표시했습니다. 커뮤니티 앱의 실제 동작이나 안전성을 인증한 것은 아닙니다.", method: "자료 확인 기준(영어)" },
  "pt-br": { contents: "Nesta página", reviewed: "Fontes verificadas", author: "Por", faq: "FAQ", sources: "Sobre as fontes", note: "As respostas se baseiam na documentação e nos repositórios citados. Links para conteúdo em inglês estão identificados. Recursos descritos por projetos da comunidade não são uma certificação de funcionamento ou segurança.", method: "Critérios de evidência (inglês)" },
};
const destinationLabels = {
  ja: { "apps.evidence": "資料確認（英語）", "apps.status": "更新情報（英語）", "foot.privacy": "プライバシー（英語）", "foot.terms": "利用規約（英語）", "foot.security": "セキュリティ（英語）" },
  ko: { "apps.evidence": "자료 확인(영어)", "apps.status": "업데이트(영어)", "foot.privacy": "개인정보(영어)", "foot.terms": "이용 약관(영어)", "foot.security": "보안(영어)" },
  "pt-br": { "apps.evidence": "Fontes (inglês)", "apps.status": "Atualizações (inglês)", "foot.privacy": "Privacidade (inglês)", "foot.terms": "Termos (inglês)", "foot.security": "Segurança (inglês)" },
};

function write(path, html) {
  const target = "public" + path + "index.html";
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
}

function bodyDocument(html) {
  const document = new JSDOM(html).window.document;
  if (document.querySelector("h1,script,iframe")) throw new Error("Unexpected top-level heading or executable article content");
  const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate editorial anchor");
  for (const heading of document.querySelectorAll("h2")) if (!heading.id) throw new Error("Every section needs a stable anchor");
  for (const table of document.querySelectorAll("table")) {
    const region = document.createElement("div");
    region.className = "table-scroll"; region.tabIndex = 0;
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", table.querySelector("caption")?.textContent || "Comparison table");
    table.before(region); region.append(table);
  }
  for (const pre of document.querySelectorAll("pre")) pre.tabIndex = 0;
  return document;
}

function contents(document, locale = "en") {
  return `<aside class="article-contents"><nav aria-label="${esc(copy[locale].contents)}"><h2>${esc(copy[locale].contents)}</h2><ol>${[...document.querySelectorAll("h2[id]")].map(heading => `<li><a href="#${esc(heading.id)}">${esc(heading.textContent)}</a></li>`).join("")}</ol></nav></aside>`;
}

function header({ title, lead, locale = "en", topic = "FAQ", path, modified = editorial.date }) {
  const c = copy[locale];
  const date = new Intl.DateTimeFormat(i18n.locales[locale].lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(modified + "T12:00:00Z"));
  return `<header class="article-header"><div class="article-kicker"><img src="/icon-192.png" alt="" width="36" height="36"/><span>JevHunt / ${esc(topic)}</span></div><h1>${esc(title)}</h1><p class="article-lead">${esc(lead)}</p><p class="article-byline">${esc(c.author)} <a href="/methodology/">JevHunt</a><span>${esc(c.reviewed)}: <time datetime="${modified}">${esc(date)}</time></span></p><nav class="article-breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : c.contents}"><a href="${i18n.locales[locale].path}">JevHunt</a><span>/</span><a href="${topic === "FAQ" ? path : "/blog/"}">${esc(topic === "FAQ" ? c.faq : "Guides")}</a></nav></header>`;
}

function notes(locale = "en") {
  const c = copy[locale];
  return `<section class="article-source-note"><h2>${esc(c.sources)}</h2><p>${esc(c.note)} <a href="/methodology/">${esc(c.method)}</a>.</p></section>`;
}

for (const article of editorial.articles) {
  if (article.description.length > 160) throw new Error("Description would be truncated: " + article.slug);
  const modified = article.modified || editorial.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(modified)) throw new Error("Invalid article modified date: " + article.slug);
  const document = bodyDocument(readFileSync(`content/blog/${article.slug}.html`, "utf8"));
  const lead = document.querySelector("p")?.textContent;
  if (!lead) throw new Error("Missing article lead: " + article.slug);
  document.querySelector("p").remove();
  const path = `/blog/${article.slug}/`;
  const related = article.related.map(slug => {
    const target = bySlug.get(slug);
    if (!target) throw new Error("Unknown related guide " + slug);
    return `<li><a href="/blog/${slug}/">${esc(target.title)}</a><p>${esc(target.description)}</p></li>`;
  }).join("");
  const schema = { "@context": "https://schema.org", "@graph": [
    { "@type": "BlogPosting", headline: article.title, description: article.description, url: ORIGIN + path,
      mainEntityOfPage: ORIGIN + path, inLanguage: "en", datePublished: modified, dateModified: modified,
      author: { "@type": "Organization", name: "JevHunt", url: ORIGIN + "/methodology/" },
      publisher: { "@type": "Organization", name: "JevHunt", url: ORIGIN + "/", logo: { "@type": "ImageObject", url: ORIGIN + "/icon-512.png" } },
      image: ORIGIN + "/og.png?v=3" },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "JevHunt", item: ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: "Guides", item: ORIGIN + "/blog/" },
      { "@type": "ListItem", position: 3, name: article.title, item: ORIGIN + path },
    ] },
  ] };
  write(path, page({ title: article.title, description: article.description, path, schema, styles, bodyClass: "editorial-page", ogType: "article", localeLinks: false,
    body: header({ title: article.title, lead, topic: article.topic, path, modified }) + `<div class="article-layout">${contents(document)}<article class="article-prose">${document.body.innerHTML}</article></div><section class="article-related"><h2>Related guides</h2><ul>${related}</ul><a href="/faq/">Jev FAQ</a></section>` + notes() }));
}

for (const faq of editorial.faqPages) {
  const data = JSON.parse(readFileSync(`content/faq/${faq.locale}.json`, "utf8"));
  const fragment = data.sections.map(section => `<section class="faq-section"><h2 id="${esc(section.id)}">${esc(section.title)}</h2>${section.questions.map(question => `<details class="faq-answer" data-faq-answer id="${esc(question.id)}"><summary>${esc(question.question)}</summary><div>${question.answer}</div></details>`).join("")}</section>`).join("");
  const document = bodyDocument(fragment);
  const locale = i18n.locales[faq.locale];
  write(faq.path, page({ title: faq.title, description: faq.description, path: faq.path, styles, bodyClass: "editorial-page", localeLinks: false, script: "/assets/js/faq.js",
    localeKey: faq.locale, localeInfo: locale, messages: { ...locale.messages, ...destinationLabels[faq.locale] }, localePrefix: faq.locale === "en" ? "" : `/${faq.locale}`,
    schema: { "@context": "https://schema.org", "@type": "WebPage", name: faq.title, url: ORIGIN + faq.path, inLanguage: locale.lang, dateModified: editorial.date },
    body: header({ title: faq.title, lead: faq.lead, locale: faq.locale, path: faq.path }) + `<div class="article-layout">${contents(document, faq.locale)}<div class="article-prose">${document.body.innerHTML}</div></div>` + notes(faq.locale) }));
}

const listing = ["Learn", "Build", "Integrate", "Evaluate"].map(topic => `<section class="guide-topic"><h2 id="${topic.toLowerCase()}">${topic}</h2><ul class="guide-list">${editorial.articles.filter(article => article.topic === topic).map(article => `<li><a href="/blog/${article.slug}/"><h3>${esc(article.title)}</h3></a><p>${esc(article.description)}</p></li>`).join("")}</ul></section>`).join("");
write("/blog/", page({ title: "Jev guides and FAQs", description: "Practical guides to Jev APIs, local alternatives, coding agents, search, classification, database integrations and decision-model evaluation.", path: "/blog/", styles, bodyClass: "editorial-page", localeLinks: false,
  schema: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Jev guides and FAQs", url: ORIGIN + "/blog/", inLanguage: "en", hasPart: editorial.articles.map(article => ({ "@type": "BlogPosting", headline: article.title, url: `${ORIGIN}/blog/${article.slug}/` })) },
  body: `<header class="article-header"><div class="article-kicker"><img src="/icon-192.png" alt="" width="36" height="36"/><span>JevHunt / Guides</span></div><h1>Jev guides and FAQs</h1><p class="article-lead">Understand the decision model, choose an integration, and evaluate it on the work your software needs to do.</p><nav class="guide-topics" aria-label="Guide topics"><a href="#learn">Learn</a><a href="#build">Build</a><a href="#integrate">Integrate</a><a href="#evaluate">Evaluate</a><a href="/faq/">FAQ</a></nav></header>${listing}<section class="guide-topic"><h2>FAQs in other languages</h2><ul class="guide-locales"><li><a href="/ja/faq/" lang="ja">日本語: 公式サイトとAPI</a></li><li><a href="/ko/faq/" lang="ko">한국어: 다운로드와 SDK 설치</a></li><li><a href="/pt-br/faq/" lang="pt-BR">Português: site oficial e acesso</a></li></ul></section>` + notes() }));

// Change only the parsed navigation span, keeping the rest of each landing page intact.
for (const [localeKey, locale] of Object.entries(i18n.locales)) {
  const target = "public" + locale.path + "index.html";
  const source = readFileSync(target, "utf8");
  const dom = new JSDOM(source, { includeNodeLocations: true });
  const nav = dom.window.document.querySelector(".home-nav-panel .nav__links");
  if (!nav) throw new Error("Missing landing navigation: " + localeKey);
  const location = dom.nodeLocation(nav);
  nav.querySelectorAll("[data-editorial-link]").forEach(link => link.remove());
  for (const item of editorialNavigation(localeKey)) {
    const link = dom.window.document.createElement("a");
    link.href = item.path; link.textContent = item.label; link.lang = item.lang;
    link.setAttribute("data-editorial-link", "");
    nav.append(link);
  }
  writeFileSync(target, source.slice(0, location.startOffset) + nav.outerHTML + source.slice(location.endOffset));
}

const sitemap = new JSDOM(readFileSync("public/sitemap.xml", "utf8"), { contentType: "application/xml" });
const xml = sitemap.window.document;
const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
for (const entry of EDITORIAL_ROUTES) {
  const url = xml.createElementNS(namespace, "url");
  const loc = xml.createElementNS(namespace, "loc"); loc.textContent = ORIGIN + entry.path;
  const modified = xml.createElementNS(namespace, "lastmod"); modified.textContent = entry.modified;
  url.append(loc, modified); xml.documentElement.append(url);
}
writeFileSync("public/sitemap.xml", sitemap.serialize());
const routes = JSON.parse(readFileSync(".cache/generated-routes.json", "utf8"));
writeFileSync(".cache/generated-routes.json", JSON.stringify([...routes, ...EDITORIAL_ROUTES.map(entry => entry.path)]));
const build = JSON.parse(readFileSync("public/build-info.json", "utf8"));
writeFileSync("public/build-info.json", JSON.stringify({ ...build, routeCount: build.routeCount + EDITORIAL_ROUTES.length, editorialPages: EDITORIAL_ROUTES.length }) + "\n");
console.log(`Generated ${editorial.articles.length} guides and ${editorial.faqPages.length} FAQ pages; ${EDITORIAL_ROUTES.length} editorial routes.`);
