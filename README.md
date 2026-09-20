# JevHunt

**The directory for software built on Jev.** — 基于 JVE 模型的应用导航站

JevHunt indexes apps, playbooks and tools built on [Jev](https://typesafe.ai/) — the *System One* model
from TypeSafe AI that returns **typed decisions with calibrated confidence** instead of prose.

> Phase 1 (current): information-first. The model launched days ago and the ecosystem is small,
> so the site focuses on *explaining* Jev and cataloguing what exists.
> Phase 2: community submissions. Phase 3: full navigation / discovery product.

---

## Stack

Zero dependencies, zero build step. Plain HTML + CSS + vanilla JS, self-hosted webfonts.

```
index.html                 # single-page site
assets/
  css/fonts.css            # self-hosted @font-face (latin subset)
  css/style.css            # design system + components
  js/data.js               # catalog, playbooks, timeline, i18n strings
  js/main.js               # rendering + interactions
  fonts/*.woff2            # Inter / JetBrains Mono / Space Grotesk
```

## Run locally

```bash
python3 -m http.server 8777
# → http://localhost:8777
```

Any static server works. No install, no compilation.

## Design language

Derived from the official Jev / TypeSafe AI aesthetic, pushed further for readability:

| Token | Dark | Light |
| --- | --- | --- |
| Background | `#0B0B0C` | `#FAFAF9` |
| Accent (brand pink) | `#F386A1` | `#CE2B63` |
| Accent 2 | `#D45BB6` | `#A61E7A` |
| Mono | JetBrains Mono | — |
| Display | Space Grotesk | — |
| Body | Inter | — |

- Terminal / brutalist layout: 1px rules, mono labels, ASCII glyphs (`∵ ⩆ ✢`), version tags.
- Signature components: typing terminal, marquee, benchmark band, directory grid, playbook tabs.
- **Dual theme** (dark / light) and **bilingual EN / 中文** toggle, both persisted to `localStorage`.
- All text meets **WCAG AA** contrast in both themes (audited).
- Respects `prefers-reduced-motion`; no horizontal overflow from 390px up.

## Adding an app to the catalog

Edit `assets/js/data.js` → `JH.apps`:

```js
{
  name: "My Jev App",
  author: "your-handle",
  desc: "One or two sentences on what decision it makes.",
  cat: "Routing",                 // must match a JH.categories name
  status: "beta",                  // live | beta | preview | recipe | wanted
  signal: 85,                      // curation weight, drives sort order
  tags: ["Agents", "Open source"],
  href: "https://github.com/you/my-jev-app",
}
```

Hero stats, category counts and filters update automatically.

## Roadmap

- [x] Information-first single page
- [x] App / playbook / category catalog
- [x] EN / 中文 + dark / light
- [ ] Real submission backend (currently a client-side stub)
- [ ] Individual listing pages + SEO metadata
- [ ] Submission moderation & voting
- [ ] Independent Jev benchmarks

## Deploy

Static — deploys anywhere. For GitHub Pages, see `.github/workflows/pages.yml`
(Settings → Pages → Source: GitHub Actions).

## Disclaimer

JevHunt is an **independent, community-run** directory. It is not affiliated with, endorsed by,
or operated by TypeSafe AI. "Jev" and related marks belong to their respective owners.
Catalog seed entries are illustrative and should be verified before being relied upon.
