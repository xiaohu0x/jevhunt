import assert from "node:assert/strict";
import test from "node:test";
import { evidenceIn } from "./catalog-policy.mjs";

test("rejects names and TypeSafe references without technical Jev evidence", () => {
  assert.equal(evidenceIn("# eve\nA web framework from Vercel."), null);
  assert.equal(evidenceIn("# PocketJev\nA small offline utility."), null);
  assert.equal(evidenceIn("An evaluation of TypeSafe AI chess."), null);
  assert.equal(evidenceIn("Learn more at https://typesafe.ai/"), null);
});

test("accepts explicit Jev and System One integration signals", () => {
  assert.equal(evidenceIn("Set JEV_API_KEY before starting."), "jev-api-key");
  assert.equal(evidenceIn("Powered by TypeSafe Jev."), "typesafe-jev");
  assert.equal(evidenceIn("Uses TypeSafe's System One evaluation API."), "typesafe-system-one");
  assert.equal(evidenceIn("POST decisions to /v1/systemone."), "system-one-api");
  assert.equal(evidenceIn("Install @typesafe-ai/sdk."), "typesafe-sdk");
  assert.equal(evidenceIn("Call Jev through the API. Jev returns a typed decision."), "jev-decision-context");
});
