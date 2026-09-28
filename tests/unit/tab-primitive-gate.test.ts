import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Gate: segmented controls, pill tabs and count chips are ONE primitive each
 * (`TabNav`/`TabItem`/`TabsTrigger` in ui/tabs.tsx, `SolidBadge`/`CountBadge`
 * in ui/badge.tsx). A new hand-rolled one fails here unless the offending
 * line, or one of the 3 lines above it, carries `tab-kit: KEEP — <reason>`.
 * The match is structural (what the markup does), never a file-name list.
 */

const SRC = join(__dirname, "../../src");
const SCAN_ROOTS = ["components", "app"].map((d) => join(SRC, d));
const KEEP_MARKER = /tab-kit:\s*KEEP\s*—/;
const PILL = /rounded-(pill|full)/;

/** Each rule sees the physical line and a +-8 line window around it. */
const RULES: ReadonlyArray<{ name: string; hit: (line: string, window: string) => boolean }> = [
    { name: "role=tab / role=tablist hand-rolled", hit: (l) => /role=["']tab(list)?["']/.test(l) },
    {
        name: "pill toggle (aria-pressed/checked on a rounded-pill/full control)",
        hit: (l, w) => /aria-(pressed|checked)=/.test(l) && PILL.test(w),
    },
    {
        name: "segmented container (rounded bg-muted p-0.5/p-1 wrapper)",
        hit: (l) =>
            /rounded-(pill|full|ctl|panel)/.test(l) &&
            /(^|[\s"`])bg-muted/.test(l) &&
            /(^|[\s"`])p-(0\.5|1)([\s"`]|$)/.test(l),
    },
    {
        name: "ad-hoc corner count chip (absolute -right/-top + bg-)",
        hit: (l) => /\babsolute\b/.test(l) && /-(right|top)-\d/.test(l) && /\bbg-/.test(l),
    },
    { name: "ad-hoc count pill (rounded-pill/full + min-w-N)", hit: (l) => PILL.test(l) && /\bmin-w-[1-9]/.test(l) },
];

const isCommentOnly = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

/** Pure: "<line>: <rule> — <text>" for every unmarked hit in `src`. */
export function findHandRolledTabs(src: string): string[] {
    const lines = src.split("\n");
    const violations: string[] = [];
    lines.forEach((line, i) => {
        if (isCommentOnly(line)) return;
        const window = lines.slice(Math.max(0, i - 8), i + 9).join("\n");
        const rule = RULES.find((r) => r.hit(line, window));
        if (!rule) return;
        const reach = lines.slice(Math.max(0, i - 3), i + 1);
        if (reach.some((l) => KEEP_MARKER.test(l))) return;
        violations.push(`${i + 1}: ${rule.name} — ${line.trim().slice(0, 100)}`);
    });
    return violations;
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return path.endsWith(".tsx") ? [path] : [];
    });
}

describe("tab/badge primitive gate: detector", () => {
    it("flags a hand-rolled pill toggle", () => {
        const src = [
            "<button",
            "  aria-pressed={on}",
            '  className="rounded-full border px-3 py-1 text-xs"',
            ">x</button>",
        ].join("\n");
        assert.equal(findHandRolledTabs(src).length, 1);
    });

    it("flags a hand-rolled role=tab and a corner count chip", () => {
        assert.equal(findHandRolledTabs('<div role="tablist">').length, 1);
        assert.equal(findHandRolledTabs('<span className="absolute -right-1 -top-1 bg-brand">{n}</span>').length, 1);
    });

    it("flags a segmented container and a min-w count pill", () => {
        assert.equal(findHandRolledTabs('<div className="inline-flex rounded-pill bg-muted p-1">').length, 1);
        assert.equal(findHandRolledTabs('<span className="min-w-5 rounded-full px-1">{n}</span>').length, 1);
    });

    it("passes a same-line or nearby-comment KEEP marker", () => {
        assert.deepEqual(findHandRolledTabs('<div role="tablist"> {/* tab-kit: KEEP — fixture */}'), []);
        assert.deepEqual(findHandRolledTabs(["{/* tab-kit: KEEP — fixture */}", '<div role="tablist">'].join("\n")), []);
        assert.equal(findHandRolledTabs(["{/* tab-kit: KEEP — fixture */}", "a", "b", "c", '<div role="tablist">'].join("\n")).length, 1);
    });

    it("ignores comment-only lines and primitive usage", () => {
        assert.deepEqual(findHandRolledTabs('// role="tab" is documented here'), []);
        assert.deepEqual(findHandRolledTabs("<TabItem aria-pressed={on}>x</TabItem>"), []);
        assert.deepEqual(findHandRolledTabs('<span className="rounded-pill bg-muted px-2 text-xs">status</span>'), []);
    });
});

describe("tab/badge primitive gate: src/components and src/app", () => {
    it("has no unmarked hand-rolled segmented control, pill tab or count chip", () => {
        const offenders = SCAN_ROOTS.flatMap(walk).flatMap((file) =>
            findHandRolledTabs(readFileSync(file, "utf8")).map((v) => `${file.slice(SRC.length - 3)}:${v}`),
        );
        assert.deepEqual(offenders, [], `Use TabNav/TabItem or CountBadge/SolidBadge, or mark with "tab-kit: KEEP — <reason>":\n${offenders.join("\n")}`);
    });
});
