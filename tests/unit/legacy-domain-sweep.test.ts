import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripShellComments, stripTsComments } from "../support/strip-comments";

/**
 * The weekly digest cron was dead 2026-09-01 through 2026-09-17: it posted
 * to `https://intervuhq.com/api/email/digest`, which now 301-redirects to
 * velai.app, and curl without `-L` drops the POST on a redirect
 * (deploy/run-weekly-digest.sh). Fixing that one literal only fixes the
 * instance; this sweeps every production-reaching surface for the same
 * class — any script or app module that still hard-codes the retired
 * domain instead of deriving it (env override, `getSiteUrl()`, etc.).
 *
 * Scope is deliberately by FILE TYPE, not by name, so a new script or
 * module is covered by construction:
 *   - deploy/**\/*.sh — host-side cron/deploy scripts, the class that broke.
 *   - src/**\/*.ts(x) — app code (canonical/sitemap/OG, email links, MCP
 *     docs, etc.).
 * deploy/Caddyfile is excluded by extension, not by name: it's the
 * documented redirect SOURCE (the intervuhq.com vhost that 301s to
 * velai.app), not a hard-coded reference to it. Comments are stripped
 * before matching so historical documentation of the domain move doesn't
 * false-positive.
 */
const RETIRED_DOMAIN = /intervuhq\.com/i;
const ROOT = process.cwd();

function walk(dir: string, extensions: string[]): string[] {
    let entries: string[];
    try {
        entries = readdirSync(path.join(ROOT, dir));
    } catch {
        return [];
    }
    return entries.flatMap((name) => {
        const rel = path.join(dir, name);
        const stat = statSync(path.join(ROOT, rel));
        if (stat.isDirectory()) return walk(rel, extensions);
        return extensions.some((ext) => name.endsWith(ext)) ? [rel] : [];
    });
}

/** The decision under test: does this file's non-comment text still name
 *  the retired domain? Pure — takes source text in, no I/O. */
function hardcodesRetiredDomain(source: string, kind: "sh" | "ts"): boolean {
    const stripped = kind === "sh" ? stripShellComments(source) : stripTsComments(source);
    return RETIRED_DOMAIN.test(stripped);
}

function violations(dir: string, extensions: string[], kind: "sh" | "ts"): string[] {
    return walk(dir, extensions).filter((rel) =>
        hardcodesRetiredDomain(readFileSync(path.join(ROOT, rel), "utf8"), kind),
    );
}

describe("no hard-coded retired domain reaches production", () => {
    it("no deploy/**/*.sh script posts to intervuhq.com", () => {
        const hits = violations("deploy", [".sh"], "sh");
        assert.deepEqual(hits, [], `deploy script(s) still hard-code the retired domain: ${hits.join(", ")}`);
    });

    it("no src/**/*.ts(x) module hard-codes intervuhq.com outside a comment", () => {
        const hits = violations("src", [".ts", ".tsx"], "ts");
        assert.deepEqual(hits, [], `app module(s) still hard-code the retired domain: ${hits.join(", ")}`);
    });

    it("the sweep can actually detect a literal, and comments don't hide one from a reader", () => {
        // Negative control: prove the predicate fires before trusting it to
        // stay silent above.
        assert.equal(hardcodesRetiredDomain('ENDPOINT="https://intervuhq.com/api/x"', "sh"), true);
        assert.equal(hardcodesRetiredDomain("# migrated off intervuhq.com\nENDPOINT=\"$X\"", "sh"), false);
        assert.equal(hardcodesRetiredDomain('const x = "https://intervuhq.com";', "ts"), true);
        assert.equal(hardcodesRetiredDomain("/** moved intervuhq.com -> velai.app */\nconst x = 1;", "ts"), false);
    });
});
