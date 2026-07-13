import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldAttemptLegacyCacheFallback } from "../../src/lib/cache-helpers";

describe("shouldAttemptLegacyCacheFallback", () => {
  it("allows legacy fallback when no JD fingerprint and keys differ", () => {
    assert.equal(
      shouldAttemptLegacyCacheFallback(undefined, "primary-key", "legacy-key"),
      true,
    );
  });

  it("skips legacy fallback when JD fingerprint exists", () => {
    assert.equal(
      shouldAttemptLegacyCacheFallback("fp-abc", "primary-key", "legacy-key"),
      false,
    );
  });

  it("skips legacy fallback when primary and legacy keys match", () => {
    assert.equal(
      shouldAttemptLegacyCacheFallback(undefined, "same-key", "same-key"),
      false,
    );
  });
});
