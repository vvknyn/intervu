import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_VOCABULARY, GHOST_BADGE_STATUS } from "../../src/lib/presentation/status";
import { GHOST_META } from "../../src/lib/jobs/presentation";
import { LISTING_STATE_TEXT } from "../../src/lib/ui/status-tokens";

test("clear/review/likely_ghost labels and tones are derived from GHOST_META, not a second copy", () => {
  assert.equal(STATUS_VOCABULARY.clear.label, GHOST_META.clear!.label);
  assert.equal(STATUS_VOCABULARY.clear.tone, GHOST_META.clear!.cls);
  assert.equal(STATUS_VOCABULARY.review.label, GHOST_META.caution!.label);
  assert.equal(STATUS_VOCABULARY.review.tone, GHOST_META.caution!.cls);
  assert.equal(STATUS_VOCABULARY.likely_ghost.label, GHOST_META.likely_ghost!.label);
  assert.equal(STATUS_VOCABULARY.likely_ghost.tone, GHOST_META.likely_ghost!.cls);
});

test("relisted tone is derived from LISTING_STATE_TEXT, not a hand-picked color", () => {
  assert.equal(STATUS_VOCABULARY.relisted.tone, LISTING_STATE_TEXT.relisted);
  assert.ok(STATUS_VOCABULARY.relisted.label.length > 0);
});

test("every vocabulary entry has a non-empty label and tone", () => {
  for (const status of Object.keys(STATUS_VOCABULARY) as (keyof typeof STATUS_VOCABULARY)[]) {
    assert.ok(STATUS_VOCABULARY[status].label.length > 0, status);
    assert.ok(STATUS_VOCABULARY[status].tone.length > 0, status);
  }
});

test("GHOST_BADGE_STATUS maps every ghost_badge value onto the vocabulary (or null for unscored)", () => {
  assert.equal(GHOST_BADGE_STATUS.clear, "clear");
  assert.equal(GHOST_BADGE_STATUS.caution, "review");
  assert.equal(GHOST_BADGE_STATUS.likely_ghost, "likely_ghost");
  assert.equal(GHOST_BADGE_STATUS.unscored, null);
});
