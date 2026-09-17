import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Company-render ratchet.
 *
 * The company-name seam rework (2026-08-29) removed an ingest-time cleaning
 * seam that would have run in production for exactly zero requests (the live
 * Meili index is written by a separate repo's sync job, which PUTs the
 * Subspace feed through unchanged). That means the index carries the
 * ATS-stated raw `company` string PERMANENTLY;
 * intervu owns brand cleaning at DISPLAY time only
 * (`lib/jobs/presentation.ts`'s `displayCompanyBrand` chain, or the
 * `lib/presentation/` wrapper built on it). Four real bypasses of that
 * chokepoint shipped before this test existed — a typeahead suggestion, an
 * MCP tool response, a company-page `<h1>`, an OG-image caption, an external
 * AI hand-off prompt, an email digest, a rail pipeline widget
 * (`PipelineCard.tsx`), and the job-card/detail logo's `alt` text
 * (`CompanyLogo.tsx`) all rendered `job.company` raw at one point — the last
 * two were found BY this ratchet's first real run, not by manual audit.
 * Neither `tsc` nor eslint catches a property read; this is a
 * ratchet for that specific class.
 *
 * DETECTION MODE: grep, not a type-aware AST scan. Strip comments, then flag
 * any `.company` property read (word-boundary, excluding `.company.name` /
 * `.company.domain` — the field names on `PresentedCompany`, an ALREADY-
 * cleaned value returned by `presentCompany`/`presentJob`) across
 * `src/app`, `src/components`, `src/lib/agent`, `src/lib/email` — the
 * surfaces that actually render to a person or an external tool, as opposed
 * to `src/lib/jobs`/`src/lib/companies` which own the cleaning itself and
 * legitimately pass raw values between their own internal functions. A read
 * on the same line as a call to a cleaning function (`displayCompanyBrand`,
 * `displayCompanyName`, `displayCompany`, `cleanCompany`, `presentCompany`,
 * `presentJob`) is exempt without needing an allowlist entry — that's the
 * common "already handled" shape (`companyBrand || job.company || "..."`
 * does need an entry, since the call is on an earlier line; see the
 * allowlist below).
 *
 * KNOWN, ACCEPTED BLIND SPOT (mirrors module-adoption.test.ts's own
 * transparency convention): this only catches `.company` DOT-ACCESS. A
 * destructured read — `const { company } = job` — is invisible to it. The
 * real `lib/agent/tools.ts` bug this rework fixed was exactly that shape (a
 * targeted grep for `\.company\b` across `src/lib/agent/*.ts` found zero
 * matches even though the bug was real). A bare-identifier/destructuring-
 * aware regex was deliberately not attempted: `company` alone is also a
 * `Pick<...>` string literal, a JSX prop name, and an unrelated local
 * variable name in this codebase (résumé `exp.company`, tracker
 * `draft.company`, …), so a destructuring-aware pattern would trade a
 * disappearing miss rate for a large false-positive rate. This is a
 * documented scope limit, not an oversight — destructured reads still need
 * a human to catch in review.
 *
 * ALLOWLIST CONTRACT: same shape as `module-adoption-baseline.json`'s, kept
 * inline here (not a separate JSON file) because JSON can't carry the
 * per-entry reasoning the coordinator required. Each entry names a file and
 * a distinguishing substring of the allowed line — narrower than the whole
 * file, so a NEW raw read added anywhere else in the same file still fails.
 * The two directory-level entries are the only whole-file exemptions, and
 * only because those directories are topically disjoint from the job corpus
 * end to end (design-mockup fixture data; résumé work-history, a different
 * "company" concept entirely).
 */

const SCAN_ROOTS = ["src/app", "src/components", "src/lib/agent", "src/lib/email"];
const CODE_FILE_RE = /\.(ts|tsx)$/;
const SKIP_FILE_RE = /\.(d|test|spec)\.(ts|tsx)$/;

/** Whole directories exempt from the scan — see the ALLOWLIST CONTRACT note
 *  above for why these two, and only these two, are file-level rather than
 *  line-level. POSIX-relative, trailing slash. */
const EXEMPT_DIRS = [
  "src/components/mock/", // hardcoded design-preview fixture data (MOCK_JOBS), never a live corpus value
  "src/components/resume-builder/", // résumé work-history `exp.company` — user-typed, unrelated to the job corpus
];

interface AllowEntry {
  /** POSIX-relative file path. */
  file: string;
  /** Substring of the allowed line (original, unstripped text) that identifies this specific read. */
  match: string;
  reason: string;
}

const ALLOWLIST: AllowEntry[] = [
  {
    file: "src/app/yours/history/page.tsx",
    match: "jobPath({ id: view.job_id, title: snapshot.title, company: snapshot.company })",
    reason: "slug-building input, no domain to key off — presentation.ts:802-808's documented raw-consumer category",
  },
  {
    file: "src/app/yours/page.tsx",
    match: "company_name: draft.company",
    reason: "user-typed manual pursuit-entry form field, not corpus data",
  },
  {
    file: "src/app/yours/page.tsx",
    match: "addManualGuestPursuit(draft.company, draft.position",
    reason: "user-typed manual pursuit-entry form field, not corpus data",
  },
  {
    file: "src/app/jobs/page.tsx",
    match: "recordRecentlyViewedJob({ id, title: hit.title, company: hit.company",
    reason: "write-only storage field — recently-viewed.ts/viewed-set.ts only ever read back `.id`, never `.company`",
  },
  {
    file: "src/app/jobs/page.tsx",
    match: "company: job.company ?? \"\",",
    reason: "Firestore write payload for markJobAppliedAction — already covered by the read-time fixes at yours/[id] and yours/history, so the write itself doesn't need to be clean",
  },
  {
    file: "src/components/jobs/PublicJobDetail.tsx",
    match: "company: target.company ?? \"\",",
    reason: "Firestore write payload for markJobAppliedAction — same as jobs/page.tsx's mirror call",
  },
  {
    file: "src/components/jobs/ApplyReturnPrompt.tsx",
    match: "company: job.company }",
    reason: "write-only sessionStorage field written by armApplyReturn — the record is never rendered raw, only decodeText(record.title) is displayed",
  },
  {
    file: "src/components/jobs/ApplyReturnPrompt.tsx",
    match: "company: pending.company, apply_url: \"\"",
    reason: "pass-through of the already-stored sessionStorage record back to the caller's doMarkApplied, which itself only uses it as a Firestore write payload (see the jobs/page.tsx and PublicJobDetail.tsx entries above)",
  },
  {
    file: "src/components/modals/FavoritesModal.tsx",
    match: "favorite.company",
    reason: "free-text field on a saved interview question, unrelated to the job corpus",
  },
  {
    file: "src/app/jobs/page.tsx",
    match: '<CompanyLogo domain={job.company_domain} name={job.company} size="md" />',
    reason: "CompanyLogo (components/jobs/CompanyLogo.tsx) cleans its `name` prop internally via cleanCompany before using it in the initial tile or the <img> alt text — the chokepoint is inside the component, not each call site",
  },
  {
    file: "src/components/jobs/JobDetail.tsx",
    match: '<CompanyLogo domain={job.company_domain} name={job.company} size="md" />',
    reason: "CompanyLogo cleans its `name` prop internally — see the jobs/page.tsx entry above",
  },
  {
    file: "src/components/jobs/JobDetailDocument.tsx",
    match: '<CompanyLogo domain={job.company_domain} name={job.company} size="lg" />',
    reason: "CompanyLogo cleans its `name` prop internally — see the jobs/page.tsx entry above",
  },
  {
    file: "src/components/jobs/JobDetail.tsx",
    match: "companyBrand || cleanedCompany || job.company",
    reason: "idempotent last-resort fallback — companyBrand is displayCompanyBrand(job.company, ...) computed a few lines above; job.company is only reached when every cleaned form is empty",
  },
  {
    file: "src/components/jobs/JobDetail.tsx",
    match: "company: companyBrand || job.company || \"Unknown company\"",
    reason: "idempotent last-resort fallback — same companyBrand as above",
  },
  {
    file: "src/components/jobs/JobDetailDocument.tsx",
    match: "company: companyBrand || job.company || \"Unknown company\"",
    reason: "idempotent last-resort fallback — companyBrand is displayCompanyBrand(job.company, ...) computed a few lines above",
  },
  {
    file: "src/lib/email/templates/digest.ts",
    match: "at ${item.company}",
    reason: "item is a DigestSectionItem, already cleaned by toSectionItem (lib/email/digest/collect.ts) before it reaches the template — not a raw PublicJob field",
  },
  {
    file: "src/lib/email/templates/digest.ts",
    match: "escapeHtml(item.company)",
    reason: "same as above — DigestSectionItem.company, already cleaned upstream",
  },
  {
    file: "src/lib/email/digest/tracked-companies.ts",
    match: "displayName: job?.company ?? null",
    reason: "raw capture into TrackedCompanyCandidate; cleaned two lines later in selectTrackedCompanies via displayCompany(candidate.displayName, domain)",
  },
];

function stripComments(source: string): string {
  // Coarse, same trade-off module-adoption.test.ts's specifier regex makes:
  // no string-literal awareness (nothing here has "//" or "/*" inside a
  // string on the same line as ".company"). Block comments are blanked
  // char-by-char rather than deleted outright — deleting would swallow the
  // newlines inside a multi-line `/** ... */`, shifting every later line's
  // number out of sync with the original source.
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments.replace(/\/\/.*$/gm, "");
}

const RAW_COMPANY_RE = /\.company\b(?!\.(?:name|domain))/;
const CLEANING_CALL_RE = /\b(?:displayCompanyBrand|displayCompanyName|displayCompany|cleanCompany|presentCompany|presentJob)\(/;

export interface RawCompanyRead {
  line: number;
  text: string;
}

/** Pure: every raw `.company` read in one file's source, after stripping
 *  comments and exempting lines that also call a cleaning function. */
export function findRawCompanyReads(source: string): RawCompanyRead[] {
  const strippedLines = stripComments(source).split("\n");
  const rawLines = source.split("\n");
  const violations: RawCompanyRead[] = [];
  for (let i = 0; i < strippedLines.length; i++) {
    const strippedLine = strippedLines[i]!;
    if (RAW_COMPANY_RE.test(strippedLine) && !CLEANING_CALL_RE.test(strippedLine)) {
      violations.push({ line: i + 1, text: rawLines[i]!.trim() });
    }
  }
  return violations;
}

function isExemptDir(relPath: string): boolean {
  return EXEMPT_DIRS.some((dir) => relPath.startsWith(dir));
}

function isAllowed(relPath: string, lineText: string, allowlist: AllowEntry[]): boolean {
  return allowlist.some((e) => e.file === relPath && lineText.includes(e.match));
}

function walkScanFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkScanFiles(full, out);
    else if (CODE_FILE_RE.test(full) && !SKIP_FILE_RE.test(full)) out.push(full);
  }
  return out;
}

export interface CompanyRenderViolation {
  file: string;
  line: number;
  text: string;
}

/** Pure: scan every file under `roots` (repo-relative), skip exempt
 *  directories, and return every raw `.company` read not covered by
 *  `allowlist`. */
export function scanForUnguardedCompanyReads(
  repoRoot: string,
  roots: string[],
  allowlist: AllowEntry[],
): CompanyRenderViolation[] {
  const violations: CompanyRenderViolation[] = [];
  for (const root of roots) {
    const absRoot = join(repoRoot, root);
    for (const file of walkScanFiles(absRoot)) {
      const relPath = relative(repoRoot, file).split(sep).join("/");
      if (isExemptDir(relPath)) continue;
      const source = readFileSync(file, "utf8");
      for (const read of findRawCompanyReads(source)) {
        if (isAllowed(relPath, read.text, allowlist)) continue;
        violations.push({ file: relPath, line: read.line, text: read.text });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Fixtures: prove the mechanism catches the CLASS, not just today's instance.
// ---------------------------------------------------------------------------

describe("findRawCompanyReads — fixtures", () => {
  it("flags a raw dot-access read", () => {
    const reads = findRawCompanyReads('const x = job.company;\n');
    assert.deepEqual(reads, [{ line: 1, text: "const x = job.company;" }]);
  });

  it("does not flag .company.name / .company.domain — an already-cleaned PresentedCompany field", () => {
    const reads = findRawCompanyReads(
      'const name = presented.company.name;\nconst domain = presented.company.domain;\n',
    );
    assert.deepEqual(reads, []);
  });

  it("does not flag a match inside a comment", () => {
    const reads = findRawCompanyReads(
      '// job.company is cleaned at render, same as job_snapshot.company\nconst x = 1;\n',
    );
    assert.deepEqual(reads, []);
  });

  it("does not flag a match inside a block comment, and keeps line numbers for real code after it in sync", () => {
    // The multi-line block comment must not swallow its own newlines when
    // blanked — otherwise the real violation on the line after it would be
    // misnumbered (or, worse, misattributed to a different, comment-only line).
    const reads = findRawCompanyReads(
      '/**\n * job.company here is documentation, not code.\n */\nconst x = job.company;\n',
    );
    assert.deepEqual(reads, [{ line: 4, text: "const x = job.company;" }]);
  });

  it("does not flag a read on the same line as a cleaning-function call", () => {
    const reads = findRawCompanyReads(
      'const c = displayCompanyBrand(job.company, job.company_domain, job.title) || job.company;\n',
    );
    assert.deepEqual(reads, [], "job.company appears twice on this line, both exempt — the call is the same-line signal, not a per-occurrence one");
  });

  it("does NOT catch a destructured read — the documented blind spot", () => {
    const reads = findRawCompanyReads('const { company } = job;\nrender(company);\n');
    assert.deepEqual(reads, [], "destructuring is invisible to a dot-access regex — see the docblock above");
  });

  it("flags company_domain-adjacent code without false-tripping on the field name itself", () => {
    const reads = findRawCompanyReads('const d = job.company_domain;\nconst c = job.company;\n');
    assert.deepEqual(reads, [{ line: 2, text: "const c = job.company;" }]);
  });
});

describe("scanForUnguardedCompanyReads — fixtures", () => {
  it("an allowlist entry suppresses only its own matching line, not other raw reads in the same file", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "company-render-guard-fixture-"));
    try {
      fs.mkdirSync(path.join(root, "src/app"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "src/app/page.tsx"),
        'const allowed = draft.company;\nconst notAllowed = job.company;\n',
      );
      const violations = scanForUnguardedCompanyReads(root, ["src/app"], [
        { file: "src/app/page.tsx", match: "draft.company", reason: "test fixture" },
      ]);
      assert.deepEqual(violations, [{ file: "src/app/page.tsx", line: 2, text: "const notAllowed = job.company;" }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("an exempt directory suppresses every raw read inside it", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "company-render-guard-fixture-"));
    try {
      fs.mkdirSync(path.join(root, "src/components/mock"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/components/mock/Demo.tsx"), 'const x = job.company;\n');
      const violations = scanForUnguardedCompanyReads(root, ["src/components/mock"], []);
      assert.deepEqual(violations, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The actual guard: scan the real repo's render/tool/email surfaces.
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

describe("company render guard", () => {
  it("every raw `.company` read outside the presentation chokepoint is either cleaned inline or explicitly allowlisted with a reason", () => {
    const violations = scanForUnguardedCompanyReads(REPO_ROOT, SCAN_ROOTS, ALLOWLIST);
    assert.deepEqual(
      violations,
      [],
      `${violations.length} unguarded raw .company read(s) found:\n` +
        violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join("\n") +
        `\n\nEach either needs to route through displayCompanyBrand/displayCompanyName/displayCompany/` +
        `cleanCompany/presentCompany/presentJob, or — if it's a genuinely legitimate raw consumer ` +
        `(slug/keying, corpus tally, non-corpus free text, write-only field, already-cleaned wrapper ` +
        `field) — needs a new entry in this file's ALLOWLIST with a reason.`,
    );
  });
});
