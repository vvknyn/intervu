import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEARCH_PLACEHOLDER } from "../../src/lib/jobs/search-copy";

const ROOT = join(__dirname, "../../src");
const OWNER = join(ROOT, "lib/jobs/search-copy.ts");
const CURRENT = /Job title, skill, or company/;
const STALE = /What kind of work are you looking for\?/;

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(tsx|ts)$/.test(name)) out.push(path);
    }
    return out;
}

/**
 * The /jobs search box's query placeholder used to be typed out twice —
 * `jobs/page.tsx` defined it, `components/mock/SearchDockMock.tsx` (and, as
 * this scan found, `SearchEmphasisMock.tsx` too) hardcoded their own copy,
 * one of them stale ("What kind of work are you looking for?" survived a
 * copy change and reached prod via /mock/search-dock). `search-copy.ts` is
 * now the one place either string may appear; this fails the class, not
 * just the two instances that surfaced it, for any FUTURE file that spells
 * either version out again instead of importing `SEARCH_PLACEHOLDER`.
 */
describe("search placeholder — single source of truth", () => {
    it("no file outside search-copy.ts contains the current or the stale placeholder literal", () => {
        for (const file of walk(ROOT)) {
            if (file === OWNER) continue;
            const stripped = readFileSync(file, "utf8")
                .replace(/\/\/[^\n]*/g, "")
                .replace(/\/\*[\s\S]*?\*\//g, "");
            assert.doesNotMatch(stripped, CURRENT, `${file} hardcodes the current placeholder — import SEARCH_PLACEHOLDER instead`);
            assert.doesNotMatch(stripped, STALE, `${file} hardcodes the stale placeholder copy`);
        }
    });

    it("the shared constant is still the copy every consumer should read", () => {
        assert.equal(SEARCH_PLACEHOLDER, "Job title, skill, or company");
    });
});
