import editorial from "../content/editorial.json" with { type: "json" };

export const EDITORIAL_ROUTES = [
  { path: "/blog/", modified: editorial.date },
  ...editorial.articles.map(article => ({ path: `/blog/${article.slug}/`, modified: article.modified || editorial.date })),
  ...editorial.faqPages.map(page => ({ path: page.path, modified: editorial.date })),
];

const labels = {
  en: ["Guides", "FAQ"], "zh-cn": ["指南（英语）", "常见问题（英语）"], "zh-tw": ["指南（英語）", "常見問題（英語）"],
  ja: ["ガイド（英語）", "FAQ"], ko: ["가이드(영어)", "FAQ"], "pt-br": ["Guias (inglês)", "FAQ"],
  es: ["Guías (inglés)", "Preguntas (inglés)"], fr: ["Guides (anglais)", "FAQ (anglais)"], de: ["Anleitungen (Englisch)", "FAQ (Englisch)"],
  ru: ["Руководства (англ.)", "FAQ (англ.)"], hi: ["गाइड (अंग्रेज़ी)", "FAQ (अंग्रेज़ी)"], id: ["Panduan (Inggris)", "FAQ (Inggris)"],
  vi: ["Hướng dẫn (tiếng Anh)", "FAQ (tiếng Anh)"], tr: ["Rehberler (İngilizce)", "SSS (İngilizce)"], it: ["Guide (inglese)", "FAQ (inglese)"],
};

export function editorialNavigation(locale = "en") {
  const [guides, faq] = labels[locale] || labels.en;
  return [
    { path: "/blog/", label: guides, lang: "en" },
    { path: editorial.faqPages.find(page => page.locale === locale)?.path || "/faq/", label: faq, lang: editorial.faqPages.some(page => page.locale === locale) ? locale : "en" },
  ];
}
