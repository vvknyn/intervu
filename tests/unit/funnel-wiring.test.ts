import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FUNNEL_EVENTS } from "../../src/lib/analytics/funnel";

/**
 * What this protects: a funnel event that is DEFINED but never fired.
 *
 * `FUNNEL_EVENTS` shipped with all six names, full payload types, its own unit
 * test and a wiring map in docs/analytics/FUNNEL.md — and zero call sites. The
 * types checked, the tests passed, the module looked finished, and PostHog
 * received nothing about search, clicks, applies, saves or follows for as long
 * as it stayed that way. Nothing failed, because "nobody calls this" is not a
 * type error.
 *
 * The module-adoption ratchet exists to catch exactly this and did not, because
 * `lib/analytics/funnel.ts` had been written into its baseline as an accepted
 * orphan. A guard whose allowlist contains the thing it is guarding is green by
 * construction. This test is per-EVENT rather than per-module, so wiring one
 * event can no longer vouch for the other five.
 */

const SRC = join(process.cwd(), "src");
const FUNNEL_MODULE = join(SRC, "lib/analytics/funnel.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Event names passed to captureFunnelEvent() anywhere in src/, excluding the module itself. */
function wiredEvents(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    if (file === FUNNEL_MODULE) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/captureFunnelEvent\(\s*["'`]([a-z_]+)["'`]/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

test("every declared funnel event has at least one call site", () => {
  const wired = wiredEvents(sourceFiles(SRC));
  const declared = Object.keys(FUNNEL_EVENTS);
  const unwired = declared.filter((event) => !wired.has(event));

  assert.deepEqual(
    unwired,
    [],
    "These events exist in FUNNEL_EVENTS but nothing fires them, so PostHog " +
      "will never see them. Wire them (docs/analytics/FUNNEL.md names the " +
      "intended call site) or delete them — a declared-but-dead event reads " +
      "on a dashboard as 'nobody did this', which is not the same as 'we " +
      "never asked'.",
  );
});

// The scan above is only worth trusting if it can come back empty. Without
// this, a typo in the regex would report every event wired, forever.
test("the scanner detects a call site, and the absence of one", () => {
  const files = sourceFiles(SRC);
  const wired = wiredEvents(files);

  assert.ok(wired.size > 0, "found no captureFunnelEvent calls at all — the regex is broken");
  assert.ok(
    !wired.has("definitely_not_a_real_event"),
    "the scanner reports events that were never wired",
  );
});

/**
 * A different case than the one that surfaced this: search is the top of the
 * funnel, so if it is unwired every downstream rate loses its denominator and
 * the whole funnel reads as zero conversion rather than as broken.
 */
test("the top of the funnel is wired on the jobs page specifically", () => {
  const jobsPage = readFileSync(join(SRC, "app/jobs/page.tsx"), "utf8");
  assert.match(jobsPage, /captureFunnelEvent\(\s*["'`]search_submitted["'`]/);
  assert.match(jobsPage, /captureFunnelEvent\(\s*["'`]result_clicked["'`]/);
});

/**
 * The search box carries names, employers and salary expectations. Sending the
 * raw string would put all of it in a third-party analytics store, so the
 * contract is length-only — enforced here because it is the kind of thing a
 * later "let's see what people search for" change would quietly reverse.
 */
test("search events carry a length, never the query itself", () => {
  const jobsPage = readFileSync(join(SRC, "app/jobs/page.tsx"), "utf8");
  const call = jobsPage.match(
    /captureFunnelEvent\(\s*["'`]search_submitted["'`]\s*,\s*\{[^}]*\}/,
  );
  assert.ok(call, "search_submitted call site not found");
  assert.match(call[0], /query_length/);
  assert.ok(
    !/\bquery:\s/.test(call[0]),
    `search_submitted is sending the raw query: ${call[0]}`,
  );
});
