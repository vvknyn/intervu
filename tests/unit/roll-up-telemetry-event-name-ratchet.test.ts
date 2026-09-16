import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as outcomeEvents from "../../src/lib/telemetry/outcome-events";

/**
 * Ratchet: `outcome-events.ts` exists specifically so a wire event-name
 * string is spelled ONCE. If any file under the derived-layer rollup code
 * (`src/lib/telemetry/`, `scripts/`) ever re-types one of those exported
 * literals instead of importing the constant, the two copies can drift
 * silently the next time the wire name changes (see `outcome-events.ts`'s
 * own module doc). The original version of this test scanned only
 * `scripts/roll-up-telemetry.ts` and missed real drift sitting in a sibling
 * module (`rollup-fetch.ts`) — this version scans the whole class of files
 * that could plausibly re-type one of these literals.
 *
 * The set of literals to guard is DERIVED from the module's actual runtime
 * exports, not hand-typed here — a hand-written name list would itself need
 * editing every time a constant is added, which is exactly the drift this
 * test exists to prevent. Filtering by `typeof value === "string"` also
 * naturally excludes the exported `OutcomeKind` type (erased at runtime) and
 * the `classifyOutcomeEvent` function.
 */
function deriveEventNameManifest(mod: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mod).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

// Same comment-stripping shape already used by other source-scanning tests
// in this suite (see tests/unit/co-page-redesign.test.ts) — block/line
// comments are stripped before scanning so a doc comment that mentions an
// event name in backtick-quoted prose (as this repo's rollup files do) is
// never mistaken for a hardcoded string literal in code. This is the
// "exclude comments by construction" rule: it applies to every file's
// content, not to any one path.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
}

/** Pure decision: which manifest entries appear as a quoted string literal
 *  (single- or double-quoted, the only forms a plain re-typed comparison or
 *  object literal would use) anywhere in `source`. Returns the offending
 *  constant NAMES so a failure message can name them. */
function findHardcodedEventLiterals(source: string, manifest: Record<string, string>): string[] {
  const code = stripComments(source);
  return Object.entries(manifest)
    .filter(([, value]) => code.includes(`"${value}"`) || code.includes(`'${value}'`))
    .map(([name]) => name);
}

/** Pure decision over an already-loaded file set: which files hardcode which
 *  constants. Kept separate from disk I/O so the presence-detection
 *  self-test can exercise it against synthetic in-memory files (proving
 *  multi-file coverage) without touching the filesystem. */
function scanFilesForHardcodedLiterals(
  files: readonly { file: string; source: string }[],
  manifest: Record<string, string>,
): { file: string; offenders: string[] }[] {
  return files
    .map(({ file, source }) => ({ file, offenders: findHardcodedEventLiterals(source, manifest) }))
    .filter((result) => result.offenders.length > 0);
}

/** Directory walk, not a hand-listed file set — for the same reason the
 *  literal-name manifest above is derived rather than typed: a hand-listed
 *  file set needs editing every time a file is added under these roots, and
 *  the day someone forgets, the new file is invisible to the ratchet.
 *  `excludePaths` (absolute, exact-match) is the one path-by-name exclusion
 *  this test makes, for the single named defining module — every other
 *  exclusion (tests, node_modules) is by filename/directory PATTERN, not by
 *  path. */
function listTsFilesRecursive(dir: string, excludePaths: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listTsFilesRecursive(full, excludePaths));
    } else if (entry.isFile()) {
      const isTestFile = /\.(test|spec)\.tsx?$/.test(entry.name);
      const isTsFile = /\.tsx?$/.test(entry.name);
      if (isTsFile && !isTestFile && !excludePaths.has(full)) out.push(full);
    }
  }
  return out;
}

const ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = ["src/lib/telemetry", "scripts"].map((p) => path.join(ROOT, p));
const DEFINING_MODULE = path.join(ROOT, "src/lib/telemetry/outcome-events.ts");

describe("src/lib/telemetry + scripts must not re-hardcode outcome-events.ts's wire names", () => {
  const manifest = deriveEventNameManifest(outcomeEvents as unknown as Record<string, unknown>);

  it("derives at least one string constant from outcome-events.ts (sanity check on the derivation itself)", () => {
    assert.ok(
      Object.keys(manifest).length > 0,
      "expected outcome-events.ts to export at least one string constant — derivation found none",
    );
  });

  it("discovers more than one .ts file under the scan roots (sanity check on the walk itself)", () => {
    const files = SCAN_ROOTS.flatMap((root) => listTsFilesRecursive(root, new Set([DEFINING_MODULE])));
    assert.ok(
      files.length > 1,
      `expected multiple files under ${SCAN_ROOTS.join(", ")} — walk found ${files.length}`,
    );
    assert.ok(
      !files.includes(DEFINING_MODULE),
      "the defining module itself must be excluded from the scan",
    );
  });

  it("the scanner DOES flag a synthetic literal planted in a file OTHER than roll-up-telemetry.ts (presence-detection self-test)", () => {
    const [, someValue] = Object.entries(manifest)[0];
    const syntheticFiles = [
      { file: "synthetic/unrelated-module.ts", source: "export const x = 1;" },
      {
        file: "synthetic/some-other-rollup-helper.ts", // deliberately NOT roll-up-telemetry.ts
        source: `const eventName = "${someValue}"; // re-typed instead of imported`,
      },
    ];
    const offending = scanFilesForHardcodedLiterals(syntheticFiles, manifest);
    assert.deepEqual(
      offending.map((r) => r.file),
      ["synthetic/some-other-rollup-helper.ts"],
      "scanner failed to detect a known-bad literal in a non-roll-up-telemetry.ts file — it cannot be trusted to detect absence across the whole scan",
    );
  });

  it("finds none of outcome-events.ts's exported literal values hardcoded anywhere under src/lib/telemetry/ or scripts/", () => {
    const files = SCAN_ROOTS.flatMap((root) => listTsFilesRecursive(root, new Set([DEFINING_MODULE]))).map(
      (file) => ({ file: path.relative(ROOT, file), source: readFileSync(file, "utf8") }),
    );
    const offending = scanFilesForHardcodedLiterals(files, manifest);
    assert.deepEqual(
      offending,
      [],
      offending
        .map((r) => `${r.file} hardcodes: ${r.offenders.join(", ")}`)
        .join("\n") || "import the constant(s) from src/lib/telemetry/outcome-events.ts instead",
    );
  });
});
