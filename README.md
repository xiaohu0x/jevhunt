# JevHunt

**The directory for software built on Jev.**

A community directory for apps, playbooks and tools built on [Jev](https://typesafe.ai/) — the
*System One* model from TypeSafe AI that returns **typed decisions with calibrated confidence**
instead of prose.

Live: **https://jevhunt.com**

---

## Architecture

Static front-end **plus** a small serverless backend, all on Cloudflare:

```
public/                     → static assets (the deploy root)
  index.html
  404.html                  → real 404 (avoids soft-404 on unknown paths)
  favicon.* og.png          → icons live at the site root
  site.webmanifest robots.txt sitemap.xml
  catalog-audit.json        → generated README-verification report
  _headers                  → security + cache headers
  assets/css|js|fonts/
    js/projects.js          → generated open-source repository snapshot

functions/                  → Cloudflare Pages Functions (the API)
  _lib/auth.js              → sessions, cookies, CSRF state, D1 helpers
  _lib/google.js            → Google OAuth 2.0 / OIDC
  api/me.js                 → GET  /api/me
  api/auth/google.js        → GET  /api/auth/google
  api/auth/callback.js      → GET  /api/auth/callback
  api/auth/logout.js        → POST /api/auth/logout
  api/submissions.js        → GET/POST /api/submissions

tools/stamp.mjs             → content-hash cache busting (no deps)
tools/sync-projects.mjs     → validated GitHub catalog sync (no deps)
migrations/0001_init.sql    → D1 schema
wrangler.toml               → bindings + config
```

| Concern | Choice |
| --- | --- |
| Hosting | Cloudflare Pages (`jevhunt`) |
| Domain | `jevhunt.com` + `www` (zone + project in the same CF account) |
| Database | Cloudflare D1 (SQLite) — binding `DB` |
| Auth | Google OAuth 2.0 (Authorization Code + OIDC) |
| Sessions | Server-side rows in D1, opaque token in an `HttpOnly` cookie |
| Build step | None — plain HTML/CSS/JS |

## Local development

```bash
npm install                # only for the wrangler dev dependency
npm run db:migrate:local   # create the local D1 tables
npm run dev                # → http://localhost:8788
```

To exercise the OAuth flow locally, create `.dev.vars` (git-ignored):

```ini
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="..."
```

## Google OAuth setup

Login only works once Google credentials exist — this part must be done in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create (or pick) a project → **APIs & Services → OAuth consent screen**
   - User type **External**; fill app name + support email
   - While in *Testing*, add your own Google account under **Test users**
2. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs** — must match exactly, including scheme and path:
     ```
     https://jevhunt.com/api/auth/callback
     http://localhost:8788/api/auth/callback     ← for local dev
     ```
3. Wire the values into the deployment:

```bash
# public client id → wrangler.toml [vars]
# secret → encrypted Workers secret
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name jevhunt
```

Then redeploy (`npm run deploy`). `/api/me` will start reporting `authEnabled: true`
and the **Sign in** button becomes active. Until then the button renders disabled
with an explanatory tooltip — nothing breaks.

## Database

Schema in `migrations/0001_init.sql`:

| Table | Purpose |
| --- | --- |
| `users` | one row per person, keyed by the Google `sub` claim |
| `sessions` | SHA-256 hash of the session token + expiry (never the raw token) |
| `submissions` | user-submitted apps for the directory |
| `oauth_states` | single-use CSRF nonces for the OAuth round-trip |

```bash
npm run db:migrate:remote   # apply to production D1
npm run db:studio           # list recent users
```

## Security notes

- Session tokens are 32 random bytes; **only their SHA-256 hash is stored**.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` whenever served over HTTPS
  (automatically relaxed on `http://localhost` for local dev).
- OAuth `state` is persisted in D1, single-use, expires in 10 minutes, and must
  match a cookie — blocking login CSRF.
- Post-login redirects are restricted to same-origin absolute paths (`safeNext`)
  to prevent open redirects.
- The authorization code is exchanged server-to-server; the profile is read from
  Google's `userinfo` endpoint rather than trusting a client-supplied token.
- Expired sessions and state rows are swept opportunistically.
- `public/_headers` sets `nosniff`, `X-Frame-Options: DENY`, a referrer policy and
  `Permissions-Policy`.

## Design system

Derived from the official Jev / TypeSafe AI aesthetic, pushed further for readability.

| Token | Dark | Light |
| --- | --- | --- |
| Background | `#0B0B0C` | `#FAFAF9` |
| Accent (brand pink) | `#F386A1` | `#CE2B63` |
| Accent 2 | `#D45BB6` | `#A61E7A` |
| Mono | JetBrains Mono | — |
| Display | Space Grotesk | — |
| Body | Inter | — |

- Self-hosted webfonts (latin subset) — no CDN, so it renders offline and behind
  restrictive networks; CJK falls back to the system stack.
- Dual theme (dark/light), with the UI presented in English only.
- All text meets **WCAG AA** contrast in both themes; no horizontal overflow from 390px.
- Honours `prefers-reduced-motion`.

## Project catalog

The public directory is a checked-in static snapshot of every active GitHub repository in
[`hellogumbo/awesome-jev`](https://github.com/hellogumbo/awesome-jev). It contains unique
repositories across official projects, SDKs, integrations, agent tools, browser and computer use,
applications, games, demos, research, and community directories. The current repository and star
counts are read from the generated snapshot and displayed on the site.

Refresh it with:

```bash
npm run catalog:sync
npm run build
```

The sync validates repository names and categories, drops removed entries, deduplicates
case-insensitively, restricts website links to HTTP(S), and refuses suspiciously small source
snapshots. Except for official `typesafe-ai/*` repositories, inclusion requires first-party Jev
or System One technical evidence in the repository's own default-branch README. A TypeSafe name or
website link by itself is not enough; neither are repository names, stars, upstream descriptions,
or external posts. The generated rejection report is published at
`/catalog-audit.json`. `.github/workflows/sync-projects.yml` runs the same refresh daily.

To add a project, use the submission form on JevHunt or submit it to the upstream source. Hero
stats, category counts, search, filters, star ranking, and publish/update date sorting update from
the generated snapshot.

## Deploy

```bash
npm run deploy     # stamps asset URLs, then wrangler pages deploy
```

`wrangler` must be authenticated (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN`
set. The account must also own the `jevhunt.com` zone — Cloudflare rejects a
proxied CNAME that points across accounts (error 1014).

### Cache busting

Pages serves `/assets/*` with a long `max-age`, so a plain deploy would leave
browsers on the previous bundle. `tools/stamp.mjs` rewrites the CSS/JS
references in `index.html` and `404.html` to `…?v=<content-hash>`, giving every
revision a distinct cache key. It is dependency-free and deterministic —
re-running it with unchanged assets is a no-op.

## Roadmap

- [x] Information-first single page
- [x] Searchable catalog of all discoverable Jev GitHub projects
- [x] English-only UI + dark / light themes
- [x] Cloudflare Pages + D1 + Google login
- [x] Real submissions API (`POST /api/submissions`) with validation + rate limit
- [x] Cache-busted assets, real 404, robots.txt, sitemap.xml
- [ ] Submission moderation UI (review/approve from the database)
- [ ] Individual listing pages + SEO metadata
- [ ] Voting on submissions
- [x] Daily project discovery snapshot
- [ ] Independent Jev benchmarks

## Disclaimer

JevHunt is an **independent, community-run** directory. It is not affiliated with, endorsed by,
or operated by TypeSafe AI. "Jev" and related marks belong to their respective owners.
Catalog entries are imported from the attributed community source and should be verified before
being relied upon.
