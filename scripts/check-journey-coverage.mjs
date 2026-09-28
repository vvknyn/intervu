#!/usr/bin/env node
// Journey coverage gate: a user-facing change must come with a journey spec
// change (or a Journey-Impact trailer). One script, three call sites:
//   - Claude Code PreToolUse hook (.claude/settings.json):  --claude-hook  (JSON on stdin)
//   - git pre-push (.githooks/pre-push) and `npm run preflight`:  no args
// Decision logic lives in scripts/lib/journey-coverage.mjs (pure, unit-tested).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseCatalog } from "./lib/journey-catalog.mjs";
import { evaluateJourneyCoverage, failureText, isGatedCommand } from "./lib/journey-coverage.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const refExists = (cwd, ref) => { try { git(cwd, "rev-parse", "--verify", "--quiet", ref); return true; } catch { return false; } };

function readRange(cwd) {
  const baseRef = ["origin/staging", "origin/main"].find((r) => refExists(cwd, r));
  if (!baseRef) throw new Error("neither origin/staging nor origin/main exists — run `git fetch origin` so the gate has a base to diff against");
  const base = git(cwd, "merge-base", baseRef, "HEAD").trim();
  return {
    changedPaths: git(cwd, "diff", "--name-only", `${base}..HEAD`).split("\n").filter(Boolean),
    commitMessages: git(cwd, "log", "--format=%B%x00", `${base}..HEAD`).split("\0").filter((m) => m.trim()),
  };
}

function run(cwd, { blockExit }) {
  let verdict;
  try {
    verdict = evaluateJourneyCoverage(readRange(cwd));
  } catch (e) {
    console.error(`journey coverage gate could not run: ${e.message}`);
    return process.exit(blockExit);
  }
  if (verdict.ok) return console.log(`journey coverage gate: pass (${verdict.reason})`);
  console.error(failureText(verdict, parseCatalog(readFileSync(`${cwd}/tests/journeys/CATALOG.md`, "utf8"))));
  process.exit(blockExit);
}

if (process.argv.includes("--claude-hook")) {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (isGatedCommand(payload.tool_input?.command ?? "")) run(payload.cwd || process.cwd(), { blockExit: 2 });
} else {
  run(process.cwd(), { blockExit: 1 });
}
