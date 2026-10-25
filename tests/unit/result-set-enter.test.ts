import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextResultSetTrack, type ResultSetTrack } from "../../src/lib/motion/result-set-enter";

const GLOBALS = readFileSync(join(__dirname, "..", "..", "src/app/globals.css"), "utf8");

const fold = (keys: Array<string | null>): ResultSetTrack =>
  keys.slice(1).reduce(nextResultSetTrack, { key: keys[0], changes: 0 });

describe("nextResultSetTrack", () => {
  it("never animates the first set shown", () => {
    assert.equal(fold(["a"]).changes, 0);
  });
  it("a re-render with the same key does not replay (identity preserved)", () => {
    const t = fold(["a", "b"]);
    assert.equal(nextResultSetTrack(t, "b"), t);
    assert.equal(fold(["a", "b", "b", "b"]).changes, 1);
  });
  it("each new set counts once, for any key", () => {
    assert.equal(fold(["x", "y", "z"]).changes, 2);
  });
  it("a null key (loading) is not a new set; the set after it is", () => {
    assert.equal(fold(["a", null]).changes, 0);
    assert.equal(fold([null, "a"]).changes, 0);
    assert.equal(fold(["a", null, "b"]).changes, 0);
  });
});

describe("new motion classes in globals.css", () => {
  const start = GLOBALS.indexOf(".result-set-enter > *,");
  const reduced = GLOBALS.slice(GLOBALS.lastIndexOf("@media (prefers-reduced-motion: reduce)", start), GLOBALS.indexOf("}", start));
  for (const cls of [".result-set-enter > *", ".detail-crossfade", ".fade-in-base", ".updating-label"]) {
    it(`reduced motion turns off ${cls}`, () => {
      assert.ok(reduced.includes(cls), cls);
    });
  }
  it("staggers exactly the first 8 rows", () => {
    const delays = GLOBALS.match(/\.result-set-enter > :nth-child\(\d+\) \{ animation-delay/g) ?? [];
    assert.equal(delays.length, 7); // row 1 has no delay
    assert.ok(GLOBALS.includes(".result-set-enter > [data-job-row]:nth-child(-n + 8)"));
  });
});
