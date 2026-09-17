import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The weekly digest cron was dead 2026-09-01 through 2026-09-17 because
 * intervuhq.com's `redir ... permanent` (Caddy's 301) drops a POST instead
 * of preserving it. Fixing that one vhost only fixes the instance — this
 * scans EVERY `redir` in deploy/Caddyfile whose target is a different host
 * than the vhost it lives in, and asserts the code is 307 or 308 (Caddy's
 * only method-preserving redirect codes), so a future cross-host redirect
 * can't silently reintroduce the same class of bug.
 *
 * Deliberately not scoped to "the old-domain vhosts": a same-apex redirect
 * (www.velai.app -> velai.app) drops a POST exactly the same way a
 * retired-domain one does, and the scan finds it by the same rule.
 */
const CADDYFILE_PATH = path.join(process.cwd(), "deploy", "Caddyfile");

interface RedirDirective {
    line: number;
    vhostHosts: string[];
    targetHost: string;
    code: string | null;
}

/** Bare host (no port) for each vhost address on a Caddyfile block-opener
 *  line, or null if the line opens a named snippet ("(name) {") rather
 *  than a vhost. */
function vhostHostsFromHeader(header: string): string[] | null {
    if (/^\([\w.-]+\)$/.test(header)) return null;
    const hosts = header
        .split(",")
        .map((h) => h.trim().split(":")[0])
        .filter(Boolean);
    return hosts.length > 0 ? hosts : null;
}

/** Pure parse: every `redir` directive in a Caddyfile whose absolute-URL
 *  target's host differs from every host of its enclosing top-level vhost. */
export function crossHostRedirects(source: string): RedirDirective[] {
    const results: RedirDirective[] = [];
    let depth = 0;
    let currentVhostHosts: string[] | null = null;

    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;

        if (depth === 0 && line.endsWith("{")) {
            currentVhostHosts = vhostHostsFromHeader(line.slice(0, -1).trim());
            depth = 1;
            continue;
        }

        if (depth >= 1) {
            const redirMatch = line.match(/^redir\s+(?:(@\S+)\s+)?(\S+)(?:\s+(\S+))?\s*$/);
            if (redirMatch && currentVhostHosts) {
                const [, , target, code] = redirMatch;
                const absolute = target.match(/^https?:\/\/([a-z0-9.-]+)/i);
                if (absolute) {
                    const targetHost = absolute[1];
                    if (!currentVhostHosts.includes(targetHost)) {
                        results.push({ line: i + 1, vhostHosts: currentVhostHosts, targetHost, code: code ?? null });
                    }
                }
            }

            const opens = (line.match(/{/g) ?? []).length;
            const closes = (line.match(/}/g) ?? []).length;
            depth += opens - closes;
            if (depth <= 0) {
                depth = 0;
                currentVhostHosts = null;
            }
        }
    }
    return results;
}

const METHOD_PRESERVING_CODES = new Set(["307", "308"]);

/** The decision under test: does this redirect's code keep the request's
 *  method and body intact? */
export function isMethodPreserving(code: string | null): boolean {
    return code !== null && METHOD_PRESERVING_CODES.has(code);
}

describe("deploy/Caddyfile: every cross-host redirect preserves method", () => {
    it("no redir to a different host uses a method-dropping code", () => {
        const source = readFileSync(CADDYFILE_PATH, "utf8");
        const crossHost = crossHostRedirects(source);
        assert.ok(crossHost.length > 0, "expected at least one cross-host redirect to check (parser regression?)");
        const violations = crossHost.filter((r) => !isMethodPreserving(r.code));
        assert.deepEqual(
            violations,
            [],
            violations
                .map((v) => `Caddyfile:${v.line} — ${v.vhostHosts.join(",")} -> ${v.targetHost} uses code "${v.code}" (needs 307/308)`)
                .join("; "),
        );
    });

    it("the scan can actually detect a violation and isn't vacuous", () => {
        const fixture = [
            "old.example.com {",
            "\thandle {",
            "\t\tredir https://new.example.com{uri} permanent",
            "\t}",
            "}",
        ].join("\n");
        const hits = crossHostRedirects(fixture);
        assert.equal(hits.length, 1);
        assert.equal(isMethodPreserving(hits[0].code), false);

        const fixed = fixture.replace("permanent", "308");
        assert.equal(isMethodPreserving(crossHostRedirects(fixed)[0].code), true);

        // Same-host redirect (e.g. path rewrite) is not cross-host and is
        // out of scope, regardless of code.
        const sameHost = "example.com {\n\tredir https://example.com/new permanent\n}";
        assert.deepEqual(crossHostRedirects(sameHost), []);
    });
});
