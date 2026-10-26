import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { CHIP_SCROLL_ROW } from "../../src/components/ui/chip";

/**
 * TEST GROUP: CHIP-SCROLL-ROW. The primitive every applied-chip row uses must
 * stay one nowrap line that scrolls, with hit-area room; and nothing inside a
 * consumer may re-introduce wrapping. Each assertion maps to a regression the
 * e2e spec (jobs-chip-row.spec.ts) catches too, but this one runs every time.
 */
const SRC = path.join(process.cwd(), "src");
const tsx = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? tsx(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : [],
    );

/** Source of every JSX element whose opening tag mentions CHIP_SCROLL_ROW (parsed, not line-guessed). */
function consumerRegions(file: string): string[] {
    const text = readFileSync(file, "utf8");
    if (!text.includes("CHIP_SCROLL_ROW")) return [];
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
        if (ts.isJsxElement(n) && n.openingElement.getText().includes("CHIP_SCROLL_ROW")) out.push(n.getText());
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

describe("CHIP_SCROLL_ROW", () => {
    it("is nowrap, scrolls sideways, fades its edge and reserves hit-area room", () => {
        for (const [what, re] of [
            ["flex-nowrap", /(^|\s)flex-nowrap(\s|$)/],
            ["overflow-x-auto", /(^|\s)overflow-x-auto(\s|$)/],
            ["the edge-fade mask", /\[mask-image:linear-gradient\(/],
            ["scroll-hit (the coarse-pointer tap band, padding and equal negative margin so the row keeps its height)", /(^|\s)scroll-hit(\s|$)/],
        ] as const) assert.match(CHIP_SCROLL_ROW, re, `CHIP_SCROLL_ROW lost ${what}`);
        assert.doesNotMatch(CHIP_SCROLL_ROW, /(^|\s)flex-wrap(\s|$)/);
    });

    it("no chip group inside any consumer wraps", () => {
        const consumers = tsx(SRC).flatMap((f) => consumerRegions(f).map((r) => ({ f: path.relative(SRC, f), r })));
        // If this stops finding both known consumers the scan went blind and the loop below is vacuous.
        assert.ok(consumers.length >= 2, `expected the TopBar and JobsContent rows, found ${consumers.length}`);
        assert.ok(consumers.some((c) => c.f.endsWith("TopBar.tsx")) && consumers.some((c) => c.f.endsWith("JobsContent.tsx")));
        for (const { f, r } of consumers) {
            assert.doesNotMatch(r.replace(/\/\*[\s\S]*?\*\//g, ""), /(^|[\s"'`:])flex-wrap(?=[\s"'`])/, `${f}: a descendant of a CHIP_SCROLL_ROW row adds flex-wrap`);
        }
    });
});
