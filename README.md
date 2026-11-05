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

## Daily picks and manual sync

The homepage selects 1–8 existing projects each UTC day using a deterministic shuffle in the visitor's browser. Everyone sees the same selection for that day and snapshot, across languages and refreshes. It shows a 30-day chart and date groups for today, yesterday and the day before. Clicking a bar opens that day's selection, with previous/next navigation and a shareable `?pick-day=YYYY-MM-DD` URL. Yesterday's selection stays the same when the calendar advances.

The section is labelled **Daily picks**. It does not claim projects were created or updated that day. Repository dates, stars and source checks remain those of the saved snapshot. The initial HTML includes the chart, three dated groups and a small selection seed covering the last 30 days plus the coming week. Those dates work without downloading the full catalog; later dates load one cacheable static JSON pool and reuse it for subsequent navigation and midnight changes. The complete dated layout remains visible if JavaScript or the network fails. Archived projects, forks, directories and listings without descriptions are excluded from the daily pool. No scheduled job, database query, source synchronization or daily deployment is needed.

There is no automatic synchronization workflow or publishing secret. The owner can optionally run a manual source update with fixed limits:

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

`catalog/sync-state.json` stores the attempt date, rotating query position and pending candidates. It allows at most one manual attempt per UTC day in that checkout, including failed attempts. Keep it with the updated catalog when committing. No sync is triggered by building or browsing the site.

## Static publication

Publish manually using your local Cloudflare login:

```sh
npm run deploy
```

Deployment builds, tests, checks the free plan limits, and uploads from a temporary directory outside the repository. That directory contains only static assets, so Wrangler cannot discover the legacy `functions/` tree or its bindings. The Pages configuration has no database or service bindings, and `_routes.json` excludes every request from Functions as an additional safeguard.

Publication stops above 5,000 files (one quarter of the free plan limit), 12 MiB per asset, or Pages redirect limits; it never upgrades a plan. If a build or publication fails, the previously deployed website remains available.

`npm run verify:production` checks the static build identity, assets, catalog, example pages and sitemap. It also verifies that the old API routes are unavailable.

The `www.jevhunt.com` canonical redirect belongs in a free Cloudflare redirect rule. Pages `_redirects` supports paths, not domain-level sources. Preview deployment access remains protected by Cloudflare Access.

On 2026-11-05, the unused `jevhunt-db` database, `jevhunt-catalog-sync` Worker, its `CatalogClock` Durable Object namespace, historical Pages deployments and obsolete Pages login secrets were removed. Only the current static Pages deployment and its domain configuration remain for this site. The scheduler's deployment configuration and command were removed from this repository so ordinary maintenance cannot recreate it.

Before deletion, the complete D1 database was exported and restored locally: integrity checks passed for all 16 tables and 20,609 catalog entries. This private backup is stored outside the repository; the website's static catalog contains 5,191 projects. Preserve the SQL backup if historical data may be needed. Restoring a dynamic service requires an explicit new deployment and can create usage charges.

Account-level Workers subscriptions, other projects and domain registration are separate from this site's static hosting. They were not changed by this cleanup.

## Site behavior

- All projects remain searchable and browsable. The 750 priority projects (including all reviewed projects) retain independent static English pages. Other projects use a shared page that reads one of 64 static JSON shards in the browser. Their search-engine visibility may be lower because the content requires JavaScript. Old detail URLs are recovered by the custom 404 page and redirected to the shared page.
- Reviewed projects retain their complete translated detail pages in 15 locales. Other localized detail links redirect to the English page, keeping the free file limit practical.
- Launch days, task pages, collections and recommendations are generated during the build. Localized launch pages cover the latest 30-day snapshot window and the first result page; older launch dates and later task/launch pages redirect to the full English archive to keep the file budget below one quarter of the free plan.
- Search loads one versioned static catalog index on interaction; query, filters, page and sort persist in the URL.
- Comparison fetches a static metadata file.
- Submissions and corrections use GitHub issues. Google sign-in and database-backed submission forms are no longer offered.
- `/status/` and `/catalog-audit.json` show the snapshot and manual update results; the daily selection date is separate from source-check dates.

## Content and evidence

Project facts and descriptions must be supported by the linked repository sources. Labels distinguish official SDKs, documented integrations, code references, editorially reviewed evidence, local alternatives and research. A source reference is not a runtime or security test. Stars measure the whole repository.

Reviewed content, localization and source verification are described in `docs/project-content-100.md`, `docs/project-seo-rules.md` and `docs/editorial-evidence.md`. `npm run content:check` verifies archived source hashes; the normal build checks the committed ledger and content structure. Blog/FAQ source lives under `content/` and is generated during the build.

Legacy live API code and migrations remain for historical data maintenance and offline tests. They are not part of the static production service.
