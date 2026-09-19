import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../src");
const JOB_DETAIL = join(SRC, "components/jobs/JobDetail.tsx");
const TOP_BAR = join(SRC, "components/layout/TopBar.tsx");
const PAGE = join(SRC, "app/jobs/page.tsx");
const TOGGLE_FILE = join(SRC, "components/jobs/for-you/ForYouToggle.tsx");

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
    it("ForYouToggle is constructed exactly once in the tree (single mount point)", () => {
        const hits: string[] = [];
        for (const file of walk(SRC)) {
            if (file === TOGGLE_FILE) continue;
            const src = readFileSync(file, "utf8");
            const matches = src.match(/<ForYouToggle\b/g);
            if (matches) hits.push(...matches.map(() => file));
        }
        assert.equal(hits.length, 1, `expected exactly one <ForYouToggle construction, found ${hits.length}: ${hits.join(", ")}`);
    });

    it("TopBar renders a topbar-docked-home-view slot ahead of the Filters toggle", () => {
        const src = readFileSync(TOP_BAR, "utf8");
        const bandRow = src.match(/data-region="band"[\s\S]*?topbar-docked-filters-toggle/)?.[0] ?? "";
        assert.match(bandRow, /data-testid="topbar-docked-home-view"/, "home-view slot must precede the Filters toggle in the band row");
    });

    it("page.tsx wires a docked mount for topbar-docked-home-view and portals the same toggle element there", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(
            src,
            /useDockedSlotMount\(homeViewDockActive, "topbar-docked-home-view"\)/,
            "the toggle's slot must be wired through the shared useDockedSlotMount hook, not a bespoke effect",
        );
        assert.match(src, /createPortal\(homeViewToggleEl, dockedHomeViewMount\)/);
        assert.match(src, /!homeViewDockActive && showHomeViewToggle/, "the same toggle must also render inline when not docked (mobile / below lg)");

        const hookSrc = readFileSync(join(SRC, "hooks/use-docked-slot-mount.ts"), "utf8");
        assert.match(
            hookSrc,
            /document\.querySelector\(`\[data-testid="\$\{testId\}"\]`\)/,
            "the shared hook must actually look up the slot by the testId it was given",
        );
    });

    /**
     * The toggle must dock independently of the search-only `headerDockActive`
     * gate — that flag is false for the whole For-you view and for
     * "Search, no query yet" (see its own definition in page.tsx), both of
     * which still need the toggle in its one fixed header slot. Reusing
     * `headerDockActive` for the toggle was the exact bug this guards
     * against: it made the toggle jump between an inline and a docked
     * position depending on which of those states was active.
     */
    it("the toggle's dock gate is independent of headerDockActive (the search-only dock)", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(
            src,
            /const homeViewDockActive = isLgUp && showHomeViewToggle;/,
            "homeViewDockActive must not also require showSearchHome/!atRest — it has to be true for the whole For-you view too",
        );
    });
});
