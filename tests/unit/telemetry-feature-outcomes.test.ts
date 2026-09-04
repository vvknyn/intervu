import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  positionCorrectedRate,
  bucketFeatureValue,
  enumerateFeatureBuckets,
  aggregateFeatureOutcomes,
  EXCLUDED_FEATURE_COLUMNS,
  type FeatureOutcomeRow,
  type OutcomeEventRow,
} from "../../src/lib/telemetry/feature-outcomes";
import type { JobFeatures } from "../../src/lib/telemetry/features";

function closeTo(actual: number, expected: number, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be close to ${expected}`);
}

describe("positionCorrectedRate — position confound", () => {
  // Two buckets with IDENTICAL per-position click rates (50% at position 1,
  // 10% at position 5) but opposite volume skew: X gets most of its traffic
  // at the good slot, Y gets most of its traffic at the bad slot. A pooled
  // ("uncorrected") rate mistakes that volume skew for a quality difference;
  // the position-corrected rate must see through it and call them equal.
  const rows: FeatureOutcomeRow[] = [
    { feature: "demo", bucket: "X", position: 1, impressions: 1000, clicks: 500, applies: 0 },
    { feature: "demo", bucket: "X", position: 5, impressions: 10, clicks: 1, applies: 0 },
    { feature: "demo", bucket: "Y", position: 1, impressions: 10, clicks: 5, applies: 0 },
    { feature: "demo", bucket: "Y", position: 5, impressions: 1000, clicks: 100, applies: 0 },
  ];
  const evenWeights = new Map([[1, 0.5], [5, 0.5]]);

  it("position-corrected rates are equal for buckets with identical per-position performance", () => {
    const x = positionCorrectedRate(rows, "X", "clicks", evenWeights)!;
    const y = positionCorrectedRate(rows, "Y", "clicks", evenWeights)!;
    closeTo(x.rate, 0.3);
    closeTo(y.rate, 0.3);
    assert.equal(x.rate, y.rate);
  });

  it("the pooled (uncorrected) rate, in contrast, falsely reports X and Y as very different", () => {
    const x = positionCorrectedRate(rows, "X", "clicks", evenWeights)!;
    const y = positionCorrectedRate(rows, "Y", "clicks", evenWeights)!;
    assert.ok(x.uncorrectedRate > 0.45, `expected X uncorrected > 0.45, got ${x.uncorrectedRate}`);
    assert.ok(y.uncorrectedRate < 0.15, `expected Y uncorrected < 0.15, got ${y.uncorrectedRate}`);
    assert.notEqual(x.uncorrectedRate, y.uncorrectedRate);
  });

  it("returns null for a bucket with no rows at all, rather than a headline built from nothing", () => {
    assert.equal(positionCorrectedRate(rows, "nonexistent", "clicks", evenWeights), null);
  });

  it("returns null when none of the reference positions have any impressions", () => {
    const noWeightOverlap = new Map([[99, 1]]);
    assert.equal(positionCorrectedRate(rows, "X", "clicks", noWeightOverlap), null);
  });

  it("renormalizes over only the reference positions actually covered", () => {
    // Position 2 is in the reference distribution but has no row for bucket X.
    const weightsWithGap = new Map([[1, 0.5], [2, 0.25], [5, 0.25]]);
    const x = positionCorrectedRate(rows, "X", "clicks", weightsWithGap)!;
    // Only positions 1 and 5 covered (weight 0.5 + 0.25 = 0.75 of the total);
    // renormalized average should still be (0.5*0.5 + 0.25*0.1) / 0.75.
    closeTo(x.rate, (0.5 * 0.5 + 0.25 * 0.1) / 0.75);
    assert.equal(x.positionsCovered, 2);
  });

  it("n is exactly the impression count behind rate — not a wider pool that includes rows outside the reference distribution", () => {
    // Position 50 is outside evenWeights' reference distribution (1 and 5
    // only). It must not leak into X's `n` or `uncorrectedRate`: those must
    // describe exactly the rows `rate` averaged over, never a bigger pool,
    // or a consumer computing a CI from (rate, n) — or comparing rate to
    // uncorrectedRate — would be reasoning about two different samples.
    const withStrayRow: FeatureOutcomeRow[] = [
      ...rows,
      { feature: "demo", bucket: "X", position: 50, impressions: 5000, clicks: 5000, applies: 0 },
    ];
    const baseline = positionCorrectedRate(rows, "X", "clicks", evenWeights)!;
    const withStray = positionCorrectedRate(withStrayRow, "X", "clicks", evenWeights)!;
    assert.equal(withStray.rate, baseline.rate);
    assert.equal(withStray.n, baseline.n);
    assert.equal(withStray.uncorrectedRate, baseline.uncorrectedRate);
    // And n itself is exactly the impressions from the two covered positions
    // (1000 + 10), i.e. the same rows `rate`'s weighted sum was built from.
    assert.equal(withStray.n, 1010);
  });
});

describe("bucketFeatureValue — dispatches on type, not column name", () => {
  it("null/undefined -> null ('not stated', never guessed into a bucket)", () => {
    assert.equal(bucketFeatureValue(null), null);
    assert.equal(bucketFeatureValue(undefined), null);
  });

  it("boolean -> 'true'/'false'", () => {
    assert.equal(bucketFeatureValue(true), "true");
    assert.equal(bucketFeatureValue(false), "false");
  });

  it("string -> itself, verbatim", () => {
    assert.equal(bucketFeatureValue("bachelor"), "bachelor");
  });

  it("number -> an order-of-magnitude range bucket", () => {
    assert.equal(bucketFeatureValue(0), "0");
    assert.equal(bucketFeatureValue(-5), "0");
    assert.equal(bucketFeatureValue(5), "1-10");
    assert.equal(bucketFeatureValue(42), "10-100");
    assert.equal(bucketFeatureValue(150_000), "100000-1000000");
  });

  it("boundary: a value at the top of a magnitude belongs to the NEXT bucket, never a gap", () => {
    // Half-open at every magnitude: [10^m, 10^(m+1)). 10 is the first value
    // of magnitude 1, so it must land in "10-100", not "1-10"; 9.999 is
    // still magnitude 0, so it stays in "1-10".
    assert.equal(bucketFeatureValue(10), "10-100");
    assert.equal(bucketFeatureValue(9.999), "1-10");
  });

  // Table-driven: every non-guarded input must produce a well-formed,
  // ascending range — not just the two values (0.5, 0.05) that first
  // surfaced the bug. 0 and a negative both hit the "not a real magnitude"
  // guard and return the sentinel bucket "0", which is not itself a range.
  // 99.5 and 999.5 are not salary_span_pct-shaped at all — they prove the
  // half-open fix holds at every magnitude boundary, not just the one
  // (9.x) that salary_span_pct happened to surface.
  const magnitudeCases: Array<{ value: number; expected: string }> = [
    { value: 0, expected: "0" },
    { value: -5, expected: "0" },
    { value: 0.001, expected: "0.001-0.01" },
    { value: 0.05, expected: "0.01-0.1" },
    { value: 0.5, expected: "0.1-1" },
    { value: 1, expected: "1-10" },
    { value: 9.9, expected: "1-10" },
    { value: 9.999, expected: "1-10" },
    { value: 10, expected: "10-100" },
    { value: 99, expected: "10-100" },
    { value: 99.5, expected: "10-100" },
    { value: 100, expected: "100-1000" },
    { value: 999.5, expected: "100-1000" },
    { value: 1000, expected: "1000-10000" },
  ];

  for (const { value, expected } of magnitudeCases) {
    it(`bucketFeatureValue(${value}) -> "${expected}"`, () => {
      const label = bucketFeatureValue(value);
      assert.equal(label, expected);

      if (value <= 0) {
        // Guard path: no magnitude to bucket, so no range is expected.
        assert.equal(label, "0");
        return;
      }

      // Structural invariant, independent of the hand-written string above:
      // a well-formed range is non-empty, has exactly one separator, and
      // parses to an ascending (lower < upper) pair. This is what catches
      // inputs nobody thought to hand-write an expected string for.
      assert.ok(label && label.length > 0, "label must be non-empty");
      const parts = label!.split("-");
      assert.equal(parts.length, 2, `expected exactly one '-' separator, got "${label}"`);
      const [lower, upper] = parts.map(Number);
      assert.ok(Number.isFinite(lower) && Number.isFinite(upper), `both bounds must parse as numbers: "${label}"`);
      assert.ok(lower < upper, `expected ascending range, got lower=${lower} upper=${upper} ("${label}")`);

      // The actual contract: the label's own range must contain the value
      // that produced it. This is the exact property the pre-fix code
      // violated for any fractional value landing between 10^(m+1)-1 and
      // 10^(m+1) (e.g. salary_span_pct = 9.5 labelled "1-9").
      assert.ok(
        lower <= value && value < upper,
        `expected ${lower} <= ${value} < ${upper} for label "${label}"`
      );
    });
  }

  it("property: across a spread of magnitudes both below and above 1, every label's range contains the value that produced it", () => {
    // Magnitudes -3..6 stay well clear of the documented out-of-domain
    // floor (~1e-6, where 10**magnitude switches to exponential notation
    // and breaks label parsing) while still spanning sub-1 and multi-digit
    // magnitudes on both sides of the old bug's boundary.
    for (let magnitude = -3; magnitude <= 6; magnitude++) {
      const base = 10 ** magnitude;
      // Sample across the whole magnitude, including just below the next
      // boundary — exactly where the closed-interval bug left its gap.
      const samples = [base, base * 1.5, base * 5, base * 9.5, base * 9.999];
      for (const value of samples) {
        const label = bucketFeatureValue(value);
        assert.ok(label, `expected a label for ${value}`);
        const [lo, hi] = label!.split("-").map(Number);
        assert.ok(
          lo <= value && value < hi,
          `bucketFeatureValue(${value}) = "${label}" violates lo <= value < hi`
        );
      }
    }
  });
});

// Minimal but complete JobFeatures fixture — every field present so tests
// can override just the ones under test.
function features(overrides: Partial<JobFeatures>): JobFeatures {
  return {
    job_id: overrides.job_id ?? "job-1",
    computed_at: "2026-09-03T00:00:00.000Z",
    description_chars: null,
    bullet_count: null,
    paragraph_count: null,
    section_count: null,
    requirement_count: null,
    responsibility_count: null,
    title_chars: 20,
    title_word_count: 3,
    has_salary: false,
    salary_min: null,
    salary_max: null,
    salary_span_pct: null,
    has_equity_mention: null,
    has_benefits_section: null,
    benefit_count: null,
    has_visa_statement: null,
    has_eeo_boilerplate: null,
    years_experience_min: null,
    degree_required: null,
    degree_level: null,
    named_tech_count: null,
    has_nice_to_have_section: null,
    seniority_word: null,
    is_remote: null,
    is_hybrid: null,
    is_onsite: null,
    employment_type: null,
    apply_method: "direct",
    screening_question_count: null,
    ats_provider: null,
    first_seen_at: null,
    posted_at: null,
    repost_count: null,
    days_open: null,
    ...overrides,
  };
}

describe("enumerateFeatureBuckets", () => {
  it("never emits identifier/date columns as features", () => {
    const pairs = enumerateFeatureBuckets(features({ has_salary: true }));
    for (const { feature } of pairs) {
      assert.ok(
        !EXCLUDED_FEATURE_COLUMNS.has(feature as keyof JobFeatures),
        `${feature} should have been excluded`,
      );
    }
  });

  it("skips every null column — a posting contributes only what it stated", () => {
    const pairs = enumerateFeatureBuckets(features({}));
    // has_salary/title_chars/title_word_count/apply_method are the only
    // non-null, non-excluded columns on the bare fixture.
    const names = pairs.map((p) => p.feature).sort();
    assert.deepEqual(names, ["apply_method", "has_salary", "title_chars", "title_word_count"]);
  });

  it("includes a stated feature with its correctly-typed bucket", () => {
    const pairs = enumerateFeatureBuckets(
      features({ has_salary: true, salary_min: 120_000, degree_level: "bachelor" }),
    );
    const byFeature = new Map(pairs.map((p) => [p.feature, p.bucket]));
    assert.equal(byFeature.get("has_salary"), "true");
    assert.equal(byFeature.get("salary_min"), "100000-1000000");
    assert.equal(byFeature.get("degree_level"), "bachelor");
  });
});

describe("aggregateFeatureOutcomes — the only path from events to rows", () => {
  const featuresByJobId = new Map<string, JobFeatures>([
    ["job-with-salary", features({ job_id: "job-with-salary", has_salary: true })],
    ["job-no-salary", features({ job_id: "job-no-salary", has_salary: false })],
  ]);

  it("fans one event out to every (feature, bucket) pair its job qualifies for, at that event's position", () => {
    const events: OutcomeEventRow[] = [
      { job_id: "job-with-salary", position: 3, kind: "impression" },
      { job_id: "job-with-salary", position: 3, kind: "click" },
    ];
    const rows = aggregateFeatureOutcomes(events, featuresByJobId);
    const hasSalaryRow = rows.find((r) => r.feature === "has_salary" && r.bucket === "true");
    assert.ok(hasSalaryRow);
    assert.equal(hasSalaryRow!.position, 3);
    assert.equal(hasSalaryRow!.impressions, 1);
    assert.equal(hasSalaryRow!.clicks, 1);
  });

  it("keeps positions separate — never collapses two positions into one row", () => {
    const events: OutcomeEventRow[] = [
      { job_id: "job-with-salary", position: 1, kind: "impression" },
      { job_id: "job-with-salary", position: 2, kind: "impression" },
    ];
    const rows = aggregateFeatureOutcomes(events, featuresByJobId).filter(
      (r) => r.feature === "has_salary",
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.position).sort(), [1, 2]);
  });

  it("a bucket difference (has_salary true vs false) produces separate rows, never merged", () => {
    const events: OutcomeEventRow[] = [
      { job_id: "job-with-salary", position: 1, kind: "impression" },
      { job_id: "job-no-salary", position: 1, kind: "impression" },
    ];
    const rows = aggregateFeatureOutcomes(events, featuresByJobId).filter(
      (r) => r.feature === "has_salary",
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.bucket).sort(), ["false", "true"]);
  });

  it("skips events for a job with no known features, rather than counting them as an empty profile", () => {
    const events: OutcomeEventRow[] = [{ job_id: "unknown-job", position: 1, kind: "impression" }];
    assert.deepEqual(aggregateFeatureOutcomes(events, featuresByJobId), []);
  });

  it("running the same events through twice produces identical rows (idempotency)", () => {
    const events: OutcomeEventRow[] = [
      { job_id: "job-with-salary", position: 1, kind: "impression" },
      { job_id: "job-with-salary", position: 1, kind: "click" },
      { job_id: "job-no-salary", position: 4, kind: "impression" },
    ];
    const first = aggregateFeatureOutcomes(events, featuresByJobId);
    const second = aggregateFeatureOutcomes(events, featuresByJobId);
    const sortKey = (r: FeatureOutcomeRow) => `${r.feature}|${r.bucket}|${r.position}`;
    assert.deepEqual(
      [...first].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
      [...second].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
    );
  });
});
