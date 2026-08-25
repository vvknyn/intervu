import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rectsEqual } from "../../src/components/tour/tour-target-rect";

const PROVIDER = path.join(process.cwd(), "src/components/tour/TourProvider.tsx");
const OVERLAY = path.join(process.cwd(), "src/components/tour/TourOverlay.tsx");

test("tour target rect", async (t) => {
  await t.test("rectsEqual returns true for identical bounds", () => {
    const a = { x: 10, y: 20, width: 100, height: 50 };
    const b = { x: 10, y: 20, width: 100, height: 50 };
    assert.equal(rectsEqual(a, b), true);
  });

  await t.test("rectsEqual returns false when any dimension differs", () => {
    const base = { x: 10, y: 20, width: 100, height: 50 };
    assert.equal(rectsEqual(base, { ...base, x: 11 }), false);
    assert.equal(rectsEqual(base, { ...base, y: 21 }), false);
    assert.equal(rectsEqual(base, { ...base, width: 101 }), false);
    assert.equal(rectsEqual(base, { ...base, height: 51 }), false);
  });

  await t.test("rectsEqual handles nullish inputs", () => {
    const rect = { x: 0, y: 0, width: 1, height: 1 };
    assert.equal(rectsEqual(null, null), true);
    assert.equal(rectsEqual(undefined, undefined), true);
    assert.equal(rectsEqual(rect, null), false);
    assert.equal(rectsEqual(null, rect), false);
  });

  await t.test("TourProvider uses rAF loop for live rect tracking", () => {
    const src = readFileSync(PROVIDER, "utf8");
    assert.match(src, /requestAnimationFrame\(tick\)/, "tracking effect must loop via rAF");
    assert.doesNotMatch(
      src,
      /new ResizeObserver/,
      "ResizeObserver must not be the layout listener",
    );
    assert.doesNotMatch(
      src,
      /addEventListener\("scroll"/,
      "scroll listener replaced by rAF loop",
    );
  });

  await t.test("TourOverlay path animates opacity only, not d", () => {
    const src = readFileSync(OVERLAY, "utf8");
    const pathBlock = src.match(/<motion\.path[\s\S]*?\/>/);
    assert.ok(pathBlock, "motion.path must exist");
    assert.match(pathBlock![0], /d=\{overlayPath\}/, "path d must be a static attribute");
    const animateMatch = pathBlock![0].match(/animate=\{\{[^}]+\}\}/);
    assert.ok(animateMatch, "motion.path animate prop must exist");
    assert.doesNotMatch(animateMatch![0], /\bd\s*:/, "path d must not be animated");
  });
});
