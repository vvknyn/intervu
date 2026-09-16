import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";

/**
 * Module-adoption ratchet.
 *
 * Twice in one week a library merged to `main` with zero production call
 * sites and shipped as if it worked: `src/lib/presentation/*` (the SERP kept
 * rendering raw junk because nothing routed through the presenter) and the
 * interview-prep AI functions before that (exported, sold on /pricing,
 * reachable by nothing). Neither `tsc` nor eslint catches this — an exported
 * symbol that nobody imports is not a type error or a lint warning.
 *
 * DETECTION MODE SHIPPED: transitive reachability, not direct-importer.
 * Seed = every non-test file outside `src/lib`, plus every non-test file
 * under any configured extra entry root (see `entryRoots` below — the real
 * scan passes `scripts/`, since those files are run directly and are never
 * themselves imported from `src/`). Walk the static import graph
 * (alias `@/...`, relative `./...`/`../...`, and `import(...)`) from those
 * seeds. Any `src/lib` module the walk never reaches is orphaned. This was
 * required (not just "simpler") because the direct-importer definition
 * (`any non-test file anywhere imports it`) is fooled by barrel files: a
 * `src/lib/foo/index.ts` that re-exports everything in its own directory
 * would make every sibling "wired" the moment ANYTHING imports the barrel,
 * even before the barrel itself is reachable from outside `src/lib` — which
 * is exactly the shape of the presentation-module incident. Transitive
 * reachability still only tracks at file granularity, not named-export
 * granularity: once a barrel is genuinely reachable, every module it
 * re-exports counts as reachable too, even if only one re-exported symbol is
 * actually called downstream. That's a known, accepted coarseness — it's
 * still strictly stronger than direct-importer and it catches the
 * whole-module-unwired class this test exists for.
 *
 * BASELINE CONTRACT (`module-adoption-baseline.json`):
 * - It is an ALLOWED list, not a REQUIRED one. A module can leave it (once
 *   wired) with no test change — the "stale baseline" note below just prints
 *   as a cleanup nudge.
 * - A module can only ENTER it by editing the JSON in the same PR that
 *   introduces the orphan, which puts the deferral in the diff a reviewer
 *   reads. A new orphan that isn't in the file fails this test by name.
 * - Regenerate by running the scan and overwriting the file — there is no
 *   separate CLI; `findOrphanedModules` below is the whole mechanism, so
 *   pointing it at `REPO_SRC`/`REPO_LIB` and writing the sorted result back
 *   out reproduces the file exactly.
 */

const CODE_FILE_RE = /\.(ts|tsx)$/;
const DTS_RE = /\.d\.ts$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

function isScannableCodeFile(path: string): boolean {
  return CODE_FILE_RE.test(path) && !DTS_RE.test(path) && !TEST_FILE_RE.test(path);
}

function walkCodeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkCodeFiles(full, out);
    else if (isScannableCodeFile(full)) out.push(full);
  }
  return out;
}

// Matches `import ... from "x"`, bare `import "x"`, `export {...} from "x"`,
// `export * from "x"`, and `export * as ns from "x"` — static forms only.
const STATIC_SPECIFIER_RE = /(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_SPECIFIER_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(STATIC_SPECIFIER_RE)) specs.push(m[1]);
  for (const m of source.matchAll(DYNAMIC_SPECIFIER_RE)) specs.push(m[1]);
  return specs;
}

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

function resolveSpecifier(
  fromFile: string,
  specifier: string,
  aliasPrefix: string,
  aliasTarget: string,
): string | null {
  let base: string;
  if (specifier.startsWith(aliasPrefix)) {
    base = join(aliasTarget, specifier.slice(aliasPrefix.length));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // bare specifier — npm package or node builtin, not ours to resolve
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = join(base, "index" + ext);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface AdoptionScanOptions {
  /** Absolute path standing in for `src`. */
  srcRoot: string;
  /** Absolute path standing in for `src/lib`; must be under srcRoot. */
  libRoot: string;
  /** e.g. "@/" */
  aliasPrefix: string;
  /** Absolute path the alias prefix resolves to. */
  aliasTarget: string;
  /**
   * Extra absolute directories treated as entrypoints alongside srcRoot.
   * Non-test files under these roots join the edge map and seed the
   * reachable set, using the same non-test filter as the srcRoot seeds. A
   * directory that doesn't exist is skipped rather than erroring.
   */
  entryRoots?: string[];
}

/**
 * Transitive reachability pass. Returns the sorted, POSIX-relative (to
 * srcRoot) paths of every module under libRoot that no non-test file outside
 * libRoot can reach via the static/dynamic import graph.
 *
 * "Entrypoint" means: every non-test file under srcRoot outside libRoot,
 * plus every non-test file under any of `entryRoots`. The latter exists
 * because this repo has a second real entrypoint directory, `scripts/`,
 * whose files are executed directly (by cron on the production box, and by
 * hand) rather than imported from `src/` — a `src/lib` module used only from
 * `scripts/` is genuinely wired, not dead, even though nothing under
 * `srcRoot` ever reaches it. Don't drop this and fold `scripts/` back into a
 * single seed set without it — that's what makes those modules falsely
 * orphaned again.
 */
function findOrphanedModules(opts: AdoptionScanOptions): string[] {
  const { srcRoot, libRoot, aliasPrefix, aliasTarget, entryRoots = [] } = opts;
  const allFiles = walkCodeFiles(srcRoot);
  const extraEntryFiles = entryRoots
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
    .flatMap((dir) => walkCodeFiles(dir));
  const edgeSourceFiles = [...allFiles, ...extraEntryFiles];
  const edges = new Map<string, string[]>();
  for (const file of edgeSourceFiles) {
    const specifiers = extractSpecifiers(readFileSync(file, "utf8"));
    const targets: string[] = [];
    for (const spec of specifiers) {
      const resolved = resolveSpecifier(file, spec, aliasPrefix, aliasTarget);
      if (resolved && resolved !== file) targets.push(resolved);
    }
    edges.set(file, targets);
  }

  const libPrefix = libRoot.endsWith(sep) ? libRoot : libRoot + sep;
  const notUnderLib = (f: string) => !f.startsWith(libPrefix);
  const seeds = [...allFiles.filter(notUnderLib), ...extraEntryFiles.filter(notUnderLib)];
  const reachable = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.pop()!;
    for (const target of edges.get(current) ?? []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }

  const libModules = walkCodeFiles(libRoot);
  return libModules
    .filter((f) => !reachable.has(f))
    .map((f) => relative(srcRoot, f).split(sep).join("/"))
    .sort();
}

/** Reads the single `@/*` -> directory mapping tsconfig declares, without hardcoding anything past that. */
function readAliasMapping(tsconfigPath: string): { prefix: string; target: string } {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const [key, [value]] = Object.entries(paths)[0] as [string, string[]];
  if (!key.endsWith("/*") || !value.endsWith("/*")) {
    throw new Error(`tsconfig paths entry "${key}": "${value}" isn't a "prefix/*" -> "dir/*" mapping`);
  }
  return {
    prefix: key.slice(0, -1), // "@/*" -> "@/"
    target: resolve(dirname(tsconfigPath), value.slice(0, -2)), // "./src/*" -> <repo>/src
  };
}

interface AdoptionDrift {
  /** Currently orphaned but absent from the baseline — this fails the test. */
  newOrphans: string[];
  /** Present in the baseline but no longer orphaned — printed, doesn't fail. */
  staleBaselineEntries: string[];
}

/** Pure diff between a fresh scan and the committed allowlist. No I/O. */
function describeAdoptionDrift(current: string[], baseline: string[]): AdoptionDrift {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  return {
    newOrphans: current.filter((m) => !baselineSet.has(m)),
    staleBaselineEntries: baseline.filter((m) => !currentSet.has(m)),
  };
}

// ---------------------------------------------------------------------------
// Fixtures: prove the mechanism catches the CLASS (barrel-fooled adoption,
// alias vs relative resolution, test-only importers), not just today's
// instance. None of these depend on any real repo module staying orphaned.
// ---------------------------------------------------------------------------

function makeFixtureTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "module-adoption-fixture-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("findOrphanedModules — fixtures", () => {
  it("flags a module with no importer anywhere as orphaned", () => {
    const root = makeFixtureTree({
      "lib/orphan.ts": `export const value = 1;\n`,
      "app/page.ts": `export const page = "home";\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans, ["lib/orphan.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a module reached via an alias import", () => {
    const root = makeFixtureTree({
      "lib/wired.ts": `export const value = 1;\n`,
      "app/page.ts": `import { value } from "@/lib/wired";\nexport const page = value;\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans, [], "alias-form import must count as adoption");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a module reached via a relative import", () => {
    const root = makeFixtureTree({
      "lib/wired.ts": `export const value = 1;\n`,
      "app/page.ts": `import { value } from "../lib/wired";\nexport const page = value;\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans, [], "relative-form import must count as adoption");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let a test-file-only importer count as adoption", () => {
    const root = makeFixtureTree({
      "lib/orphan.ts": `export const value = 1;\n`,
      "app/page.ts": `export const page = "home";\n`,
      // Only a *.test.ts file imports it — walkCodeFiles skips test-pattern
      // files entirely, so this import is invisible to the graph, exactly
      // like the real repo's tests/ directory being outside src/**.
      "app/orphan.test.ts": `import { value } from "@/lib/orphan";\nexport const check = value;\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans, ["lib/orphan.ts"], "a *.test.ts importer must not count as wiring");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches the barrel class: a re-exported sibling isn't wired until the barrel itself is reachable", () => {
    // This is the shape of the actual incident: lib/presentation/index.ts
    // re-exports lib/presentation/job.ts, but nothing outside src/lib
    // imported the barrel yet, so job.ts must show as orphaned too — a
    // direct-importer scan (barrel counts as importer) would miss this.
    const root = makeFixtureTree({
      "lib/barrel/job.ts": `export const presentJob = () => "job";\n`,
      "lib/barrel/index.ts": `export { presentJob } from "./job";\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans.sort(), ["lib/barrel/index.ts", "lib/barrel/job.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wires the whole barrel through once something outside src/lib imports it", () => {
    const root = makeFixtureTree({
      "lib/barrel/job.ts": `export const presentJob = () => "job";\n`,
      "lib/barrel/index.ts": `export { presentJob } from "./job";\n`,
      "app/page.ts": `import { presentJob } from "@/lib/barrel";\nexport const rendered = presentJob();\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
      });
      assert.deepEqual(orphans, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a module imported only from a file in an extra entry root", () => {
    // Mirrors scripts/: a directory outside srcRoot whose files are run
    // directly and are the ONLY importer of a src/lib module.
    const root = makeFixtureTree({
      "lib/wired.ts": `export const value = 1;\n`,
      "app/page.ts": `export const page = "home";\n`,
    });
    const entryRoot = makeFixtureTree({
      "cron-job.ts": `import { value } from "@/lib/wired";\nexport const run = value;\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
        entryRoots: [entryRoot],
      });
      assert.deepEqual(orphans, [], "a module reachable only from an extra entry root must count as adoption");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(entryRoot, { recursive: true, force: true });
    }
  });

  it("negative control: entryRoots does not blanket-rescue a module nothing imports", () => {
    const root = makeFixtureTree({
      "lib/orphan.ts": `export const value = 1;\n`,
      "app/page.ts": `export const page = "home";\n`,
    });
    const entryRoot = makeFixtureTree({
      "cron-job.ts": `export const run = "unrelated";\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
        entryRoots: [entryRoot],
      });
      assert.deepEqual(orphans, ["lib/orphan.ts"], "entryRoots must not rescue a module nothing actually imports");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(entryRoot, { recursive: true, force: true });
    }
  });

  it("a test file inside an extra entry root still does not count as adoption", () => {
    const root = makeFixtureTree({
      "lib/orphan.ts": `export const value = 1;\n`,
      "app/page.ts": `export const page = "home";\n`,
    });
    const entryRoot = makeFixtureTree({
      "cron-job.test.ts": `import { value } from "@/lib/orphan";\nexport const check = value;\n`,
    });
    try {
      const orphans = findOrphanedModules({
        srcRoot: root,
        libRoot: join(root, "lib"),
        aliasPrefix: "@/",
        aliasTarget: root,
        entryRoots: [entryRoot],
      });
      assert.deepEqual(orphans, ["lib/orphan.ts"], "a *.test.ts file in an extra entry root must not count as wiring");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(entryRoot, { recursive: true, force: true });
    }
  });
});

describe("describeAdoptionDrift — fixtures", () => {
  it("a new orphan not in the baseline is reported by name", () => {
    const drift = describeAdoptionDrift(["lib/a.ts", "lib/new-orphan.ts"], ["lib/a.ts"]);
    assert.deepEqual(drift.newOrphans, ["lib/new-orphan.ts"]);
  });

  it("a baseline entry still orphaned today produces no drift", () => {
    const drift = describeAdoptionDrift(["lib/a.ts"], ["lib/a.ts"]);
    assert.deepEqual(drift.newOrphans, []);
    assert.deepEqual(drift.staleBaselineEntries, []);
  });

  it("a baseline entry that has since been wired is reported as stale, not as a failure", () => {
    const drift = describeAdoptionDrift([], ["lib/now-wired.ts"]);
    assert.deepEqual(drift.newOrphans, []);
    assert.deepEqual(drift.staleBaselineEntries, ["lib/now-wired.ts"]);
  });
});

// ---------------------------------------------------------------------------
// The actual guard: scan the real repo, compare to the committed baseline.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const REPO_SRC = join(REPO_ROOT, "src");
const REPO_LIB = join(REPO_SRC, "lib");
const BASELINE_PATH = join(__dirname, "module-adoption-baseline.json");

describe("src/lib module adoption", () => {
  const alias = readAliasMapping(join(REPO_ROOT, "tsconfig.json"));

  it("tsconfig still declares the single @/ -> src alias this scanner assumes", () => {
    assert.equal(alias.prefix, "@/");
    assert.equal(alias.target, REPO_SRC);
  });

  it("every currently-orphaned src/lib module is accounted for in the baseline", () => {
    const current = findOrphanedModules({
      srcRoot: REPO_SRC,
      libRoot: REPO_LIB,
      aliasPrefix: alias.prefix,
      aliasTarget: alias.target,
      entryRoots: [join(REPO_ROOT, "scripts")],
    });
    const baseline: string[] = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).orphans;
    const drift = describeAdoptionDrift(current, baseline);

    if (drift.staleBaselineEntries.length) {
      console.log(
        `module-adoption: ${drift.staleBaselineEntries.length} baseline entr${drift.staleBaselineEntries.length === 1 ? "y" : "ies"} ` +
          `got wired since the baseline was last generated — safe to remove from ` +
          `module-adoption-baseline.json: ${drift.staleBaselineEntries.join(", ")}`,
      );
    }

    assert.deepEqual(
      drift.newOrphans,
      [],
      `${drift.newOrphans.length} new orphaned module(s) merged with zero call sites outside src/lib: ` +
        `${drift.newOrphans.join(", ")}. Either wire it (import it from somewhere real) or ` +
        `consciously add it to tests/unit/module-adoption-baseline.json in this same PR.`,
    );
  });
});
