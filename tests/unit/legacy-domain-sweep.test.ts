import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripShellComments, stripTsComments } from "../support/strip-comments";

/**
 * The weekly digest cron was dead 2026-09-01 through 2026-09-17: it posted
 * to `https://intervuhq.com/api/email/digest`, which now 301-redirects to
 * velai.app, and curl without `-L` drops the POST on a redirect
 * (deploy/run-weekly-digest.sh). Fixing that one literal only fixed the
 * instance. This sweeps every production-reaching surface for the same
 * class — any script or app module that still hard-codes a retired origin
 * instead of deriving it (env override, `getSiteUrl()`, etc.) — by walking
 * the repo root and filtering by FILE TYPE, not by an enumerated list of
 * directories, so a new script or module anywhere in the tree is covered by
 * construction.
 *
 * Two retired web origins: `intervuhq.com` (bare, since nothing legitimate
 * ever names it outside a comment) and `intervu.cc` (only when it's a URL
 * origin — `https://intervu.cc`/`https://www.intervu.cc`). `intervu.cc`
 * bare is NOT flagged: it's `USERNAME_EMAIL_DOMAIN`
 * (src/lib/auth/username-email.ts) — the live domain of real user email
 * addresses (`<username>@intervu.cc`) — and flagging it would make the
 * sweep fire on every account-email code path in the app. Comments are
 * stripped before matching so historical documentation of the domain move
 * doesn't false-positive.
 */
const RETIRED_ORIGIN = /intervuhq\.com|https?:\/\/(?:www\.)?intervu\.cc\b/i;

/** Extensions and bare filenames this sweep treats as production-reaching
 *  source. A closed, explicit list (not an open-ended "everything"): each
 *  entry is a format the repo actually deploys or runs, not merely stores. */
const INCLUDED_EXTENSIONS = new Set([".sh", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".yml", ".yaml"]);
function isIncludedFile(name: string): boolean {
    return INCLUDED_EXTENSIONS.has(path.extname(name)) || name === "Caddyfile" || name === "Dockerfile" || name.startsWith("docker-compose");
}

/** Directories holding no production-reaching code of their own, so
 *  walking into them only produces noise or false positives:
 *  - node_modules, .next, .git: build/vendor output, not source we own.
 *  - tests: this sweep's own home (and every other suite's) — its
 *    fixtures and literals are deliberately old-domain strings used as
 *    test input, not production references.
 *  - docs: prose only; nothing under it is ever built or deployed. */
const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", "tests", "docs"]);

/** deploy/Caddyfile is the documented redirect SOURCE, not a hard-coded
 *  reference to the domain it retires: its vhost header
 *  (`intervuhq.com, www.intervuhq.com {`) exists specifically to MATCH the
 *  retired domain so Caddy can 308 it to the live one — the opposite of
 *  code that sends traffic TO a stale origin. Its redirect correctness has
 *  its own dedicated coverage in tests/unit/caddyfile-redirect-method.test.ts;
 *  this sweep isn't the right place to also police Caddy vhost syntax. */
const EXCLUDED_FILES = new Set(["deploy/Caddyfile"]);

/** hash-comment formats (`#`) vs C-style (line and block comments). A
 *  file's syntax family, not its identity, decides which stripper applies. */
const HASH_COMMENT_EXTENSIONS = new Set([".sh", ".yml", ".yaml"]);
function stripComments(source: string, rel: string): string {
    const base = path.basename(rel);
    const isHash = HASH_COMMENT_EXTENSIONS.has(path.extname(base)) || base === "Caddyfile" || base === "Dockerfile" || base.startsWith("docker-compose");
    return isHash ? stripShellComments(source) : stripTsComments(source);
}

/** The decision under test: does this file's non-comment text still name a
 *  retired origin? Pure — takes source text in, no I/O. */
function hardcodesRetiredDomain(source: string, rel: string): boolean {
    return RETIRED_ORIGIN.test(stripComments(source, rel));
}

function walk(root: string, dir: string): string[] {
    let entries: string[];
    try {
        entries = readdirSync(path.join(root, dir));
    } catch {
        return [];
    }
    return entries.flatMap((name) => {
        if (EXCLUDED_DIRS.has(name)) return [];
        const rel = dir === "." ? name : path.join(dir, name);
        const stat = statSync(path.join(root, rel));
        if (stat.isDirectory()) return walk(root, rel);
        return isIncludedFile(name) ? [rel] : [];
    });
}

/** Walks `root` for every production-reaching file and returns the
 *  repo-relative paths (POSIX-separated) of the ones that still hard-code a
 *  retired origin outside a comment. */
function findRetiredDomainHits(root: string): string[] {
    return walk(root, ".")
        .filter((rel) => !EXCLUDED_FILES.has(rel.split(path.sep).join("/")))
        .filter((rel) => hardcodesRetiredDomain(readFileSync(path.join(root, rel), "utf8"), rel))
        .map((rel) => rel.split(path.sep).join("/"));
}

const ROOT = process.cwd();

describe("no hard-coded retired domain reaches production", () => {
    it("no production-reaching file (by type, walked from repo root) hard-codes intervuhq.com or a intervu.cc origin", () => {
        const hits = findRetiredDomainHits(ROOT);
        assert.deepEqual(hits, [], `file(s) still hard-code a retired domain: ${hits.join(", ")}`);
    });

    it("the predicate can actually detect a literal, and comments don't hide one from a reader", () => {
        // Negative control: prove the predicate fires before trusting it to
        // stay silent above.
        assert.equal(hardcodesRetiredDomain('ENDPOINT="https://intervuhq.com/api/x"', "deploy/x.sh"), true);
        assert.equal(hardcodesRetiredDomain("# migrated off intervuhq.com\nENDPOINT=\"$X\"", "deploy/x.sh"), false);
        assert.equal(hardcodesRetiredDomain('const x = "https://intervuhq.com";', "src/x.ts"), true);
        assert.equal(hardcodesRetiredDomain("/** moved intervuhq.com -> velai.app */\nconst x = 1;", "src/x.ts"), false);
        // intervu.cc: a web origin is flagged, the email domain is not.
        assert.equal(hardcodesRetiredDomain('echo "check https://intervu.cc"', "scripts/x.sh"), true);
        assert.equal(hardcodesRetiredDomain('export const USERNAME_EMAIL_DOMAIN = "intervu.cc";', "src/x.ts"), false);
    });

    it("the walker itself flags a new script's hard-coded origin and does not flag an email address on the same domain", () => {
        // Non-vacuous proof of the WALKER (traversal + include/exclude), not
        // just the regex: a fresh scripts/ file the original two-directory
        // sweep never looked at, plus the intervu.cc/email-domain
        // distinction this fix adds — both are cases other than the
        // deploy/run-weekly-digest.sh instance that motivated the sweep.
        const tmp = mkdtempSync(path.join(tmpdir(), "legacy-domain-sweep-"));
        try {
            mkdirSync(path.join(tmp, "scripts"), { recursive: true });
            writeFileSync(path.join(tmp, "scripts", "x.sh"), 'curl -X POST "https://intervu.cc/api/x"\n');
            writeFileSync(path.join(tmp, "scripts", "y.sh"), 'echo "notify support@intervu.cc"\n');
            const hits = findRetiredDomainHits(tmp);
            assert.deepEqual(hits, ["scripts/x.sh"]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
