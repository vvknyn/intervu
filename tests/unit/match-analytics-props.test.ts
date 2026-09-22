import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAnalyticsProps } from "../../src/lib/analytics/match-props";
import type { MatchScore } from "../../src/lib/match/score";

function mkScore(total: number): MatchScore {
  return {
    total,
    components: [],
  };
}

test("matchAnalyticsProps returns {} for null and undefined", () => {
  assert.deepEqual(matchAnalyticsProps(null), {});
  assert.deepEqual(matchAnalyticsProps(undefined), {});
});

test("matchAnalyticsProps maps each band to label, band, and integer total", () => {
  assert.deepEqual(matchAnalyticsProps(mkScore(85)), {
    match_label: "Strong",
    match_score: 85,
    match_band: "strong",
  });
  assert.deepEqual(matchAnalyticsProps(mkScore(72)), {
    match_label: "Good",
    match_score: 72,
    match_band: "good",
  });
  assert.deepEqual(matchAnalyticsProps(mkScore(45)), {
    match_label: "Stretch",
    match_score: 45,
    match_band: "stretch",
  });
});

test("matchAnalyticsProps uses UI band boundaries (59 Stretch, 60 Good, 79 Good, 80 Strong)", () => {
  assert.deepEqual(matchAnalyticsProps(mkScore(59)), {
    match_label: "Stretch",
    match_score: 59,
    match_band: "stretch",
  });
  assert.deepEqual(matchAnalyticsProps(mkScore(60)), {
    match_label: "Good",
    match_score: 60,
    match_band: "good",
  });
  assert.deepEqual(matchAnalyticsProps(mkScore(79)), {
    match_label: "Good",
    match_score: 79,
    match_band: "good",
  });
  assert.deepEqual(matchAnalyticsProps(mkScore(80)), {
    match_label: "Strong",
    match_score: 80,
    match_band: "strong",
  });
});
