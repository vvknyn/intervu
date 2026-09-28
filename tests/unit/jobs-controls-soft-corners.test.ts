import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../src");
const JOB_DETAIL = join(SRC, "components/jobs/JobDetail.tsx");
const TOP_BAR = join(SRC, "components/layout/TopBar.tsx");
const GLOBALS = join(SRC, "app/globals.css");
function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
}

const ROUNDED_NONE_KEEP_MARKER = /rounded-none:\s*KEEP\s*—/;

/**
 * Every physical line containing `rounded-none` needs the KEEP marker
 * either on itself or somewhere in the contiguous run of `//` comment lines
 * immediately above it. Returns "<line>: <text>" for each occurrence that
 * has no marker in reach, pure and file-content-only so it's testable
 * without touching disk.
 */
function findUnjustifiedRoundedNone(src: string): string[] {
    const lines = src.split("\n");
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("rounded-none")) continue;
        if (ROUNDED_NONE_KEEP_MARKER.test(lines[i])) continue;
        let justified = false;
        for (let j = i - 1; j >= 0 && lines[j].trim().startsWith("//"); j--) {
            if (ROUNDED_NONE_KEEP_MARKER.test(lines[j])) {
                justified = true;
                break;
            }
        }
        if (!justified) violations.push(`${i + 1}: ${lines[i].trim()}`);
    }
    return violations;
}

describe("jobs sheet action-bar soft corners", () => {
    it("JobDetailActionBar's Apply button reads rounded-ctl, not rounded-none", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        const applyBlock = src.match(/<Button className="[^"]*" onClick=\{onOpenPosting\}>/)?.[0] ?? "";
        assert.ok(applyBlock.length > 0, "Apply Button element not found");
        assert.match(applyBlock, /rounded-ctl/, "Apply button must use rounded-ctl");
        assert.doesNotMatch(applyBlock, /rounded-none/, "Apply button must not carry rounded-none");
    });

    /**
     * Class-wide guard, not scoped to any one control or class combination:
     * every `rounded-none` under src/app/jobs or src/components/jobs must
     * carry a `rounded-none: KEEP — <reason>` marker, either on its own line
     * or in the `//` comment block directly above it (comments wrap across
     * multiple lines, so "directly above" means the whole contiguous run,
     * not just the one physical line touching the code). An unmarked
     * `rounded-none` fails, listing every offending file:line. Supersedes
     * the old bg-brand-only pairing check, which only caught a brand-filled
     * control left square — any other unannotated control (input, chip,
     * secondary button) slipped through it silently.
     */
    it("every rounded-none under src/app/jobs and src/components/jobs carries a KEEP marker", () => {
        const roots = [join(SRC, "app/jobs"), join(SRC, "components/jobs")];
        const failures: string[] = [];
        for (const root of roots) {
            for (const file of walk(root)) {
                for (const hit of findUnjustifiedRoundedNone(readFileSync(file, "utf8"))) {
                    failures.push(`${file}:${hit}`);
                }
            }
        }
        assert.deepEqual(failures, [], `unjustified rounded-none (no KEEP marker):\n${failures.join("\n")}`);
    });
});

describe("For-you/Search toggle — one mount, one shape", () => {
    it("ForYouToggle mounts once, on the jobs bottom bar", () => {
        const hits: string[] = [];
        for (const file of walk(SRC)) {
            const src = readFileSync(file, "utf8");
            if (src.includes("<ForYouToggle")) hits.push(file);
        }
        assert.deepEqual(hits, [join(SRC, "app/jobs/JobsContent.tsx")]);
        const jobs = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        assert.match(jobs, /data-testid="jobs-home-switch-bar"[\s\S]*<ForYouToggle/);
        const toggle = readFileSync(join(SRC, "components/jobs/for-you/ForYouToggle.tsx"), "utf8");
        assert.match(toggle, /"For you"/);
        assert.match(toggle, /"Search"/);
    });

    it("TopBar renders a topbar-docked-home-view slot ahead of the Filters toggle", () => {
        const src = readFileSync(TOP_BAR, "utf8");
        const bandRow = src.match(/data-region="band"[\s\S]*?topbar-docked-filters-toggle/)?.[0] ?? "";
        assert.match(bandRow, /data-testid="topbar-docked-home-view"/, "home-view slot must precede the Filters toggle in the band row");
    });

    it("JobsContent puts one For you ↔ Search switch on the bottom bar at every width", () => {
        const src = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        assert.match(src, /data-testid="jobs-home-switch-bar"/);
        assert.match(src, /lg:bottom-0/);
        assert.match(src, /bottom-\[calc\(var\(--mobile-tabbar-h,56px\)\+env\(safe-area-inset-bottom,0px\)\)\]/);
        assert.equal((src.match(/<ForYouToggle\b/g) ?? []).length, 1);
        assert.doesNotMatch(src, /JOBS_TAB_HELPER/);
    });

    it("TopBar band row clears the For you/Search pill via --jobs-filter-row-h", () => {
        const topBar = readFileSync(TOP_BAR, "utf8");
        const bandRow =
            topBar.match(/data-region="band"[\s\S]*?<div className="shell-row[^"]*"/)?.[0] ?? "";
        assert.ok(bandRow.length > 0, "band row not found");
        assert.match(
            bandRow,
            /min-h-\[var\(--jobs-filter-row-h\)\]/,
            "band row must use the filter-row token for min-height",
        );
        assert.doesNotMatch(bandRow, /\bh-10\b/, "band row must not use a fixed h-10");

        const globals = readFileSync(GLOBALS, "utf8");
        assert.match(
            globals,
            /--jobs-filter-row-h:\s*calc\(2\.75rem \+ 1rem\)/,
            "filter row token must clear min-h-11 pill plus padding",
        );
    });

    it("the bottom-bar switch is not gated on the search-only header dock", () => {
        const src = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        const bar = src.match(/data-testid="jobs-home-switch-bar"[\s\S]*?<\/div>/)?.[0] ?? "";
        assert.ok(bar.length > 0, "switch bar not found");
        assert.doesNotMatch(bar, /headerDockActive/);
        assert.match(src, /\{showHomeViewToggle && \([\s\S]*data-testid="jobs-home-switch-bar"/);
    });
});
