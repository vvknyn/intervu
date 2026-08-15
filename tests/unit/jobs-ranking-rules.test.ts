/**
 * Ranking-rule ORDER guards.
 *
 * Meilisearch applies `rankingRules` strictly lexicographically: each rule
 * fully partitions the result set before the next one is consulted. Order is
 * therefore behaviour, not style, and a reorder is invisible in review — it
 * changes no logic and breaks no type. These assertions exist because the
 * order has now been changed four times (S3, the 2026-08-12 measurement that
 * falsified S3's rationale, 2026-08-13 moving `sort` ahead of
 * typo/proximity/attributeRank/wordPosition too once #177's placement was
 * itself shown to still bucket instead of sorting globally, then 2026-08-14
 * moving `typo` back ahead of `sort` so an explicit sort can no longer let a
 * fuzzy/typo admit outrank an exact match — google-serp semantics); the next
 * person to touch it should have to delete a named invariant rather than a
 * comment.
 *
 * Assertions target the PROPERTIES the order must hold, not the literal
 * array, so the next reorder (there will be one) fails at the specific
 * invariant it breaks instead of a raw deepEqual diff.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS_INDEX_SETTINGS } from "../../src/lib/jobs/meilisearch";

const rules = JOBS_INDEX_SETTINGS.rankingRules;
const at = (name: string) => rules.indexOf(name);

describe("jobs index rankingRules order", () => {
  it("puts `sort` ahead of `exactness` so an explicit sort wins", () => {
    // The bug this was written for: with `exactness` first, "freshest" could
    // only reorder WITHIN an exactness tier, so a 32-day-old bare title
    // outranked a 1-day-old specific one under a control labelled FRESHEST.
    assert.ok(at("sort") >= 0, "`sort` rule missing entirely");
    assert.ok(at("exactness") >= 0, "`exactness` rule missing entirely");
    assert.ok(
      at("sort") < at("exactness"),
      `sort must precede exactness; got ${JSON.stringify(rules)}`,
    );
  });

  it("puts `typo` ahead of `sort` so a typo/fuzzy admit can never outrank an exact match under an explicit sort", () => {
    // 2026-08-14: measured live (q="product manager", scoped to
    // title+company, fresh sort) 18 of the first 200 hits were typo/company
    // admits — e.g. "Produce Manager" (1-typo on "product"). Putting `typo`
    // ahead of `sort` makes `typo` fully partition the result set into
    // typo-count buckets BEFORE `sort` runs, so `sort` only ever reorders
    // WITHIN a bucket — an exact (0-typo) match can no longer be outranked
    // by a fuzzy one just because the fuzzy one is newer/higher-salary.
    assert.ok(at("typo") >= 0, "`typo` rule missing entirely");
    assert.ok(
      at("typo") < at("sort"),
      `typo must precede sort; got ${JSON.stringify(rules)}`,
    );
  });

  it("puts `sort` ahead of proximity/attributeRank/wordPosition too", () => {
    // 2026-08-12's `sort < exactness` alone wasn't enough: `sort` still sat
    // after proximity/attributeRank/wordPosition, so it only reordered
    // WITHIN whichever bucket those rules already produced — a bare
    // "Product Manager" 32 days old could still outrank a 1-day-old specific
    // title under an explicit freshest sort.
    for (const rule of ["proximity", "attributeRank", "wordPosition"]) {
      assert.ok(
        at("sort") < at(rule),
        `sort must precede ${rule}; got ${JSON.stringify(rules)}`,
      );
    }
  });

  it("keeps `posted_ts:desc` last so recency is a tiebreak, never a substitute", () => {
    // A DIFFERENT failure than the one above: promoting this rule would make
    // recency outrank relevance outright and turn every search into a feed.
    assert.equal(rules[rules.length - 1], "posted_ts:desc");
  });

  it("keeps `words` first so match completeness outranks everything", () => {
    assert.equal(rules[0], "words");
  });

  it("declares posted_ts sortable — the `sort` rule is inert without it", () => {
    // Ordering `sort` correctly buys nothing if the field it sorts on was
    // never declared sortable; Meilisearch rejects the sort and the UI
    // silently falls back to relevance while still claiming "newest first".
    assert.ok(JOBS_INDEX_SETTINGS.sortableAttributes.includes("posted_ts"));
  });

  it("lists each rule exactly once", () => {
    assert.equal(new Set(rules).size, rules.length, `duplicate rule in ${JSON.stringify(rules)}`);
  });
});
