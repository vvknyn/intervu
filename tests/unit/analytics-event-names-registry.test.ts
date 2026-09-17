import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ANALYTICS_EVENTS as LEAF_EVENTS } from "../../src/lib/analytics/event-names";
import { ANALYTICS_EVENTS as REEXPORTED_EVENTS } from "../../src/lib/analytics/events";
import { RESULTS_IMPRESSED, RESULT_CLICKED, APPLY_CLICKED, JOB_SAVED } from "../../src/lib/telemetry/outcome-events";

/**
 * Conformance test for the wire-name registry split (src/lib/analytics/
 * event-names.ts is now the single declaration; events.ts re-exports it,
 * outcome-events.ts derives from it). Before this split, the same four
 * strings were typed out independently in both events.ts and
 * outcome-events.ts with zero import between them — a rename on one side
 * would silently stop matching rows on the other (rollup-fetch.ts's
 * `where e.event_name = $2`).
 *
 * `assert.equal` on two string primitives compares VALUES — for primitives,
 * identity and equality are indistinguishable, so this test on its own only
 * proves the two sides have not DRIFTED as of today (a rename on either side
 * would flip one but not the other, and this would catch that). It does
 * NOT prove "same binding traced through imports": a re-forked copy of
 * outcome-events.ts that hardcoded `"results_impressed"` as its own literal
 * would pass this assertion just as well, right up until the day it drifted.
 * What actually rules out that fork is the declaration-site scan below: it
 * reads outcome-events.ts's own source and confirms it doesn't spell any of
 * these wire names out itself, only imports them — so a rewrite that swapped
 * `ANALYTICS_EVENTS.results_impressed` for a hardcoded literal would fail
 * that test even on the day it still happened to match.
 */

test("outcome-events.ts's four exported constants are identical to their ANALYTICS_EVENTS counterparts", () => {
  assert.equal(RESULTS_IMPRESSED, LEAF_EVENTS.results_impressed);
  assert.equal(RESULT_CLICKED, LEAF_EVENTS.result_clicked);
  assert.equal(APPLY_CLICKED, LEAF_EVENTS.apply_clicked);
  assert.equal(JOB_SAVED, LEAF_EVENTS.job_saved);
});

test("events.ts re-exports the exact same ANALYTICS_EVENTS map as event-names.ts, for every key — not just the four outcome-events.ts uses", () => {
  // Deliberately asserts the WHOLE map, not a hand-picked subset: proves the
  // re-export in events.ts is faithful for keys that motivated nothing here
  // (e.g. `search_zero_results`), which is the only way to know events.ts
  // didn't fork its own copy instead of actually re-exporting.
  assert.deepEqual(REEXPORTED_EVENTS, LEAF_EVENTS);
  assert.equal(REEXPORTED_EVENTS.search_zero_results, LEAF_EVENTS.search_zero_results);
});

/**
 * Declaration-site scan: every wire-name VALUE in ANALYTICS_EVENTS (the
 * strings that actually ride the wire — not the object's keys, which differ
 * from their value for `job_shared`/`"share_initiated"`) must be spelled out
 * as a quoted literal in exactly one place in src/: event-names.ts itself.
 *
 * Two call shapes elsewhere in src/ legitimately contain a matching quoted
 * literal without being a second declaration, because TypeScript — not this
 * scan — already ties them back to ANALYTICS_EVENTS:
 *   - `captureEvent("name", ...)` (events.ts) and `captureServerEvent("name",
 *     ...)` (server-capture.ts): both are `K extends AnalyticsEventKey`, so
 *     a rename in ANALYTICS_EVENTS breaks every such call site at compile
 *     time and the literal here can't silently drift from the map.
 *   - `EventPayloads["name"]` (events.ts): a TypeScript indexed-access TYPE
 *     position, erased before anything runs — no runtime string exists here
 *     to drift.
 * Both are recognized by the call/index SHAPE (like `.collection(` /
 * `.collectionGroup(` in the firestore-migration-manifest test's own scan),
 * not by enumerating file names — any future file using either shape is
 * covered by construction. Anything else quoted is a real, untyped
 * duplicate of the wire name (the class of bug this test exists to catch —
 * see the CONTROL cases below, and the real instance this scan currently
 * flags at src/lib/share/share-decision.ts, out of scope for this change).
 *
 * Handles all three JS quote characters via a capture group + backreference
 * — a regex hardcoding one quote spelling is not a gate, per this repo's own
 * firestore-migration-manifest test history. Comments are stripped first so
 * a doc comment merely MENTIONING a wire name in backticks (this file, and
 * several src/ files, do exactly that) isn't mistaken for a declaration.
 */
function declaresWireNameLiteral(src: string, name: string): boolean {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const re = new RegExp(`(["'\`])${name}\\1`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const before = stripped.slice(Math.max(0, m.index - 80), m.index);
    if (/\bcaptureEvent\(\s*$/.test(before)) continue;
    if (/\bcaptureServerEvent\(\s*$/.test(before)) continue;
    if (/\bEventPayloads\[\s*$/.test(before)) continue;
    return true;
  }
  return false;
}

const SRC_ROOT = join(process.cwd(), "src");
const DECLARATION_FILE = join(SRC_ROOT, "lib", "analytics", "event-names.ts");
const WIRE_NAMES = Object.values(LEAF_EVENTS);

/** Every non-test .ts/.tsx file under src/, walked the same way the
 *  firestore-migration-manifest test walks it for its own collection scan. */
function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

test("wire-name literals are declared only in event-names.ts — every other src/ file reaches them through an import", () => {
  const offenders: string[] = [];
  for (const file of tsFilesUnder(SRC_ROOT)) {
    if (file === DECLARATION_FILE) continue;
    const src = readFileSync(file, "utf8");
    for (const name of WIRE_NAMES) {
      if (declaresWireNameLiteral(src, name)) offenders.push(`${file}: "${name}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `wire-name literal(s) re-declared outside event-names.ts (should be imported instead):\n${offenders.join("\n")}`,
  );
});

// A detector's silence only means something if it can also prove it can see.
// Without this, narrowing the regex to nothing (or breaking it outright)
// would silently turn every future duplicate declaration invisible — the
// exact failure mode documented in this repo's firestore-migration-manifest
// test. Uses a wire name that is real (drawn from LEAF_EVENTS, not an
// invented word) so the control can't pass by matching a name nothing
// declares.
test("CONTROL: declaresWireNameLiteral flags a real duplicate declaration, in all three quote spellings", () => {
  const name = LEAF_EVENTS.results_impressed;
  assert.ok(declaresWireNameLiteral(`const DUPLICATE = "${name}";`, name), "double-quoted declaration not flagged");
  assert.ok(declaresWireNameLiteral(`const DUPLICATE = '${name}';`, name), "single-quoted declaration not flagged");
  assert.ok(declaresWireNameLiteral(`const DUPLICATE = \`${name}\`;`, name), "backtick-quoted declaration not flagged");
});

// Negative control: proves the two exemptions above are real carve-outs for
// specific, recognized call shapes — not "nothing ever gets flagged." Without
// this, an over-broad exemption (e.g. matching any `captureEvent` substring
// anywhere in the file) could hide real declarations that merely share a file
// with a legitimate call.
test("CONTROL: captureEvent(...) and EventPayloads[...] shapes are not mistaken for a declaration", () => {
  const name = LEAF_EVENTS.results_impressed;
  assert.equal(declaresWireNameLiteral(`captureEvent("${name}", { count: 1 });`, name), false);
  assert.equal(declaresWireNameLiteral(`type P = EventPayloads["${name}"];`, name), false);
  // The same literal, same file, NOT inside either shape — still flagged.
  assert.ok(declaresWireNameLiteral(`captureEvent("${name}", {});\nconst LEAK = "${name}";`, name));
});

// Comments (including the backtick-code-reference style used throughout this
// repo's own docs) must not be mistaken for a declaration.
test("CONTROL: a wire name merely mentioned in a comment is not flagged", () => {
  const name = LEAF_EVENTS.results_impressed;
  assert.equal(declaresWireNameLiteral(`// see \`${name}\` above\nconst x = 1;`, name), false);
  assert.equal(declaresWireNameLiteral(`/** \`${name}\` */\nconst x = 1;`, name), false);
});
