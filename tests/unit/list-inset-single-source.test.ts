import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src");
const OWNER = join(ROOT, "app/globals.css");
const PAGE = join(ROOT, "app/jobs/JobsContent.tsx");
const DECLARATION = /--list-inset\s*:\s*[\d.]+/;
const USAGE = /var\(--list-inset\)/g;

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(css|tsx|ts)$/.test(name)) out.push(path);
    }
    return out;
}

/**
 * The /jobs results list's horizontal inset used to be restated per surface —
 * JobCard carried its own `px-4`, the results header row and the "beyond
 * window" / "Get new matches by email" lines (both descendants of that same
 * header row) carried none at all, so header text sat flush against the
 * card edge while row content stayed inset (mobile layout audit,
 * 2026-09-18). `--list-inset` in globals.css is now the one place that
 * value is declared; every surface reads `var(--list-inset)` instead of a
 * hardcoded `px-*`, which is what keeps header and row edges aligned at
 * every width by construction rather than by two authors agreeing on 16px.
 */
describe("/jobs list inset — single source of truth", () => {
    it("no file other than globals.css declares --list-inset", () => {
        for (const file of walk(ROOT)) {
            if (file === OWNER) continue;
            const stripped = readFileSync(file, "utf8")
                .replace(/\/\/[^\n]*/g, "")
                .replace(/\/\*[\s\S]*?\*\//g, "");
            assert.doesNotMatch(
                stripped,
                DECLARATION,
                `${file} declares --list-inset — the value must live only in ${OWNER}`,
            );
        }
    });

    it("globals.css declares the token exactly once, at 16px", () => {
        const css = readFileSync(OWNER, "utf8");
        const declarations = css.match(new RegExp(DECLARATION, "g")) ?? [];
        assert.equal(declarations.length, 1, "expected exactly one --list-inset declaration");
        assert.match(css, /--list-inset:\s*16px/);
    });

    it("both the JobRow and the results header row consume var(--list-inset), not a literal px-* inset", () => {
        const page = readFileSync(PAGE, "utf8");
        const usages = page.match(USAGE) ?? [];
        // JobRow (the card's own horizontal inset) + the results header row —
        // the two surfaces the audit found disagreeing. A count below 2 means
        // at least one of them reverted to a hardcoded value.
        assert.ok(
            usages.length >= 2,
            `expected page.tsx to reference var(--list-inset) at least twice (JobRow + header row), found ${usages.length}`,
        );
    });

    /**
     * 2026-09-18 straggler pass: the guest-nudge/alert banner group (local-ai,
     * guest-save, guest-engage, email-nudge, search-alert) and the
     * `JobsListSplash` loading state sat flush against the panel's rounded
     * corner because neither read `--list-inset` — they restated no inset at
     * all. Both are now wrapped in a container that reads the token, proven
     * here by source-scan (not just one banner — the whole contiguous group)
     * so a new banner added to the same block inherits the fix by
     * construction instead of needing its own px-4.
     */
    it("the guest-nudge/alert banner group is wrapped in a var(--list-inset) container, not flush", () => {
        const page = readFileSync(PAGE, "utf8");
        const groupStart = page.indexOf("Single container for the contiguous guest-nudge");
        const groupEnd = page.indexOf("Screen 4 — the relaxed pass", groupStart);
        assert.ok(groupStart >= 0 && groupEnd > groupStart, "banner-group wrapper markers not found");
        const group = page.slice(groupStart, groupEnd);
        // A fresh non-global regex — `USAGE` carries the `g` flag, and
        // `assert.match`'s repeated `.test()` calls against that shared
        // instance mutate its `lastIndex`, corrupting later assertions.
        assert.match(group, /var\(--list-inset\)/, "banner group must open with a var(--list-inset) container");
        for (const testid of ["guest-save-banner"]) {
            assert.match(group, new RegExp(`data-testid="${testid}"`), `${testid} must sit inside the inset banner group`);
        }
    });

    it("JobsListSplash's loading line and skeleton rows read var(--list-inset), not flush", () => {
        // acb97835 extracted the splash to components/jobs/JobsListSplash.tsx.
        const fn = readFileSync(join(ROOT, "components/jobs/JobsListSplash.tsx"), "utf8");
        assert.match(fn, /var\(--list-inset\)/, "JobsListSplash must read var(--list-inset), not restate px-4");
    });

    it("EmptyResults root reads var(--list-inset) so zero-hit copy and seed pills align with rows", () => {
        const page = readFileSync(PAGE, "utf8");
        const fnStart = page.indexOf("function EmptyResults(");
        const fnEnd = page.indexOf("function ListTail(", fnStart);
        assert.ok(fnStart >= 0 && fnEnd > fnStart, "EmptyResults function not found");
        const fn = page.slice(fnStart, fnEnd);
        // 13afd60c routes the root through the shared `posterListInsetClassName`
        // (route-loading.tsx), whose class reads the one --list-inset token.
        assert.match(
            fn,
            /<div className=\{posterListInsetClassName\} data-testid="search-empty-results">/,
            "EmptyResults root must pad with the shared list inset class",
        );
        assert.match(readFileSync(OWNER, "utf8"), /\.poster-list-inset-x \{\s*padding-inline: var\(--list-inset\);/);
    });

    it("liveCountEl footer wrapper reads var(--list-inset), not flush", () => {
        const page = readFileSync(PAGE, "utf8");
        const liveCountBlock = page.match(/\{liveCountEl && \([\s\S]*?\)\}/)?.[0] ?? "";
        assert.ok(liveCountBlock.length > 0, "liveCountEl block not found");
        assert.match(liveCountBlock, /var\(--list-inset\)/, "liveCountEl wrapper must read var(--list-inset)");
    });
});

