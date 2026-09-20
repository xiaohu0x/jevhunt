/* ==========================================================================
   JevHunt — interactions
   ========================================================================== */
(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    theme: localStorage.getItem("jh-theme") || "dark",
    lang:  localStorage.getItem("jh-lang")  || "en",
    filter: "All",
    query: "",
  };

  /* ----------------------------- theme ---------------------------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    state.theme = t;
    localStorage.setItem("jh-theme", t);
    const meta = document.getElementById("themeColor");
    if (meta) meta.setAttribute("content", t === "light" ? "#FAFAF9" : "#0B0B0C");
  }

  /* ----------------------------- i18n ----------------------------------- */
  function captureOriginals() {
    $$("[data-i18n]").forEach(el => { if (el.dataset.origText === undefined) el.dataset.origText = el.textContent; });
    $$("[data-i18n-html]").forEach(el => { if (el.dataset.origHtml === undefined) el.dataset.origHtml = el.innerHTML; });
    $$("[data-i18n-ph]").forEach(el => { if (el.dataset.origPh === undefined) el.dataset.origPh = el.placeholder; });
  }

  const dict = (k) => (window.JH.i18n[state.lang] || {})[k];

  function applyLang(lang) {
    state.lang = lang;
    localStorage.setItem("jh-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

    $$("[data-i18n]").forEach(el => {
      el.textContent = lang === "en" ? el.dataset.origText : (dict(el.dataset.i18n) ?? el.dataset.origText);
    });
    $$("[data-i18n-html]").forEach(el => {
      el.innerHTML = lang === "en" ? el.dataset.origHtml : (dict(el.dataset.i18nHtml) ?? el.dataset.origHtml);
    });
    $$("[data-i18n-ph]").forEach(el => {
      el.placeholder = lang === "en" ? el.dataset.origPh : (dict(el.dataset.i18nPh) ?? el.dataset.origPh);
    });

    $("#langLabel").textContent = lang === "en" ? "中" : "EN";
    renderFilters();
    renderCategories();
    renderApps();
  }

  /* ----------------------------- terminal typing ------------------------ */
  const CODE = [
    'import typesafe',
    '',
    'client = typesafe.Client(api_key="jev_...")',
    '',
    'decision = client.decide(',
    '    model="jev-1",',
    '    state=support_ticket_text,',
    '    questions={',
    '        "intent": ["refund", "bug", "billing", "other"],',
    '        "needs_human": bool,',
    '        "urgency": ("score", 1, 5),',
    '    },',
    ')',
    '',
    '# → {"intent": ("refund", p=0.94)}',
    '#    "needs_human": (false, p=0.88)}',
  ].join("\n");

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(code) {
    const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*")|\b(import|from|def|return|if|elif|else|for|while|in|lambda|True|False|None|bool|str|float|int|and|or|not|with|as|pass|class)\b|\b(\d+\.?\d*)\b|([A-Za-z_]\w*)(?=\()/g;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const t = esc(m[0]);
      if (m[1]) out += `<span class="tk-com">${t}</span>`;
      else if (m[2]) out += `<span class="tk-str">${t}</span>`;
      else if (m[3]) out += `<span class="tk-kw">${t}</span>`;
      else if (m[4]) out += `<span class="tk-num">${t}</span>`;
      else if (m[5]) out += `<span class="tk-fn">${t}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }

  function typeTerminal() {
    const el = $("#termCode");
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.innerHTML = highlight(CODE);
      return;
    }
    let i = 0;
    (function tick() {
      i += 2;
      el.textContent = CODE.slice(0, i);
      if (i < CODE.length) {
        setTimeout(tick, CODE[i - 1] === "\n" ? 90 : 14);
      } else {
        el.innerHTML = highlight(CODE);
      }
    })();
  }

  /* ----------------------------- counters ------------------------------- */
  function runCounters() {
    $$("[data-count]").forEach(el => {
      const target = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.dec || "0", 10);
      const pre = el.dataset.prefix || "";
      const suf = el.dataset.suffix || "";
      const dur = 1300;
      const start = performance.now();
      function step(now) {
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + (target * e).toFixed(dec) + suf;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = pre + target.toFixed(dec) + suf;
      }
      requestAnimationFrame(step);
    });
  }

  /* ----------------------------- reveal --------------------------------- */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          if (en.target.classList.contains("stat-strip")) runCounters();
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });

    $$(".reveal").forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 6 * 60, 300) + "ms";
      io.observe(el);
    });
    const strip = $(".stat-strip");
    if (strip) io.observe(strip);
  }

  /* ----------------------------- apps ----------------------------------- */
  function catLabel(name) {
    return state.lang === "zh" ? (window.JH.catZh[name] || name) : name;
  }

  function renderFilters() {
    const host = $("#dirFilters");
    if (!host) return;
    const cats = ["All", ...new Set(window.JH.apps.map(a => a.cat))];
    host.innerHTML = cats.map(c =>
      `<button class="fchip${state.filter === c ? " is-active" : ""}" data-cat="${c}">${
        c === "All" ? (state.lang === "zh" ? "全部" : "All") : catLabel(c)
      }</button>`
    ).join("");
    $$(".fchip", host).forEach(b => b.addEventListener("click", () => {
      state.filter = b.dataset.cat;
      renderFilters();
      renderApps();
    }));
  }

  function renderApps() {
    const grid = $("#appGrid");
    if (!grid) return;
    const q = state.query.toLowerCase();

    const list = window.JH.apps
      .filter(a => state.filter === "All" || a.cat === state.filter)
      .filter(a => !q || (a.name + a.desc + a.cat + a.tags.join(" ") + a.author).toLowerCase().includes(q))
      .sort((a, b) => b.signal - a.signal);

    grid.innerHTML = list.map(a => `
      <a class="card" href="${a.href}" ${a.href.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
        <div class="card__top">
          <div>
            <div class="card__name">${a.name}</div>
            <div class="card__author">@${a.author}</div>
          </div>
          <span class="badge badge--${a.status}">${a.status}</span>
        </div>
        <p class="card__desc">${a.desc}</p>
        <div class="card__tags">
          ${a.tags.map(t => `<span class="tag">${t}</span>`).join("")}
          <span class="tag">${catLabel(a.cat)}</span>
        </div>
        <div class="card__foot">
          <span class="card__go">${a.href.startsWith("http") ? "open repo" : "view"} <span aria-hidden="true">→</span></span>
          <span class="card__stat">signal ${a.signal}</span>
        </div>
      </a>
    `).join("");

    const count = $("#dirCount");
    if (count) count.textContent = `${list.length} ${state.lang === "zh" ? "个应用" : "apps"}`;
    const empty = $("#dirEmpty");
    if (empty) empty.hidden = list.length !== 0;

    $$(".card", grid).forEach(card => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }

  /* ----------------------------- categories ----------------------------- */
  function renderCategories() {
    const host = $("#catGrid");
    if (!host) return;
    host.innerHTML = window.JH.categories.map(c => {
      const n = window.JH.apps.filter(a => a.cat === c.name).length;
      const label = state.lang === "zh" ? c.zh : c.name;
      const desc = state.lang === "zh" ? `${n} 个已收录` : c.desc;
      return `<button class="cat" data-cat="${c.name}">
        <span class="cat__ico" aria-hidden="true">${c.icon}</span>
        <span class="cat__b"><span class="cat__name">${label}</span><span class="cat__desc">${desc}</span></span>
        <span class="cat__n">${n}</span>
      </button>`;
    }).join("");
    $$(".cat", host).forEach(b => b.addEventListener("click", () => {
      state.filter = b.dataset.cat;
      renderFilters();
      renderApps();
      $("#apps").scrollIntoView({ behavior: "smooth" });
    }));
  }

  /* ----------------------------- playbooks ------------------------------ */
  let pbIndex = 0;

  function renderPlaybookTabs() {
    const host = $("#pbTabs");
    if (!host) return;
    host.innerHTML = window.JH.playbooks.map((p, i) =>
      `<button class="pb__tab${i === pbIndex ? " is-active" : ""}" role="tab" data-i="${i}">${p.label}</button>`
    ).join("");
    $$(".pb__tab", host).forEach(b => b.addEventListener("click", () => {
      pbIndex = parseInt(b.dataset.i, 10);
      renderPlaybookTabs();
      renderPlaybook();
    }));
  }

  function renderPlaybook() {
    const p = window.JH.playbooks[pbIndex];
    if (!p) return;
    $("#pbFile").textContent = p.file;
    $("#pbMode").textContent = p.mode;
    $("#pbDesc").textContent = p.desc;
    $("#pbCode").innerHTML = p.code;
    $("#pbList").innerHTML = p.list.map(li => `<li>${li}</li>`).join("");
  }

  function initCopy() {
    const btn = $("#copyBtn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const text = $("#pbCode").textContent;
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = state.lang === "zh" ? "已复制 ✓" : "Copied ✓";
        setTimeout(() => { btn.textContent = old; }, 1400);
      } catch (_) { /* clipboard unavailable */ }
    });
  }

  /* ----------------------------- timeline ------------------------------- */
  function renderTimeline() {
    const host = $("#tlItems");
    if (!host) return;
    host.innerHTML = window.JH.timeline.map(t => `
      <div class="tl-item reveal${t.future ? " tl-item--future" : ""}">
        <div class="tl-date">${t.date}</div>
        <div class="tl-title">${t.title}</div>
        <div class="tl-desc">${t.desc}</div>
      </div>
    `).join("");
  }

  /* ----------------------------- misc wire ------------------------------ */
  function initSearch() {
    const dir = $("#dirSearch");
    const hero = $("#heroSearch");
    function setQuery(v) {
      state.query = v;
      renderApps();
    }
    if (dir) dir.addEventListener("input", e => { if (hero) hero.value = e.target.value; setQuery(e.target.value); });
    if (hero) hero.addEventListener("input", e => {
      if (dir) dir.value = e.target.value;
      setQuery(e.target.value);
      if (e.target.value && window.scrollY < 200) $("#apps").scrollIntoView({ behavior: "smooth" });
    });
    document.addEventListener("keydown", e => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        (hero || dir)?.focus();
      }
    });
  }

  function initChips() {
    $$("#heroChips .chip").forEach(chip => chip.addEventListener("click", () => {
      state.filter = chip.dataset.jump;
      renderFilters();
      renderApps();
      $("#apps").scrollIntoView({ behavior: "smooth" });
    }));
  }

  function initFeatureGlow() {
    $$(".feature").forEach(card => card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    }));
  }

  function initSubmit() {
    const form = $("#submitForm");
    if (!form) return;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const url = $("#repoUrl").value.trim();
      const note = $("#formNote");
      const ok = /^https?:\/\/.+/.test(url);
      note.textContent = ok
        ? (state.lang === "zh" ? "已收到 ✓ 我们会尽快审核并收录。" : "Received ✓ We'll review it and add it to the catalog.")
        : (state.lang === "zh" ? "请输入以 http(s):// 开头的有效链接。" : "Please enter a valid URL starting with http(s)://");
      note.classList.toggle("is-ok", ok);
      if (ok) form.reset();
    });
  }

  function initNav() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ----------------------------- boot ----------------------------------- */
  function init() {
    applyTheme(state.theme);
    captureOriginals();
    // keep hero stats in sync with the catalog
    const sA = document.getElementById("statApps");
    const sC = document.getElementById("statCats");
    if (sA) sA.dataset.count = String(window.JH.apps.length);
    if (sC) sC.dataset.count = String(window.JH.categories.length);
    renderTimeline();
    renderPlaybookTabs();
    renderPlaybook();
    renderCategories();
    renderFilters();
    renderApps();
    applyLang(state.lang);
    initReveal();
    typeTerminal();
    initSearch();
    initChips();
    initFeatureGlow();
    initCopy();
    initSubmit();
    initNav();
    $("#year").textContent = new Date().getFullYear();

    $("#themeBtn").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
    $("#langBtn").addEventListener("click", () => applyLang(state.lang === "en" ? "zh" : "en"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
