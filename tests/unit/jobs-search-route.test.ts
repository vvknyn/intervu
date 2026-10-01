/**
 * POST /api/jobs/search (2026-10-01) carries the jobs list search over a
 * plain fetch. Next runs a page's Server Action calls one at a time, and the
 * search was one, so every click backed by an action waited behind any
 * search still loading (a phone's Save search waited 5s) and a page's
 * searches ran one after another. Same reason as ../suggest and the detail
 * route before it.
 *
 * `parseSearchBody` is pinned directly; `POST` itself reaches
 * `searchJobsAction`, which reads next/headers and needs a request scope.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_SEARCH_BODY_BYTES, parseSearchBody } from "../../src/app/api/jobs/search/route";

describe("parseSearchBody", () => {
    it("reads a params object", () => {
        assert.deepEqual(parseSearchBody(JSON.stringify({ q: "engineer", limit: 20 })), { q: "engineer", limit: 20 });
    });

    it("refuses anything that isn't a params object", () => {
        for (const raw of ["", "not json", "null", "[]", '"engineer"', "42"]) assert.equal(parseSearchBody(raw), null, raw);
    });

    it("refuses a body far past any real search", () => {
        assert.equal(parseSearchBody(JSON.stringify({ q: "a".repeat(MAX_SEARCH_BODY_BYTES) })), null);
    });
});

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

it("no browser code calls the search as a Server Action", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(new URL("../../src", import.meta.url).pathname)) {
        const src = readFileSync(file, "utf8");
        if (!/^["']use client["']/m.test(src)) continue;
        if (/import\s*\{[^}]*\bsearchJobsAction\b[^}]*\}\s*from\s*["']@\/actions\/jobs["']/.test(src)) {
            offenders.push(file.replace(/^.*\/src\//, "src/"));
        }
    }
    assert.deepEqual(offenders, [], "import `searchJobs` from @/lib/jobs/search-client instead");
});
