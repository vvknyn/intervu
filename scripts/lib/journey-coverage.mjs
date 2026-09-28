// Pure decisions for the journey-coverage gate (scripts/check-journey-coverage.mjs).
// No I/O: input is the changed paths + commit messages of a branch range.

/** Directories whose non-test files are what a user sees or triggers. Class rule — never a file list. */
export const USER_FACING_ROOTS = ["src/app/", "src/components/", "src/actions/"];

const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)/;
/** A changed journey spec is the only thing that proves a journey is guarded: a catalog row alone does not. */
const JOURNEY_SPEC_RE = /^tests\/e2e\/journeys\/.+\.spec\.ts$/;
const TRAILER_RE = /^Journey-Impact:\s*none\s*(?:—|–|--?)\s*(.*)$/im;
export const MIN_TRAILER_REASON = 15;

export const isUserFacing = (p) => USER_FACING_ROOTS.some((r) => p.startsWith(r)) && !TEST_FILE_RE.test(p);

export function hasValidJourneyImpactTrailer(commitMessages) {
  return commitMessages.some((m) => (TRAILER_RE.exec(m)?.[1] ?? "").trim().length >= MIN_TRAILER_REASON);
}

/** src/app/(group)/jobs/[slug]/page.tsx → /jobs/[slug]; null outside src/app. */
export function routeOf(path) {
  if (!path.startsWith("src/app/")) return null;
  const segs = path.slice("src/app/".length).split("/").slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

const norm = (route) => route.split("?")[0].replace(/\[[^\]]+\]|<[^>]+>/g, "*").replace(/\/$/, "") || "/";

/** Catalog rows whose Entry route is the changed route, or nested under / above it. Advisory pointer for the author. */
export function rowsForRoute(rows, route) {
  const r = norm(route);
  return rows.filter((row) => {
    const e = norm(row.entry.replace(/`/g, ""));
    return e === r || e.startsWith(r + "/") || (r !== "/" && r.startsWith(e + "/"));
  });
}

export function evaluateJourneyCoverage({ changedPaths, commitMessages }) {
  const userFacing = changedPaths.filter(isUserFacing);
  if (userFacing.length === 0) return { ok: true, reason: "no user-facing files changed", userFacing };
  if (changedPaths.some((p) => JOURNEY_SPEC_RE.test(p))) return { ok: true, reason: "journey spec changed", userFacing };
  if (hasValidJourneyImpactTrailer(commitMessages)) return { ok: true, reason: "Journey-Impact trailer", userFacing };
  return { ok: false, reason: "user-facing change without a journey spec change", userFacing };
}

export function failureText({ userFacing }, catalogRows) {
  const routes = [...new Set(userFacing.map(routeOf).filter(Boolean))];
  const lines = ["JOURNEY COVERAGE GATE FAILED: user-facing files changed with no journey spec change.", "", "User-facing files changed:"];
  lines.push(...userFacing.map((p) => `  ${p}`));
  lines.push("", "Catalog rows on the affected routes (update their spec, or add a row if none fits):");
  const shown = routes.flatMap((route) => rowsForRoute(catalogRows, route).map((r) => `  ${r.id} [${r.status}] ${r.entry} — ${r.journey}`));
  lines.push(...(shown.length ? [...new Set(shown)] : ["  (none match — this likely needs a new row)"]));
  lines.push(
    "",
    "Fix ONE of:",
    "  1. Add or update a row in tests/journeys/CATALOG.md AND add/change a spec in tests/e2e/journeys/*.spec.ts tagged { tag: ['@J-AREA-NN'] }.",
    "     (A catalog row alone does not pass the gate — only a changed spec does.)",
    "  2. If the change cannot alter any user journey (pure refactor/styling), add a commit trailer:",
    `     Journey-Impact: none — <reason, at least ${MIN_TRAILER_REASON} characters>`,
  );
  return lines.join("\n");
}

// ── Claude Code PreToolUse hook: which Bash commands are gated ──────────────

/** Quote-aware split into simple commands (token arrays); separators/heredocs outside quotes only. */
export function shellSegments(command) {
  const segments = [];
  let tokens = [];
  let cur = "";
  let quote = null;
  const endToken = () => { if (cur) tokens.push(cur); cur = ""; };
  const endSegment = () => { endToken(); if (tokens.length) segments.push(tokens); tokens = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "<" && command[i + 1] === "<") break; // heredoc body is data, not commands
    if (c === "&" || c === "|" || c === ";" || c === "\n") { endSegment(); continue; }
    if (/\s/.test(c)) { endToken(); continue; }
    cur += c;
  }
  endSegment();
  return segments;
}

const GIT_FLAGS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** True when any simple command is `git push` or `gh pr create` (token match, never substring). */
export function isGatedCommand(command) {
  return shellSegments(command).some((all) => {
    const t = all.slice(all.findIndex((tok) => !/^\w+=/.test(tok)));
    if (t[0] === "gh") return t[1] === "pr" && t[2] === "create";
    if (t[0] !== "git") return false;
    let i = 1;
    while (i < t.length && t[i].startsWith("-")) i += GIT_FLAGS_WITH_VALUE.has(t[i]) ? 2 : 1;
    return t[i] === "push";
  });
}
