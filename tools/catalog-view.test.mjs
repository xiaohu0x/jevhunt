import assert from "node:assert/strict";
import test from "node:test";
import { renderCard } from "../shared/catalog-view.js";

test("live server cards expose the same evidence and repository actions as client cards", () => {
  const html = renderCard({
    name: "Example", repo: "owner/example", desc: "A project", language: "Python", stars: 7,
    relationship: "jev-app", evidenceLevel: "documented", evidence: "https://github.com/owner/example/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/README.md",
    created: "2026-09-20", pushed: "2026-09-21", fork: true, archived: false, freshness: "current",
  }, { "relationship.jev-app": "Jev application", "evidence.documented": "Documented", "apps.evidence": "Evidence", "apps.fork": "Fork", "apps.published": "published {date}", "apps.updated": "updated {date}", "apps.starsLabel": "{count} GitHub stars" });
  assert.match(html, /class="card__go" href="https:\/\/github\.com\/owner\/example"/);
  assert.match(html, /class="card__site" href="https:\/\/github\.com\/owner\/example\/blob\//);
  assert.match(html, /published 2026-09-20/);
  assert.match(html, /updated 2026-09-21/);
  assert.match(html, /aria-label="7 GitHub stars"/);
  assert.doesNotMatch(html, />Details →</);
});
