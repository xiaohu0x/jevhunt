# JevHunt

JevHunt is a static directory of public Jev projects. Visitors receive HTML, JavaScript and JSON from Cloudflare Pages. Search, filters and pagination run in the browser. Production requests do not use D1, Pages Functions, Workers, Durable Objects or paid model APIs.

## Local development

Use Node 24:

```sh
npm ci
npm run build
npm test
npm run check:static
```

The build uses the committed `public/catalog.json` snapshot and reviewed content in `content/projects/`. It performs no source synchronization. `npm run deploy:check` validates an isolated static upload without publishing.

## Daily updates and manual sync

`.github/workflows/catalog-daily.yml` runs once a day at 10:17 UTC on the public repository's standard Ubuntu runner. It also supports **Actions → Daily static catalog → Run workflow** for an owner-triggered manual run. Both use the same persisted UTC daily reservation, so a manual run consumes that day's automatic slot. A failed run also consumes its slot. GitHub may delay scheduled runs; the site continues serving its last successful release.

The workflow stops when the repository becomes private. It uses no Actions caches or uploaded artifacts. Standard runners for public repositories and static Cloudflare Pages requests are free under the providers' current pricing.

Each batch has fixed limits:

- At most 100 outbound source-request attempts, including retries.
- At most 20 repository checks, including at most 10 new projects.
- Two search pages, rotating through the configured discovery queries.
- At least one second between source requests; a four-minute source-processing deadline and six-minute workflow step timeout.
- Unchecked projects and transient failures retain their previous data. Unverified new projects remain pending. This is incremental coverage, not a daily full audit.

Run manually from an updated checkout with authenticated `gh` or a `GITHUB_TOKEN`:

```sh
git pull --ff-only
npm run catalog:sync
npm run build
npm test
npm run check:static
```

`catalog/sync-state.json` stores the daily attempt, rotating query position and pending candidates. Keep it with the updated catalog when committing. Local attempts are limited by the state in that checkout; use the GitHub workflow when coordinating with automatic updates. No sync is triggered by building or browsing the site.

## Static publication

One-time workflow configuration:

- Repository secret `JEVHUNT_PAGES_TOKEN`: a dedicated Cloudflare token with **Cloudflare Pages: Edit**, scoped to the hosting account. Do not use an account-wide administrator credential.
- Repository variable `CLOUDFLARE_ACCOUNT_ID`: the hosting account ID.
- Set repository variable `JEVHUNT_DAILY_ENABLED` to `true` only after the publishing credential is configured. Without it, both scheduled and manual workflow jobs are skipped. Missing publishing credentials stop a run before any source requests.

Cloudflare Pages does not support narrowing this permission to one Pages project; the publishing code always targets `jevhunt`. Keep the token in GitHub encrypted secrets, never in this repository.

```sh
npm run deploy
```

Deployment builds, tests, checks the free plan limits, and uploads from a temporary directory outside the repository. That directory contains only static assets, so Wrangler cannot discover the legacy `functions/` tree or its bindings. The Pages configuration has no database or service bindings, and `_routes.json` excludes every request from Functions as an additional safeguard.

Publication stops above 5,000 files (one quarter of the free plan limit), 12 MiB per asset, or Pages redirect limits; it never upgrades a plan. If the daily build or publication fails, the previously deployed website remains available.

`npm run verify:production` checks the static build identity, assets, catalog, example pages and sitemap. It also verifies that the old API routes are unavailable.

The `www.jevhunt.com` canonical redirect belongs in a free Cloudflare redirect rule. Pages `_redirects` supports paths, not domain-level sources. Preview deployments use Cloudflare Access so historical dynamic deployments are not publicly callable.

The old Cloudflare scheduler is retired. `npm run retire:worker` publishes a no-op handler with no Cron or D1 binding, and its preserved Durable Object class cancels legacy alarms. Ordinary website deployment never deploys or starts it. Historical D1 data is retained separately; restoring an old dynamic deployment can still create database reads.

Account-level Workers subscriptions, other projects and domain registration are separate from this site's static hosting. This repository does not cancel shared account subscriptions or delete historical databases.

## Site behavior

- All projects remain searchable and browsable. The 750 priority projects (including all reviewed projects) retain independent static English pages. Other projects use a shared page that reads one of 64 static JSON shards in the browser. Their search-engine visibility may be lower because the content requires JavaScript. Old detail URLs are recovered by the custom 404 page and redirected to the shared page.
- Reviewed projects retain their complete translated detail pages in 15 locales. Other localized detail links redirect to the English page, keeping the free file limit practical.
- Launch days, task pages, collections and recommendations are generated during the build. Localized launch pages cover the latest 30-day snapshot window and the first result page; older launch dates and later task/launch pages redirect to the full English archive to keep the file budget below one quarter of the free plan.
- Search loads one versioned static catalog index on interaction; query, filters, page and sort persist in the URL.
- Comparison fetches a static metadata file.
- Submissions and corrections use GitHub issues. Google sign-in and database-backed submission forms are no longer offered.
- `/status/` and `/catalog-audit.json` show the snapshot and batch results; a batch timestamp is not a claim that every project was rechecked that day.

## Content and evidence

Project facts and descriptions must be supported by the linked repository sources. Labels distinguish official SDKs, documented integrations, code references, editorially reviewed evidence, local alternatives and research. A source reference is not a runtime or security test. Stars measure the whole repository.

Reviewed content, localization and source verification are described in `docs/project-content-100.md`, `docs/project-seo-rules.md` and `docs/editorial-evidence.md`. `npm run content:check` verifies archived source hashes; the normal build checks the committed ledger and content structure. Blog/FAQ source lives under `content/` and is generated during the build.

Legacy live API code and migrations remain for historical data maintenance and offline tests. They are not part of the static production service.
