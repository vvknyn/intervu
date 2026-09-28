import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SIGNED_OUT_SHORT_REDIRECTS } from "../../src/lib/seo/signed-out-short-routes";

const ROOT = path.join(__dirname, "../..");

test("signed-out /packs and /apply redirect to pages that already exist", () => {
  assert.deepEqual(
    SIGNED_OUT_SHORT_REDIRECTS.map((rule) => [rule.source, rule.destination]),
    [
      ["/packs", "/jobs"],
      ["/apply", "/yours"],
    ],
  );
  for (const rule of SIGNED_OUT_SHORT_REDIRECTS) {
    const page = path.join(ROOT, "src/app", rule.destination.slice(1), "page.tsx");
    assert.equal(existsSync(page), true, page);
    assert.equal(existsSync(path.join(ROOT, "src/app", rule.source.slice(1), "page.tsx")), false);
  }
});

test("next.config.ts maps those short URLs as temporary redirects", () => {
  const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  assert.match(config, /SIGNED_OUT_SHORT_REDIRECTS/);
  assert.match(config, /permanent: false/);
});
