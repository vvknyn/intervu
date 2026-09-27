import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("ForYouPack apply links on cream paper use text-live-on-postcard", () => {
  const src = readFileSync("src/components/jobs/for-you/ForYouPack.tsx", "utf8");
  const applyBlocks = src.match(/for-you-jd-apply-link[\s\S]*?<\/a>/g) ?? [];
  assert.ok(applyBlocks.length >= 2, "expected apply link blocks");
  for (const block of applyBlocks) {
    assert.match(block, /text-live-on-postcard/, block.slice(0, 80));
    assert.doesNotMatch(block, /\btext-live\b(?!-on-postcard)/);
  }
});
