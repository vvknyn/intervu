import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEntering, nextResultSetTrack, RESULT_SET_ENTER_WINDOW_MS, type ResultSetTrack } from "../../src/lib/motion/result-set-enter";

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

describe("entrance window", () => {
  it("is off before any new set and after the window closes", () => {
    assert.equal(isEntering(0, 0), false);
    assert.equal(isEntering(1, 0), true);
    assert.equal(isEntering(1, 1), false);
  });
  it("a same-key re-render after the window stays off; the next new set reopens it", () => {
    const t = fold(["a", "b"]);
    assert.equal(isEntering(nextResultSetTrack(t, "b").changes, t.changes), false);
    assert.equal(isEntering(nextResultSetTrack(t, "c").changes, t.changes), true);
  });
  it("covers the 8-row stagger plus the enter duration, under 500ms", () => {
    assert.equal(RESULT_SET_ENTER_WINDOW_MS, 410);
  });
});

describe("new motion classes in globals.css", () => {
  const start = GLOBALS.indexOf(".result-set-enter > *,");
  const reduced = GLOBALS.slice(GLOBALS.lastIndexOf("@media (prefers-reduced-motion: reduce)", start), GLOBALS.indexOf("}", start));
  for (const cls of [".result-set-enter > *", ".detail-crossfade", ".fade-in-base"]) {
    it(`reduced motion turns off ${cls}`, () => {
      assert.ok(reduced.includes(cls), cls);
    });
  }
  it("staggers exactly the first 8 rows", () => {
    const delays = GLOBALS.match(/\.result-set-enter > :nth-child\(\d+ of \[data-job-row\]\) \{ animation-delay/g) ?? [];
    assert.equal(delays.length, 7); // row 1 has no delay
    assert.ok(GLOBALS.includes(".result-set-enter > :nth-child(-n + 8 of [data-job-row])"));
  });
});
