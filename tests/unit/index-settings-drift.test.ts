/**
 * scripts/check-index-settings-drift.mjs keeps a hand-written inline copy of
 * JOBS_INDEX_SETTINGS for the same reason apply-synonyms.mjs keeps one of
 * JOBS_SYNONYMS: it's a plain .mjs CLI script with no TypeScript loader, so
 * it can't import the .ts canon at runtime. The bug that motivated this
 * script (occupation missing from JOBS_INDEX_SETTINGS.filterableAttributes
 * while live task 467532 already carried it) was exactly this class of
 * silent drift, just between the repo and the live index instead of between
 * two files — so the parity test below applies the same discipline to the
 * inline copy: any future drift in EITHER direction fails a test instead of
 * a `node scripts/check-index-settings-drift.mjs` run silently comparing
 * against a stale expectation.
 *
 * The diffIndexSettings tests below cover settings OTHER than
 * filterableAttributes (the one that surfaced the original bug), proving the
 * fix is class-wide rather than re-detecting only that one instance.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JOBS_INDEX_SETTINGS as canonicalSettings } from "../../src/lib/jobs/meilisearch";
import { diffIndexSettings, JOBS_INDEX_SETTINGS as scriptSettings } from "../../scripts/check-index-settings-drift.mjs";

test("check-index-settings-drift.mjs's inline JOBS_INDEX_SETTINGS matches the canonical meilisearch.ts export", () => {
  assert.deepStrictEqual(scriptSettings, canonicalSettings);
});

test("diffIndexSettings — identical canonical and live settings produce no differences", () => {
  const settings = {
    filterableAttributes: ["a", "b"],
    searchCutoffMs: 5000,
  };
  assert.deepStrictEqual(diffIndexSettings(settings, settings), []);
});

test("diffIndexSettings — a live-only entry in a non-filterableAttributes setting is reported", () => {
  // Deliberately NOT filterableAttributes (the setting that surfaced the
  // original bug) — proves the diff is generic across whatever key differs.
  const canonical = { searchableAttributes: ["title", "company"] };
  const live = { searchableAttributes: ["title", "company", "description"] };

  const diffs = diffIndexSettings(canonical, live);

  assert.deepStrictEqual(diffs, [{ key: "searchableAttributes", canonOnly: [], liveOnly: ["description"] }]);
});

test("diffIndexSettings — a canon-only entry (declared in repo, missing from live) is reported", () => {
  const canonical = { rankingRules: ["words", "typo", "exactness"] };
  const live = { rankingRules: ["words", "typo"] };

  const diffs = diffIndexSettings(canonical, live);

  assert.deepStrictEqual(diffs, [{ key: "rankingRules", canonOnly: ["exactness"], liveOnly: [] }]);
});

test("diffIndexSettings — array order differences alone are NOT reported", () => {
  // Meilisearch's GET resorts some array settings (filterableAttributes
  // comes back alphabetically regardless of declared order — live-verified
  // 2026-08-24), so a same-elements-different-order array must not read as
  // drift, or the script would be permanently, falsely red.
  const canonical = { rankingRules: ["words", "typo", "sort"] };
  const live = { rankingRules: ["sort", "words", "typo"] };

  assert.deepStrictEqual(diffIndexSettings(canonical, live), []);
});

test("diffIndexSettings — non-array setting values are compared by deep equality", () => {
  const canonical = { searchCutoffMs: 5000, typoTolerance: { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } } };
  const live = { searchCutoffMs: 3000, typoTolerance: { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } } };

  const diffs = diffIndexSettings(canonical, live);

  assert.deepStrictEqual(diffs, [{ key: "searchCutoffMs", canonOnly: [5000], liveOnly: [3000] }]);
});

test("diffIndexSettings — only iterates canonical's own keys, never live-only keys not declared in canon", () => {
  const canonical = { searchCutoffMs: 5000 };
  const live = { searchCutoffMs: 5000, distinctAttribute: "title" };

  assert.deepStrictEqual(diffIndexSettings(canonical, live), []);
});
