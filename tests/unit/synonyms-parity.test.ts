/**
 * scripts/apply-synonyms.mjs keeps a hand-written inline copy of JOBS_SYNONYMS
 * because it's a plain .mjs CLI script with no TypeScript loader — it can't
 * import the canonical .ts source at runtime. That copy silently drifted
 * from src/lib/jobs/meilisearch.ts's export once already (4 reverse-direction
 * entries present live and in neither file, caught only by a manual probe of
 * the live index) despite a comment saying "update both together."
 *
 * This test imports BOTH real sources and asserts deep equality, so any
 * future drift — a key added, removed, or changed in either file, for any
 * abbreviation, not just today's four — fails the test instead of a `node
 * scripts/apply-synonyms.mjs` run silently PUTting a stale synonym set.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JOBS_SYNONYMS as canonicalSynonyms } from "../../src/lib/jobs/meilisearch";
import { JOBS_SYNONYMS as scriptSynonyms } from "../../scripts/apply-synonyms.mjs";

test("apply-synonyms.mjs's inline JOBS_SYNONYMS matches the canonical meilisearch.ts export", () => {
  assert.deepStrictEqual(scriptSynonyms, canonicalSynonyms);
});

test("the canonical export is non-empty (guards against a vacuous pass if both sides were emptied)", () => {
  assert.ok(Object.keys(canonicalSynonyms).length > 0);
});
