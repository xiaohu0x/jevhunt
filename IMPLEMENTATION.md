# JevHunt completion goal

Started 2026-09-24 from `ce237640fc7b1a944204de855403a69ecdd939f4`.

- [x] Authentication: safe redirects, headers/cookies, fixed session expiry, atomic OAuth state, verified identity without email account takeover.
- [x] Submissions: bounded typed input, atomic quota, duplicate protection, moderation UI/API, approved export and catalog merge.
- [x] Catalog: multiple independent sources, paginated GitHub discovery, canonical repository IDs, metadata, evidence levels, explicit ecosystem types, provenance and failure retention.
- [x] Content: official runnable SDK examples, factual copy in all locales, current documentation links and dated sources.
- [x] Discovery UI: URL state, language/type/archive filters, evidence links, project details, category pages, crawlable pagination, localized assets.
- [x] Automation: locked dependencies, PR CI, Cloudflare Cron + D1 live updates, code deployment, version verification, stale/failure monitoring, operational documentation.
- [ ] Verification: behavior tests, full real catalog refresh, production migration/deployment, deployed content and API checks.

Acceptance: no claim of exhaustive coverage or runtime verification from keyword matches; every published listing has traceable evidence and a distinct relationship to Jev. Failed fetches retain the last known good state and disclose freshness. Approved submissions survive refresh. A successful release is confirmed by the actual production snapshot hash.

Architecture decision: user explicitly chose Cloudflare Worker cron for data updates. GitHub is only source control and CI; no GitHub-hosted data publisher or Cloudflare API token secret is required. Pages reads the live D1 catalog and renders new project URLs dynamically.

Cloud verification: preview https://9753f01a.jevhunt.pages.dev serves live D1 data (3,906 projects). The private scheduler uses a Durable Object alarm with Cron wake-up. Multiple automatic 60-second runs have been observed in production D1; final public release verification remains.
