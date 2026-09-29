import assert from "node:assert/strict";
import test from "node:test";
import config from "../catalog/sources.json" with { type: "json" };

test("GitHub Repository Search is the primary broad discovery source", () => {
  assert.ok(config.githubQueries.length >= 8);
  assert.ok(config.githubSearchMaxPages >= 100);
  assert.ok(config.githubQueries.some(query => /in:readme/.test(query)));
  assert.ok(config.githubQueries.some(query => /topic:jev/.test(query)));
  assert.ok(config.githubQueries.some(query => /jev-latest|TYPESAFE_API_KEY/.test(query)));
});
