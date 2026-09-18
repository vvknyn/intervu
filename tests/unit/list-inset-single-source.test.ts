import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src");
const OWNER = join(ROOT, "app/globals.css");
const PAGE = join(ROOT, "app/jobs/page.tsx");
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
});
