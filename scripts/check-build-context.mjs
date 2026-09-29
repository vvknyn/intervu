#!/usr/bin/env node
// Preflight gate: a file the Docker build context keeps must not import a file
// .dockerignore strips (that is a TS2307 in the image build, invisible locally).
// Logic + rationale: scripts/lib/build-context.mjs (unit-tested).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dockerIgnoreFilter, findStrippedImports, formatOffences, readTsExcludeDirs } from "./lib/build-context.mjs";

const cwd = process.cwd();
const trackedFiles = execFileSync("git", ["-C", cwd, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter(Boolean);
const offences = findStrippedImports({
  trackedFiles,
  isKept: dockerIgnoreFilter(readFileSync(`${cwd}/.dockerignore`, "utf8")),
  readFile: (p) => readFileSync(`${cwd}/${p}`, "utf8"),
  excludeDirs: readTsExcludeDirs(cwd),
});
if (!offences.length) {
  console.log("build-context gate: pass (no kept file imports a .dockerignore-stripped file)");
} else {
  console.error(`build-context gate: FAIL — the Docker build would hit TS2307 on:\n${formatOffences(offences)}\n` +
    "Fix: strip the importer too (.dockerignore) or stop importing the stripped file.");
  process.exit(1);
}
