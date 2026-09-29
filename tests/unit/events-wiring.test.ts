import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ANALYTICS_EVENTS } from "../../src/lib/analytics/events";

/**
 * What this protects: an analytics event that is DEFINED but never fired.
 *
 * The original six wire names (search → apply → save/follow → signup)
 * shipped with full payload types, their own unit test and a wiring map in
 * docs/analytics/FUNNEL.md — and, for a while, zero call sites. The types
 * checked, the tests passed, the module looked finished, and PostHog
 * received nothing about search, clicks, applies, saves or follows for as
 * long as it stayed that way. Nothing failed, because "nobody calls this"
 * is not a type error.
 *
 * The module-adoption ratchet exists to catch exactly this and did not,
 * because `lib/analytics/funnel.ts` had been written into its baseline as
 * an accepted orphan. This test is per-EVENT rather than per-module, so
 * wiring one event can no longer vouch for the rest of the catalog —
 * `events.ts` (the funnel module generalized to every entity) now declares
 * 24.
 */

const SRC = join(process.cwd(), "src");
const EVENTS_MODULE = join(SRC, "lib/analytics/events.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Event names passed to captureEvent() OR captureServerEvent() anywhere in
 * src/, excluding the module itself. Both are `K extends AnalyticsEventKey`
 * generic sinks (events.ts, server-capture.ts) — captureServerEvent exists
 * for events a client-side capture can't reliably send before a redirect
 * completes (see server-capture.ts), so an event fired only that way is
 * just as wired as one fired through captureEvent, and the scan has to
 * recognize both call shapes to avoid flagging real server-side wiring as
 * dead.
 */
function wiredEvents(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    if (file === EVENTS_MODULE) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/captureEvent\(\s*["'`]([a-z_]+)["'`]/g)) {
      found.add(m[1]);
    }
    for (const m of source.matchAll(/captureServerEvent\(\s*["'`]([a-z_]+)["'`]/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

test("every declared analytics event has at least one call site", () => {
  const wired = wiredEvents(sourceFiles(SRC));
  const declared = Object.keys(ANALYTICS_EVENTS);
  const unwired = declared.filter((event) => !wired.has(event));

  assert.deepEqual(
    unwired,
    [],
    "These events exist in ANALYTICS_EVENTS but nothing fires them, so PostHog " +
      "will never see them. Wire them (docs/analytics/EVENTS.md names the " +
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

  assert.ok(wired.size > 0, "found no captureEvent calls at all — the regex is broken");
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
  const jobsPage = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
  assert.match(jobsPage, /captureEvent\(\s*["'`]search_submitted["'`]/);
  assert.match(jobsPage, /captureEvent\(\s*["'`]result_clicked["'`]/);
});

/**
 * The search box carries names, employers and salary expectations. Sending the
 * raw string would put all of it in a third-party analytics store, so the
 * contract is length-only — enforced here because it is the kind of thing a
 * later "let's see what people search for" change would quietly reverse.
 */
test("search events carry a length, never the query itself", () => {
  const jobsPage = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
  const call = jobsPage.match(
    /captureEvent\(\s*["'`]search_submitted["'`]\s*,\s*\{[^}]*\}/,
  );
  assert.ok(call, "search_submitted call site not found");
  assert.match(call[0], /query_length/);
  assert.ok(
    !/\bquery:\s/.test(call[0]),
    `search_submitted is sending the raw query: ${call[0]}`,
  );
});

/**
 * apply_clicked must fire before the auth gate so gate drop-off is measurable
 * (docs/analytics/EVENTS.md). Source-order lock — no runtime behavior change.
 */
test("apply_clicked fires before gatedOpenPosting in handleOpenPosting", () => {
  const jobsPage = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
  const fnMatch = jobsPage.match(
    /const handleOpenPosting = \(job: PublicJob\) => \{([\s\S]*?)\n    \};/,
  );
  assert.ok(fnMatch, "handleOpenPosting not found");
  const body = fnMatch[1];
  const applyIdx = body.indexOf('captureEvent("apply_clicked"');
  const gateIdx = body.indexOf("gatedOpenPosting(job)");
  assert.ok(applyIdx !== -1, "apply_clicked capture not found in handleOpenPosting");
  assert.ok(gateIdx !== -1, "gatedOpenPosting(job) not found in handleOpenPosting");
  assert.ok(applyIdx < gateIdx, "apply_clicked must fire before the auth gate");
});
