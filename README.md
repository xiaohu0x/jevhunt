# JevHunt

A public directory of Jev applications, integrations, SDKs, local alternatives and research. Live at **https://jevhunt.com**.

Every listing has a relationship label, source evidence and freshness information. Documentation or a source-code reference is not a runtime test. GitHub Repository Search is the primary discovery path; supplemental community feeds, official repositories and approved submissions add coverage. Search queries, result counts, request counts and partial-result flags are recorded in `/catalog-audit.json`.

## Development

Node 24 and Python 3.12 are used in CI. The frontend is plain JavaScript, HTML and CSS; Cloudflare Pages Functions use D1 for Google sessions and submissions.

```sh
npm ci
npm run build
npm run db:migrate:local
npm run catalog:seed:local
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars` for local Google OAuth credentials and optional administrator access. The registered local callback is `http://localhost:8788/api/auth/callback`. Browsing works without authentication. Production Google credentials are encrypted Pages secrets; do not put them in Git or client-side assets.

```sh
npm test
pip install -r requirements-examples.txt
npm run test:examples
npx wrangler pages functions build functions --outdir=.cache/functions
```

The Python example tests use the actual SDK and an offline HTTP transport. They make no billable model calls. The DOM tests simulate interactions, storage failures, search and pagination without operating a browser.

## Live catalog and scheduled updates

The data path runs entirely in Cloudflare:

```mermaid
flowchart LR
    Sources[Community feeds and public GitHub] --> Cron[Worker Cron]
    Cron --> DB[(D1 catalog and work queue)]
    Review[Editorial review] --> DB
    DB --> Pages[Pages Functions]
    Pages --> Visitors[Directory and project pages]
```

`workers/catalog-sync` uses a persistent Cloudflare Durable Object alarm to advance a small batch every minute. Cron Triggers also wake and repair the clock. The first site request starts the clock if necessary; startup is idempotent. Community feeds refresh every six hours. Paginated GitHub searches and repository checks continue between feed updates, with persisted cursors, retry times and a lease that prevents overlapping batches. Existing repositories are rechecked continuously; individual evidence and metadata check dates are shown on their pages.

The worker reads public GitHub repository metadata and commit-pinned source evidence. It does not store an account-wide Cloudflare token or a GitHub publishing credential. GitHub is used for source control, CI and public repository data; committing catalog data is not part of the live update path.

`catalog/sources.json` configures GitHub Repository Search queries, two supplemental community sources and an official repository allowlist. Search is partitioned by creation date when GitHub's 1,000-result window would hide repositories; partial results and request counts are disclosed. The checked-in `public/catalog.json` is an initial/fallback snapshot. The live API, homepage rendering, project pages, category pages and sitemap read D1, so newly discovered projects appear without rebuilding the site.

Local bootstrap tools remain available:

```sh
npm run catalog:sync              # authenticated gh or GITHUB_TOKEN, for a full local audit
npm run catalog:seed:local        # insert missing initial records into local D1
npm run catalog:seed:remote       # insert-only; preserves newer worker/editor records
```

`npm run catalog:sync -- --skip-search` intentionally skips GitHub discovery and refreshes known repositories plus supplemental feeds while retaining previous search provenance. The normal sync requires at least one successful or partial GitHub search; if all searches fail, it retains the published snapshot. `--accept-policy-change` is only for an editor-approved large reduction after inspecting `.cache/proposed-catalog.json`; automatic updates retain old data when checks fail.

The shared evidence policy distinguishes:

- **Official:** an allowlisted TypeSafe SDK/resource.
- **Documented:** a first-party usage statement or API/SDK reference.
- **Code reference:** an API identifier found in source, linked at a fixed commit.
- **Editor reviewed:** a human-approved source reference and classification.
- **Needs review:** retained historical data awaiting a successful check.

Local alternatives, research and directories are separate from applications that call Jev. Negative statements, image badges, bare recommendation links and downstream-user lists do not establish integration evidence. Stars measure the whole repository.

Editorial corrections belong in `catalog/overrides.json`; `codePaths` can point to an integration that is absent from the README. Transient failures keep published data and schedule a retry. Repeatedly unreachable repositories leave the active directory but retain a tombstone. An automatic removal floor prevents an unexpected mass disappearance.

Inspect `/status/`, `/api/catalog/status` and `/api/health` for source results, queued work, recent runs and the **real scheduled heartbeat (including durable alarms)**. Manual test runs do not fake that heartbeat. `/catalog.json` exports current public project data, and `/api/catalog?all=1` provides the compact browser index.

## Build and discovery pages

`npm run build` generates:

- Fifteen localized landing pages with canonical/hreflang metadata and a prerendered first page.
- One small language bundle per locale and a 20-entry initial catalog. The complete search index loads on interaction.
- `/projects/<owner>/<repo>/` with facts, evidence, related projects and source links.
- Crawlable `/browse/` and `/categories/<category>/` pagination, a complete sitemap, and redirects for known repository renames.
- `/methodology/`, `/status/`, and the private-use `/admin/` interface (noindex; access is checked by the API).
- `/build-info.json`, containing the source commit, catalog identity and hashes used to verify a release.

Generated static pages are fallback artifacts. Pages Functions render the live homepage, project details, category pagination, status and sitemap from D1. The code build and the live catalog each have their own version. `tools/stamp.mjs` versions assets and the imported catalog-state module to match the long cache lifetime.

Search, category, project type, language, archival state, sort order and page number persist in the URL. Locale switching and browser history preserve this state. Pages contain 20 independent results; pagination appears below the cards.

The homepage follows the supplied desktop/mobile redesign: a compact guide banner, prominent search, sidebar filters on desktop, collapsible filters on mobile and shared project cards. The data, counts and timestamps come from the catalog. `public/assets/css/directory.css` implements the layout, and the fonts are self-hosted with Unicode subsets. Light mode is the default; an explicit saved dark-mode preference is retained.

`GET /api/catalog?page=2&per_page=20` returns only the requested page with `pagination` metadata. Search and filters are applied in D1, and cache keys include normalized filters and the catalog revision. The homepage uses the same query for server rendering, so a direct link to page 6 returns items 101–120 before JavaScript runs. The `all=1` export remains available but is not required for live browsing. An initial static snapshot remains usable if live data is unavailable.

Project pages, static fallbacks and browser results share `public/assets/js/project-card.js`. Name, description and Details links open the localized project page; repository and evidence links stay external. The shared page renderer provides canonical URLs, language alternates, breadcrumb metadata and consistent analytics. Discovery events record counts and dimensions, not raw search terms.

Discovery health is separate from service liveness. `/api/catalog/status` reports each configured GitHub query, its current cursor, completed scan date, partial results and 24/72-hour repository-check coverage. Changing a query resets its cursor; GitHub ID merges retain rename aliases and withdrawal rules. Anonymous GitHub rate limits can still delay discovery.

The supported locales are English (`en`), Simplified Chinese (`zh-cn`), Traditional Chinese (`zh-tw`), Japanese (`ja`), Korean (`ko`), Spanish (`es`), French (`fr`), German (`de`), Brazilian Portuguese (`pt-br`), Russian (`ru`), Hindi (`hi`), Indonesian (`id`), Vietnamese (`vi`), Turkish (`tr`) and Italian (`it`). The 15 locale options represent 14 languages, counting both Chinese scripts separately. This selection prioritizes major developer markets; it is not a ranking by native speaker count. Right-to-left locales are outside the current scope.

`public/assets/js/i18n.js` is the locale source. The build validates message completeness and placeholders, generates the language menu and `shared/locales.js`, and uses that same inventory for edge routes and sitemap alternates. Each visitor downloads only their selected language bundle. The first 100 reviewed projects have localized detail bodies and listing/search summaries in all 15 locales. Other projects retain the earlier generated metadata and source descriptions. Code, source quotations and policy pages retain their source language. New locales link to the existing English OmniaKey integration guide and identify it as English.

## Project search metadata

Project titles lead with the project name and a localized, evidence-based use case.
Owners appear at the end only when active repository names collide. All 15 locale
routes use `shared/project-seo.js`; the English static fallback uses the same
generator. Meta descriptions, the visible introduction and social/schema descriptions
stay in sync. Original repository descriptions remain labeled as source text.

The wording rules and evidence boundaries are documented in
[`docs/project-seo-rules.md`](docs/project-seo-rules.md). Reviewed project-specific
details belong in `catalog/project-seo.json`; the locale vocabulary lives in
`shared/project-seo-copy.js`. Newly discovered repositories inherit these rules.
Migration 0007 indexes the active-name disambiguation lookup.

The first 100 projects by stars in the 2026-09-30 live capture now have separate,
source-backed content in `content/projects/`, selected by stable GitHub ID in
`content/project-selection.json`. These records take precedence over generated
metadata. Each contains 15 independently phrased TDH versions, a project summary,
four explanatory sections, pinned sources and a claim ledger. Categories and Jev
relationships are shared by details, listings, search and scheduled refreshes.

Migration 0008 stores full content separately from compact catalog previews.
Publishing checks record hashes, all locale rows and listing/search consistency.
The worker preserves reviewed copy and queues new or changed sources for review;
it does not generate or translate content automatically. This batch used Codex
writing and separate model review, with no paid model API calls. Search intents
are hypotheses, not measured search volumes, rankings or CTR results.

See [`docs/project-content-100.md`](docs/project-content-100.md) for the batch scope,
source restoration, review process and local/production publication commands.
`npm run build` checks the committed ledger and structure without an external
source archive. `npm run content:check` is the strict source-hash/quotation release
gate. These checks deliberately report different verification coverage.

Run `npm run audit:project-seo -- --static` after building to inspect every supported
locale and English fallback. Pass `--catalog /path/to/catalog.json --out reports/name`
to inspect a captured live catalog without replacing the checked-in snapshot. Reports
include exact before/after metadata and content-review flags; those flags do not
change indexing policy.

## Guides and FAQ content

`/blog/` contains task-specific Jev guides. `/faq/`, `/ja/faq/`, `/ko/faq/` and
`/pt-br/faq/` answer the corresponding English, Japanese, Korean and Portuguese
questions. The localized FAQs cover different tasks and are not declared as
equivalent translations with hreflang. Links to English content identify their
destination language.

Article HTML lives in `content/blog/`; questions live in `content/faq/`.
`content/editorial.json` owns titles, descriptions, related guides, routes and
the factual review date. `npm run build` renders these through the shared page
helper, adds localized navigation and writes the static sitemap. The live D1
sitemap uses the same editorial route inventory. Release verification checks
all generated content hashes, live sitemap inclusion and the referenced image.

`docs/gsc-intents-2026-09-29.md` records the public content-intent plan;
`docs/gsc-intent-plan.json` keeps anonymized row coverage for tests. Raw GSC
queries, workbook identifiers and performance metrics stay in local audit records.
`docs/editorial-evidence.md` records the sources and claim boundaries. Update evidence and the review date when changing factual
claims; interface compatibility is not evidence of identical model behavior.

The content tests check intent coverage, metadata, links, sitemap routes and
FAQ deep links. `npm run test:examples` also exercises the published document
classification snippet with the real SDK and an offline transport.

## Submission and editorial workflow

Google sign-in requires a verified email. Accounts are keyed by Google's stable subject; matching emails cannot rebind another account. Session lifetime is a fixed 30 days, matching the cookie. OAuth states are consumed atomically, and post-login redirects are restricted to the current origin.

Submissions require an authenticated same-origin JSON request, canonical GitHub repository URL, category and consent. Input size/type limits are enforced server-side. A single SQL statement enforces the five-per-hour quota and active-submission duplicate checks.

Configure the `ADMIN_EMAILS` encrypted Pages secret with a comma-separated list of authorized Google account emails, then sign in at `/admin/`. The queue uses cursor pagination so reviewing entries cannot skip later submissions. Approval requires a source URL pinned to a 40-character commit, a category, a relationship and a review note. Concurrent edits return a conflict.

`GET /api/catalog-submissions` exports approved public fields and withdrawn repository identifiers without submitter identities or private notes. D1 triggers atomically queue approved projects for the worker. Withdrawing a previously approved listing immediately excludes it from live queries and blocks rediscovery; approval removes the block. Rejected, never-approved submissions remain private. The administrator can also queue a discovery refresh through a private Worker service binding.

Database changes are additive and versioned under `migrations/`:

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

The original production tables were created before migration tracking. Migration 0001 uses `IF NOT EXISTS`, so the migrations runner can adopt that database safely.

## Deploying code

The Pages frontend and the private scheduler Worker share the existing D1 database. One SQLite Durable Object stores the timer; job progress and catalog records remain in D1. The worker has no public workers.dev or preview URL. Its manual endpoint is accessible through an administrator-authenticated Pages API and a private service binding.

Authenticate Wrangler once on the deployment machine. Keep the Google OAuth secret and `ADMIN_EMAILS` in encrypted Pages secrets:

```sh
npx wrangler login
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name jevhunt
npx wrangler pages secret put ADMIN_EMAILS --project-name jevhunt
npm run deploy
```

`npm run deploy` checks archived source evidence, builds and tests the site, applies additive database migrations, inserts missing bootstrap records, deploys the scheduled Worker, publishes and verifies the selected reviewed content, deploys Pages and verifies production. The content check fetches every selected locale page, compares its TDH/body/citations, verifies localized listing summaries and checks sitemap inclusion. Metadata updates continue automatically inside Cloudflare; editorial content changes require review and publication. No GitHub Actions deployment secret is required.

The existing public client ID and D1 binding are in `wrangler.toml`. Pages does not accept `account_id` in that file; use the environment if multiple Cloudflare accounts are available. The scheduler config is `workers/catalog-sync/wrangler.toml`.

Cloudflare can take several minutes to propagate a new Cron Trigger. Production verification requires a recent **automatic timer** invocation, a successful source check, the expected code build, live server-rendered catalog data, working D1, anonymous admin denial, logout cookie cleanup and a real 404. A deployment command returning success alone is not sufficient.

CI on pull requests and code branches builds the fallback artifacts, checks behavior and schema, validates the real SDK examples offline, and compiles both the Pages Functions and the Worker. CI does not publish catalog updates.

For local UI/API work:

```sh
npm run db:migrate:local
npm run catalog:seed:local
npx wrangler pages dev public --port 8788
```

Test the scheduler in a separate local sandbox. Two independent `workerd` processes must not open the same SQLite persistence files:

```sh
npx wrangler d1 migrations apply jevhunt-db --local --persist-to .cache/scheduler-state
node tools/seed-catalog.mjs --persist-to .cache/scheduler-state
npx wrangler dev --config workers/catalog-sync/wrangler.toml --port 8790 --persist-to .cache/scheduler-state --test-scheduled
```

`POST /start` arms the local durable timer; `POST /tick` advances a manual batch. `/__scheduled` tests Cron wake-up. Unit tests use isolated in-memory D1 databases. Use a Cloudflare preview deployment for the full shared-D1 integration test.

On a production incident, Pages deployment history can restore the previous code build. Worker versions can also be rolled back. Catalog data and retry cursors persist in D1; all schema changes are additive and the bootstrap is insert-only.

## Known scope

The directory covers discoverable public GitHub projects. It does not certify installation, security, performance, license compatibility, or the truth of every author claim. A public repository without a stated license is labeled accordingly. Source evidence and relationship labels make those limits inspectable.

JevHunt is independent and is not affiliated with TypeSafe AI. Product names belong to their respective owners.
