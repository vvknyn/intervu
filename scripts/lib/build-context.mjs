// Build-context gate (pure logic). `npm run build` inside the Docker builder sees
// only the files .dockerignore keeps, but tsc/next type-check every file tsconfig
// includes. A kept file that imports a stripped file passes locally (full
// worktree) and fails in the image with TS2307 (2026-09-28: playwright.journeys
// .config.ts -> ./playwright.config). This module reproduces the context and
// walks the imports from every kept, tsconfig-included file.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Docker's .dockerignore is NOT gitignore, so no `ignore`-package shortcut: patterns
// are root-anchored with no implicit "**/" (`docs`, `*.png` match only at the root),
// the LAST matching pattern wins, a pattern also matches every path beneath a
// matched directory, and a later `!pattern` may re-include beneath an excluded
// directory (`!openclaw/**`) which gitignore forbids. Supported syntax: `*`, `**`,
// `?`, `!`, `#` comments, literal paths; character classes `[...]` are unsupported
// (treated literally) and would make this gate disagree with Docker.
const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/^\//, "")
      .split("**/")
      .map((seg) =>
        seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"),
      )
      .join("(?:.*/)?")}$`,
  );

export function dockerIgnoreFilter(dockerignoreText) {
  const rules = dockerignoreText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => ({ negate: l.startsWith("!"), re: globToRegExp(l.startsWith("!") ? l.slice(1) : l) }));
  return (relPath) => {
    const parts = relPath.split("/");
    const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    let kept = true;
    for (const { negate, re } of rules) if (prefixes.some((p) => re.test(p))) kept = negate;
    return kept;
  };
}

const SOURCE_EXT = /\.(ts|tsx|mts)$/;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".mts", ".d.ts", ".js", ".mjs", ".cjs", ".json"];
const INDEX_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

// tsconfig include is `**\/*.ts|tsx|mts`; only its `exclude` prefixes vary.
const isTsIncluded = (p, excludeDirs) =>
  SOURCE_EXT.test(p) && !excludeDirs.some((d) => p === d || p.startsWith(`${d}/`));

// Candidate tracked paths an import specifier from `fromFile` could denote.
function candidates(fromFile, spec, aliasRoot) {
  let target;
  if (spec.startsWith("./") || spec.startsWith("../")) target = path.posix.join(path.posix.dirname(fromFile), spec);
  else if (aliasRoot && spec.startsWith("@/")) target = path.posix.join(aliasRoot, spec.slice(2));
  else return []; // bare package specifier
  const swapped = target.replace(/\.(m?)js$/, ".$1ts"); // TS "./x.js" -> x.ts
  return [
    ...RESOLVE_EXT.map((e) => target + e),
    swapped,
    ...INDEX_EXT.map((e) => `${target}/index${e}`),
  ];
}

export function importsOf(text) {
  const { importedFiles } = ts.preProcessFile(text, true, true);
  return importedFiles.map((i) => ({
    spec: i.fileName,
    line: text.slice(0, i.pos).split("\n").length,
  }));
}

/**
 * @param {{trackedFiles: string[], isKept: (p:string)=>boolean, readFile: (p:string)=>string,
 *          excludeDirs?: string[], aliasRoot?: string}} ctx
 * @returns {{file:string, line:number, spec:string, stripped:string}[]}
 */
export function findStrippedImports({ trackedFiles, isKept, readFile, excludeDirs = [], aliasRoot = "src" }) {
  const tracked = new Set(trackedFiles);
  const seen = new Set();
  const queue = trackedFiles.filter((p) => isKept(p) && isTsIncluded(p, excludeDirs));
  const offences = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { spec, line } of importsOf(readFile(file))) {
      const hits = candidates(file, spec, aliasRoot).filter((c) => tracked.has(c));
      if (!hits.length) continue; // not a tracked project file: package, asset, or a plain unresolved spec
      const kept = hits.find(isKept);
      if (kept) queue.push(kept);
      else offences.push({ file, line, spec, stripped: hits[0] });
    }
  }
  return offences.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export const formatOffences = (offences) =>
  offences.map((o) => `${o.file}:${o.line}  imports "${o.spec}" -> ${o.stripped} (stripped by .dockerignore)`).join("\n");

export function readTsExcludeDirs(cwd) {
  const cfg = ts.readConfigFile(path.join(cwd, "tsconfig.json"), ts.sys.readFile).config;
  return cfg.exclude ?? [];
}

export const readIfExists = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
