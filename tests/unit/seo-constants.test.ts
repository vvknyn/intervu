import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITE_URL } from "@/lib/seo/constants";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

/**
 * SITE_URL is a top-level `const` read once from `NEXT_PUBLIC_SITE_URL` at
 * module-evaluation time. Per the documented finding in
 * viewer-session-store.test.ts ("persist() failure handling — real process
 * isolation"), query-string cache-busting a dynamic import does NOT force
 * top-level module code to re-run under this repo's tsx/Node combination —
 * only a genuinely separate process observes a different env var. So the
 * env-override and fallback cases below spawn a real child process, same
 * pattern as that test.
 */
function readSiteUrlIn(env: NodeJS.ProcessEnv): string {
  const dir = mkdtempSync(join(tmpdir(), "seo-constants-probe-"));
  const script = join(dir, "probe.mjs");
  const specifier = new URL("../../src/lib/seo/constants.ts", import.meta.url).href;
  writeFileSync(
    script,
    `const mod = await import(${JSON.stringify(specifier)});\nprocess.stdout.write(mod.SITE_URL);`
  );
  try {
    return execFileSync("npx", ["tsx", script], { encoding: "utf8", env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("seo/constants — SITE_URL env seam", () => {
  it("honors NEXT_PUBLIC_SITE_URL when set", () => {
    const out = readSiteUrlIn({ ...process.env, NEXT_PUBLIC_SITE_URL: "https://intervuhq.com" });
    assert.equal(out, "https://intervuhq.com");
  });

  it("falls back to https://intervu.cc when unset", () => {
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_SITE_URL;
    const out = readSiteUrlIn(env);
    assert.equal(out, "https://intervu.cc");
  });

  // robots.ts used to declare its own local `const SITE_URL = "https://intervu.cc"`
  // — a duplicate that could silently drift from the real one. These assert
  // against the actually-imported SITE_URL (not a hardcoded literal), so
  // they'd fail if that duplicate ever came back.
  it("robots.ts derives host and sitemap from the shared SITE_URL export, not a hardcoded duplicate", () => {
    const result = robots();
    assert.equal(result.host, SITE_URL);
    assert.equal(result.sitemap, `${SITE_URL}/sitemap.xml`);
  });

  it("sitemap.ts derives every entry's URL from the shared SITE_URL export", () => {
    const result = sitemap();
    assert.ok(result.length > 0);
    for (const entry of result) {
      assert.ok(entry.url.startsWith(`${SITE_URL}/`), `expected ${entry.url} to start with ${SITE_URL}/`);
    }
  });
});
