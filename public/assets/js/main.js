/* ==========================================================================
   JevHunt — interactions
   ========================================================================== */
(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    theme: localStorage.getItem("jh-theme") || "dark",
    filter: "all",
    query: "",
    sort: "stars-desc",
    visible: 20,
  };

  const PAGE_SIZE = 20;
  const number = new Intl.NumberFormat("en-US");

  /* ----------------------------- theme ---------------------------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    state.theme = t;
    localStorage.setItem("jh-theme", t);
    const meta = document.getElementById("themeColor");
    if (meta) meta.setAttribute("content", t === "light" ? "#FAFAF9" : "#0B0B0C");
  }

  const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function normalizeGitHubRepoUrl(value) {
    try {
      const parsed = new URL(value);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const owner = parts[0] || "";
      const repo = (parts[1] || "").replace(/\.git$/i, "");
      const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
      const validRepo = repo.length <= 100 && /^[A-Za-z0-9._-]+$/.test(repo) && repo !== "." && repo !== "..";

      if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" ||
          parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
          parts.length !== 2 || !validOwner || !validRepo) return null;

      return `https://github.com/${owner}/${repo}`;
    } catch {
      return null;
    }
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
        const value = target * e;
        el.textContent = pre + (dec ? value.toFixed(dec) : number.format(Math.round(value))) + suf;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = pre + (dec ? target.toFixed(dec) : number.format(target)) + suf;
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
  function category(id) {
    return window.JH.categories.find(c => c.id === id);
  }

  function catLabel(id) {
    const item = category(id);
    if (!item) return id;
    return item.name;
  }

  function resetCatalogWindow() {
    state.visible = PAGE_SIZE;
  }

  function compareDate(left, right, direction = "desc") {
    if (left && right) return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
    if (left) return -1;
    if (right) return 1;
    return 0;
  }

  function compareName(left, right) {
    return left.localeCompare(right, "en", { sensitivity: "base" });
  }

  function renderFilters() {
    const host = $("#dirFilters");
    if (!host) return;
    const counts = new Map();
    window.JH.apps.forEach(app => counts.set(app.cat, (counts.get(app.cat) || 0) + 1));
    const cats = [
      { id: "all", label: "All" },
      ...window.JH.categories
        .filter(c => counts.has(c.id))
        .map(c => ({ id: c.id, label: c.name })),
    ];
    host.innerHTML = cats.map(c =>
      `<button class="fchip${state.filter === c.id ? " is-active" : ""}" data-cat="${escAttr(c.id)}" aria-pressed="${state.filter === c.id}">${escAttr(c.label)}</button>`
    ).join("");
    $$(".fchip", host).forEach(b => b.addEventListener("click", () => {
      state.filter = b.dataset.cat;
      resetCatalogWindow();
      renderFilters();
      renderApps();
    }));
  }

  function renderApps() {
    const grid = $("#appGrid");
    if (!grid) return;
    const q = state.query.trim().toLowerCase();

    const list = window.JH.apps
      .filter(a => state.filter === "all" || a.cat === state.filter)
      .filter(a => !q || [a.name, a.repo, a.author, a.desc, a.language, catLabel(a.cat)]
        .filter(Boolean).join(" ").toLowerCase().includes(q))
      .sort((a, b) => {
        if (state.sort === "stars-asc") return a.stars - b.stars || compareDate(a.created, b.created) || compareName(a.name, b.name);
        if (state.sort === "created-desc") return compareDate(a.created, b.created) || b.stars - a.stars || compareName(a.name, b.name);
        if (state.sort === "created-asc") return compareDate(a.created, b.created, "asc") || b.stars - a.stars || compareName(a.name, b.name);
        if (state.sort === "updated-desc") return compareDate(a.pushed, b.pushed) || b.stars - a.stars || compareName(a.name, b.name);
        if (state.sort === "added-desc") return compareDate(a.added, b.added) || b.stars - a.stars || compareName(a.name, b.name);
        if (state.sort === "name-asc") return compareName(a.name, b.name) || b.stars - a.stars;
        return b.stars - a.stars || compareDate(a.created, b.created) || compareName(a.name, b.name);
      });

    const shown = list.slice(0, state.visible);
    grid.innerHTML = shown.map(a => {
      const repoUrl = `https://github.com/${a.repo.split("/").map(encodeURIComponent).join("/")}`;
      const description = a.desc || "No project description available.";
      const published = a.created
        ? `published ${a.created}`
        : null;
      const updated = a.pushed
        ? `updated ${a.pushed}`
        : "update date unknown";
      return `
      <article class="card">
        <div class="card__top">
          <div>
            <h2 class="card__heading"><a class="card__name" href="${escAttr(repoUrl)}" target="_blank" rel="noopener">${escAttr(a.name)}</a></h2>
            <div class="card__author">${escAttr(a.repo)}</div>
          </div>
          <span class="badge badge--catalog">${escAttr(catLabel(a.cat))}</span>
        </div>
        <p class="card__desc">${escAttr(description)}</p>
        <div class="card__tags">
          ${a.language ? `<span class="tag">${escAttr(a.language)}</span>` : ""}
          ${published ? `<span class="tag">${escAttr(published)}</span>` : ""}
          <span class="tag">${escAttr(updated)}</span>
        </div>
        <div class="card__foot">
          <span class="card__links">
            <a class="card__go" href="${escAttr(repoUrl)}" target="_blank" rel="ugc nofollow noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a>
            <a class="card__site" href="${escAttr(a.evidence)}" target="_blank" rel="ugc nofollow noopener noreferrer">README <span aria-hidden="true">↗</span></a>
          </span>
          <span class="card__stat" aria-label="${number.format(a.stars)} GitHub stars">★ ${number.format(a.stars)}</span>
        </div>
      </article>`;
    }).join("");

    const count = $("#dirCount");
    if (count) {
      count.textContent = `Showing ${number.format(shown.length)} of ${number.format(list.length)} projects`;
    }
    const empty = $("#dirEmpty");
    if (empty) empty.hidden = list.length !== 0;
    const more = $("#loadMore");
    if (more) {
      more.hidden = shown.length >= list.length;
      const remaining = Math.min(PAGE_SIZE, list.length - shown.length);
      more.textContent = `Load ${remaining} more`;
    }

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
      const n = window.JH.apps.filter(a => a.cat === c.id).length;
      const label = c.name;
      const desc = c.desc;
      return `<button class="cat" data-cat="${escAttr(c.id)}">
        <span class="cat__ico" aria-hidden="true">${escAttr(c.icon)}</span>
        <span class="cat__b"><span class="cat__name">${escAttr(label)}</span><span class="cat__desc">${escAttr(desc)}</span></span>
        <span class="cat__n">${number.format(n)}</span>
      </button>`;
    }).join("");
    $$(".cat", host).forEach(b => b.addEventListener("click", () => {
      state.filter = b.dataset.cat;
      resetCatalogWindow();
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
        btn.textContent = "Copied ✓";
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
      resetCatalogWindow();
      renderApps();
    }
    if (dir) dir.addEventListener("input", e => { if (hero) hero.value = e.target.value; setQuery(e.target.value); });
    if (hero) hero.addEventListener("input", e => {
      if (dir) dir.value = e.target.value;
      setQuery(e.target.value);
      if (e.target.value) $("#apps").scrollIntoView({ behavior: "smooth" });
    });
    document.addEventListener("keydown", e => {
      const active = document.activeElement;
      const isEditing = active && (active.matches("input, textarea, select") || active.isContentEditable);
      if (e.key === "/" && !isEditing) {
        e.preventDefault();
        (hero || dir)?.focus();
      }
    });
  }

  function initChips() {
    $$("#heroChips .chip").forEach(chip => chip.addEventListener("click", () => {
      state.filter = chip.dataset.jump;
      resetCatalogWindow();
      renderFilters();
      renderApps();
      $("#apps").scrollIntoView({ behavior: "smooth" });
    }));
  }

  function initDirectory() {
    const sort = $("#dirSort");
    if (sort) {
      sort.value = state.sort;
      sort.addEventListener("change", () => {
        state.sort = sort.value;
        resetCatalogWindow();
        renderApps();
      });
    }

    const more = $("#loadMore");
    if (more) {
      more.addEventListener("click", () => {
        state.visible += PAGE_SIZE;
        renderApps();
      });
    }
  }

  function initFeatureGlow() {
    $$(".feature").forEach(card => card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    }));
  }

  /* ----------------------------- submissions ---------------------------- */
  function fillCategories() {
    const sel = $("#subCat");
    if (!sel) return;
    const selected = sel.value;
    const label = "Category";
    const opts = (window.JH.categories || []).map(c =>
      `<option value="${escAttr(c.id)}">${escAttr(c.name)}</option>`
    ).join("");
    sel.innerHTML = `<option value="" disabled selected>${label}</option>${opts}`;
    if ([...sel.options].some(option => option.value === selected)) sel.value = selected;
  }

  async function loadSubmissions() {
    const host = $("#mySubs");
    if (!host || !authState.user) return;
    try {
      const res = await fetch("/api/submissions", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error("status " + res.status);
      const list = (await res.json()).submissions || [];
      if (!list.length) { host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = `<h4>Your submissions</h4>` + list.map(s =>
        `<div class="sub__item">
           <span class="sub__item-name">${escAttr(s.name)}</span>
           <span class="sub__item-url">${escAttr(s.url)}</span>
           <span class="badge badge--${escAttr(s.status)}">${escAttr(s.status)}</span>
         </div>`
      ).join("");
    } catch (_) {
      host.hidden = true;
    }
  }

  function renderSubmit() {
    const signin = $("#subSignin"), form = $("#submitForm");
    if (!signin || !form) return;
    const signedIn = !!authState.user;
    signin.hidden = signedIn;
    form.hidden = !signedIn;
    if (signedIn) { fillCategories(); loadSubmissions(); }
    else { const list = $("#mySubs"); if (list) list.hidden = true; }
  }

  function initSubmit() {
    const form = $("#submitForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = $("#formNote"), btn = $("#subBtn");

      const setNote = (msg, kind) => {
        note.textContent = msg;
        note.classList.remove("is-ok", "is-err");
        if (kind) note.classList.add(kind);
      };

      if (!authState.user) {
        toast("Sign in with Google to submit.", true);
        return;
      }

      const payload = {
        url: $("#subUrl").value.trim(),
        name: $("#subName").value.trim(),
        category: $("#subCat").value,
        description: $("#subDesc").value.trim(),
      };

      const repositoryUrl = normalizeGitHubRepoUrl(payload.url);
      if (!repositoryUrl) {
        setNote("Enter a GitHub repository URL like https://github.com/owner/repo.", "is-err");
        return;
      }
      payload.url = repositoryUrl;
      if (payload.name.length < 2) {
        setNote("Give the app a name (2+ characters).", "is-err");
        return;
      }
      if (!$("#subConsent").checked) {
        setNote("Confirm the Terms and Privacy Policy before submitting.", "is-err");
        return;
      }

      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Submitting…";

      try {
        const res = await fetch("/api/submissions", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 401) {
          authState.user = null;
          renderAuth();
          toast("Sign in with Google to submit.", true);
          return;
        }
        if (res.status === 429) {
          setNote("Too many submissions this hour — try again later.", "is-err");
          return;
        }
        if (!res.ok) throw new Error("status " + res.status);

        form.reset();
        $("#subCat").selectedIndex = 0;
        setNote("Received ✓ We'll review it and add it to the catalog.", "is-ok");
        loadSubmissions();
      } catch (_) {
        setNote("Something went wrong. Please try again.", "is-err");
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  function initNav() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ----------------------------- toast ---------------------------------- */
  let toastTimer;
  function toast(msg, isErr) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("is-err", !!isErr);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-on");
      setTimeout(() => { el.hidden = true; }, 320);
    }, 4200);
  }

  /* ----------------------------- auth ----------------------------------- */
  const GOOGLE_G = '<svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  const authState = { user: null, authEnabled: false, loaded: false };
  const authNext = () => location.pathname + location.search + location.hash;

  function renderAuth() {
    if (!authState.loaded) return;
    renderSubmit();
    const host = $("#auth");
    if (!host) return;
    const { user, authEnabled } = authState;

    if (user) {
      const name = user.name || user.email || "?";
      const initial = name.trim().charAt(0).toUpperCase();
      const avatar = user.picture
        ? `<img class="auth__avatar" src="${escAttr(user.picture)}" alt="" referrerpolicy="no-referrer" />`
        : `<span class="auth__avatar" style="display:grid;place-items:center;font-family:var(--mono);font-size:.74rem">${escAttr(initial)}</span>`;
      host.innerHTML = `<div class="auth__user">
        <button class="auth__btn" id="authBtn" aria-haspopup="menu" aria-expanded="false">
          ${avatar}<span class="auth__name">${escAttr(name)}</span>
          <svg class="auth__chev" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <div class="auth__menu" id="authMenu" role="menu" hidden>
          <div class="auth__meta">
            ${user.picture ? `<img src="${escAttr(user.picture)}" alt="" referrerpolicy="no-referrer" />` : ""}
            <div><div class="auth__meta-name">${escAttr(user.name || "")}</div>
            <div class="auth__meta-email">${escAttr(user.email || "")}</div></div>
          </div>
          <a class="auth__item" href="/privacy/" role="menuitem">Privacy and data use</a>
          <button class="auth__item" id="signOut" role="menuitem">Sign out</button>
        </div></div>`;

      const btn = $("#authBtn"), menu = $("#authMenu");
      const close = () => { btn.setAttribute("aria-expanded", "false"); menu.hidden = true; };
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        menu.hidden = open;
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      $("#signOut").addEventListener("click", signOut);
      return;
    }

    if (!authEnabled) {
      host.innerHTML = `<span class="auth__signin auth__signin--disabled" aria-disabled="true" title="Google sign-in is unavailable in this environment">${GOOGLE_G}<span>Continue with Google</span></span>`;
      return;
    }
    host.innerHTML = `<a class="auth__signin" href="/api/auth/google?next=${encodeURIComponent(authNext())}" aria-label="Continue to Google's secure sign-in page">${GOOGLE_G}<span>Continue with Google</span></a>`;
  }

  async function signOut() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("status " + res.status);
      authState.user = null;
      renderAuth();
      toast("Signed out");
    } catch (_) {
      toast("Could not sign out. Try again.", true);
    }
  }

  const AUTH_ERRORS = {
    cancelled: "Sign-in was cancelled",
    exchange_failed: "Google sign-in failed. Please try again.",
    bad_state: "Sign-in session expired. Please try again.",
    expired_state: "Sign-in session expired. Please try again.",
    not_configured: "Google login is not configured",
  };

  function handleAuthError() {
    const p = new URLSearchParams(location.search);
    const code = p.get("auth_error");
    if (!code) return;
    toast(AUTH_ERRORS[code] || "Sign-in failed", true);
    p.delete("auth_error");
    const qs = p.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }

  async function initAuth() {
    const host = $("#auth");
    if (!host || location.protocol === "file:") return;
    host.innerHTML = `<span class="auth__signin auth__signin--loading" aria-busy="true">${GOOGLE_G}<span>Continue with Google</span></span>`;
    try {
      const res = await fetch("/api/me", { headers: { accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      if (!res.ok || !ct.includes("application/json")) throw new Error("not an api");
      const data = await res.json();
      authState.user = data.user || null;
      authState.authEnabled = !!data.authEnabled;
    } catch (_) {
      authState.user = null;
      authState.authEnabled = false;
    }
    authState.loaded = true;
    renderAuth();
    handleAuthError();
  }

  /* ----------------------------- boot ----------------------------------- */
  function init() {
    applyTheme(state.theme);
    // keep hero stats in sync with the catalog
    const sA = document.getElementById("statApps");
    const sC = document.getElementById("statCats");
    const sS = document.getElementById("statStars");
    if (sA) sA.dataset.count = String(window.JH.apps.length);
    if (sC) sC.dataset.count = String(window.JH.categories.length);
    if (sS) sS.dataset.count = String(window.JH.catalogMeta?.totalStars || 0);
    const sync = document.getElementById("catalogUpdated");
    if (sync) sync.textContent = window.JH.catalogMeta?.updated || "—";
    renderTimeline();
    renderPlaybookTabs();
    renderPlaybook();
    renderCategories();
    renderFilters();
    renderApps();
    initReveal();
    typeTerminal();
    initSearch();
    initChips();
    initDirectory();
    initFeatureGlow();
    initCopy();
    initSubmit();
    initNav();
    initAuth();
    $("#year").textContent = new Date().getFullYear();

    $("#themeBtn").addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
