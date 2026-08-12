/**
 * Ranking-rule ORDER guards.
 *
 * Meilisearch applies `rankingRules` strictly lexicographically: each rule
 * fully partitions the result set before the next one is consulted. Order is
 * therefore behaviour, not style, and a reorder is invisible in review — it
 * changes no logic and breaks no type. These assertions exist because the
 * order has now been changed twice in opposite directions (S3, then the
 * 2026-08-12 measurement that falsified S3's rationale); the next person to
 * touch it should have to delete a named invariant rather than a comment.
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
