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
        // 11429940 put `size={jobActionSize}` ahead of className on every job action.
        const applyBlock = src.match(/<Button size=\{jobActionSize\} className="[^"]*" onClick=\{onOpenPosting\}>/)?.[0] ?? "";
        assert.ok(applyBlock.length > 0, "Apply Button element not found");
        // The control corner comes from the Button face (`.ctl-button` paints
        // rounded-ctl, 2026-09-29), so the call site names no corner at all —
        // tests/unit/control-type.test.ts fails one that does.
        assert.doesNotMatch(applyBlock, /\brounded(?:-[\w-]+)?\b/, "Apply button must take its corner from the Button face");
        assert.match(readFileSync(join(SRC, "components/ui/button.tsx"), "utf8"), /"ctl-button /, "the Button primitive paints the face");
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

describe("For-you/Search toggle — one mount, header row", () => {
    it("ForYouToggle mounts once, portaled into the header slot", () => {
        const hits: string[] = [];
        for (const file of walk(SRC)) {
            const src = readFileSync(file, "utf8");
            if (src.includes("<ForYouToggle")) hits.push(file);
        }
        assert.deepEqual(hits, [join(SRC, "app/jobs/JobsContent.tsx")]);
        const jobs = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        assert.match(jobs, /dockedHomeViewMount &&[\s\S]*createPortal\([\s\S]*<ForYouToggle/);
        const toggle = readFileSync(join(SRC, "components/jobs/for-you/ForYouToggle.tsx"), "utf8");
        assert.match(toggle, /"For you"/);
        assert.match(toggle, /"Search"/);
    });

    it("TopBar puts the home-view slot on the header row beside the mark, not the filter band", () => {
        const src = readFileSync(TOP_BAR, "utf8");
        const header = src.match(/data-region="header"[\s\S]*?data-region="band"/)?.[0] ?? "";
        assert.match(header, /data-testid="topbar-logo"/);
        assert.match(header, /data-testid="topbar-docked-home-view"/);
        assert.ok(
            header.indexOf('data-testid="topbar-logo"') < header.indexOf('data-testid="topbar-docked-home-view"'),
            "home-view slot follows the mark on the header row",
        );
        const band = src.slice(src.indexOf('data-region="band"'));
        assert.doesNotMatch(band, /topbar-docked-home-view/);
        assert.doesNotMatch(src, /docked \|\| homeViewDocked/);
    });

    it("JobsContent docks one For you ↔ Search switch and does not keep a bottom bar", () => {
        const src = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        assert.match(src, /const homeViewDockActive = showHomeViewToggle/);
        assert.doesNotMatch(src, /data-testid="jobs-home-switch-bar"/);
        assert.doesNotMatch(src, /lg:bottom-0/);
        assert.equal((src.match(/<ForYouToggle\b/g) ?? []).length, 1);
        assert.doesNotMatch(src, /JOBS_TAB_HELPER/);
    });

    it("TopBar filter band keeps --jobs-filter-row-h and does not host the switch", () => {
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
        assert.doesNotMatch(bandRow, /topbar-docked-home-view/);

        const globals = readFileSync(GLOBALS, "utf8");
        assert.match(
            globals,
            /--jobs-filter-row-h:\s*calc\(2\.75rem \+ 1rem\)/,
            "filter row token must clear min-h-11 controls plus padding",
        );
    });

    it("the header switch is not gated on the search-only header dock", () => {
        const src = readFileSync(join(SRC, "app/jobs/JobsContent.tsx"), "utf8");
        assert.match(src, /const homeViewDockActive = showHomeViewToggle/);
        assert.match(src, /\{showHomeViewToggle && dockedHomeViewMount &&[\s\S]*<ForYouToggle/);
        assert.doesNotMatch(src, /homeViewDockActive = headerDockActive/);
        assert.doesNotMatch(src, /homeViewDockActive = false/);
    });
});
