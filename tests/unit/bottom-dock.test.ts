import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The phone dock (J-MOB-30/31): every bar pinned to the bottom of a phone
 * screen is one floating glass capsule, `dock-capsule` (globals.css), stacked
 * from the bottom edge by `--mobile-bottom-gap` / `--dock-above-tabbar`.
 *
 * Written against the RULE, not against the two bars that broke (2026-11-01:
 * the Apply bar was a flush, near-opaque band across the page, the tab bar a
 * dark slab, each with its own offset). A fixed or sticky bottom bar added
 * tomorrow fails here until it is a dock capsule or is named below as a
 * floating notice.
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const GLOBALS = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
    });

const utilityBlock = (name: string): string => CSS.match(new RegExp(`@utility ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

/** Class strings in a file: every string literal that holds a `fixed`/`sticky` word and a `bottom-` utility. */
export function pinnedBottomClassStrings(source: string, fileName = "x.tsx"): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            const lit = node.text;
            if (/(^|\s)(?:[a-z-]+:)*(?:fixed|sticky)(\s|$)/.test(lit) && /(^|\s)(?:[a-z-]+:)*-?bottom-/.test(lit)) found.push(lit);
        }
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    return found;
}

/**
 * Pinned bottom elements that are NOT bars, with the reason. Notices and
 * toasts are floating cards that sit ABOVE the dock (they must read
 * `--mobile-tabbar-h`, asserted below). Modal sheets and dialogs paint over the
 * dock and are anchored by Radix, not by a fixed class in one literal.
 */
const NOT_A_BAR: Record<string, string> = {
    "src/lib/toast.tsx": "toast stack, above the dock",
    "src/components/layout/PlanEndingNotice.tsx": "floating notice, above the dock",
    "src/components/layout/LandingNotice.tsx": "floating notice, above the dock",
    "src/components/jobs/ApplyReturnPrompt.tsx": "floating card, above the dock",
};
const MUST_CLEAR_THE_DOCK = ["src/lib/toast.tsx", "src/components/layout/PlanEndingNotice.tsx", "src/components/layout/LandingNotice.tsx", "src/components/jobs/ApplyReturnPrompt.tsx"];

test("every fixed or sticky bottom element is a dock capsule or a named non-bar", () => {
    const offenders: string[] = [];
    const bars: string[] = [];
    for (const file of walk(SRC)) {
        const rel = path.relative(ROOT, file);
        for (const lit of pinnedBottomClassStrings(readFileSync(file, "utf8"))) {
            if (/\bdock-capsule\b/.test(lit) || /\bmax-lg:dock-capsule\b/.test(lit)) bars.push(rel);
            else if (!(rel in NOT_A_BAR)) offenders.push(`${rel}: "${lit.slice(0, 110)}"`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `A bar pinned to the bottom of the screen must use the \`dock-capsule\` utility (globals.css) and stack with \`bottom-[var(--mobile-bottom-gap)]\` / \`bottom-[var(--dock-above-tabbar)]\`. If it is a floating notice or a modal, name it in NOT_A_BAR with the reason.`,
    );
    assert.deepEqual([...new Set(bars)].sort(), ["src/components/jobs/JobDetail.tsx", "src/components/layout/MobileTabBar.tsx"], "the dock's bars");
});

test("the named non-bars are still pinned bottom elements, and the notices clear the dock", () => {
    for (const [rel] of Object.entries(NOT_A_BAR)) {
        const found = pinnedBottomClassStrings(readFileSync(path.join(ROOT, rel), "utf8"));
        assert.ok(found.length > 0, `${rel} no longer pins anything to the bottom: drop it from NOT_A_BAR`);
    }
    for (const rel of MUST_CLEAR_THE_DOCK) {
        const src = readFileSync(path.join(ROOT, rel), "utf8");
        assert.match(src, /--mobile-tabbar-h/, `${rel} must sit above the dock (read --mobile-tabbar-h)`);
    }
});

test("dock-capsule is the one frame: glass, pill radius, viewport-relative width, centred", () => {
    const util = utilityBlock("dock-capsule");
    assert.ok(util, "@utility dock-capsule missing from globals.css");
    assert.match(util, /@apply material-float;/, "the capsule's paint is the one glass recipe");
    assert.match(util, /border-radius:\s*var\(--radius-pill\)/, "a capsule is fully rounded");
    assert.match(util, /width:\s*min\(28rem,\s*calc\(100vw - 2rem\)\)/, "inset 16px from both screen sides, read from the viewport so a sticky bar in a padded column matches a fixed one");
    assert.match(util, /max-width:\s*100%/, "never wider than a narrow parent");
    assert.match(util, /margin-inline:\s*auto/, "centred");
});

test("the dock stacks from tokens, never from a bar's own offset", () => {
    assert.match(CSS, /--dock-above-tabbar:\s*var\(--mobile-bottom-gap\)/, "no tab bar: the next capsule sits at the bottom gap");
    assert.match(
        CSS,
        /html:has\(\[data-mobile-tabbar\]\)\s*\{[^}]*--dock-above-tabbar:\s*calc\(var\(--mobile-bottom-gap\) \+ var\(--dock-bar-h\) \+ var\(--dock-air\)\)/,
        "with a tab bar: above its capsule",
    );
    const tabBar = readFileSync(path.join(SRC, "components/layout/MobileTabBar.tsx"), "utf8");
    assert.match(tabBar, /dock-capsule[^"]*bottom-\[var\(--mobile-bottom-gap\)\]/, "the tab bar is the lowest capsule");
    assert.doesNotMatch(tabBar, /material-(float|bar)/, "the tab bar paints through dock-capsule only");
    const doc = readFileSync(path.join(SRC, "components/jobs/JobDetailDocument.tsx"), "utf8");
    assert.match(doc, /max-lg:bottom-\[var\(--dock-above-tabbar\)\]/, "the job page's Apply bar stacks on the token");
    assert.doesNotMatch(doc, /bottom-\[calc\(var\(--mobile-bottom-gap\)/, "no hand-written offset above the tab bar");
    const bar = readFileSync(path.join(SRC, "components/jobs/JobDetail.tsx"), "utf8");
    const base = bar.slice(bar.indexOf('data-testid="job-detail-action-bar"'), bar.indexOf('data-testid="job-detail-action-bar"') + 900);
    assert.match(base, /max-lg:dock-capsule/, "the Apply bar is a dock capsule on a phone");
    assert.match(base, /max-lg:bottom-\[var\(--mobile-bottom-gap\)\]/, "alone (the job sheet) it sits at the bottom gap");
    assert.match(base, /lg:material-bar/, "from lg it is the split pane's flat bar");
});
