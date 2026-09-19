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

describe("jobs sheet action-bar soft corners", () => {
    it("JobDetailActionBar's Apply button reads rounded-ctl, not rounded-none", () => {
        const src = readFileSync(JOB_DETAIL, "utf8");
        const applyBlock = src.match(/<Button className="[^"]*" onClick=\{onOpenPosting\}>/)?.[0] ?? "";
        assert.ok(applyBlock.length > 0, "Apply Button element not found");
        assert.match(applyBlock, /rounded-ctl/, "Apply button must use rounded-ctl");
        assert.doesNotMatch(applyBlock, /rounded-none/, "Apply button must not carry rounded-none");
    });

    /**
     * Class-wide guard (not just the one reported Apply button): nothing under
     * src/app/jobs or src/components/jobs may pair a brand-filled CTA
     * (`bg-brand`) with a square corner (`rounded-none`) in the same
     * className string. A future brand button that copies this pattern is
     * caught here instead of shipping another flat corner.
     */
    it("no className string in src/app/jobs or src/components/jobs pairs bg-brand with rounded-none", () => {
        const roots = [join(SRC, "app/jobs"), join(SRC, "components/jobs")];
        for (const root of roots) {
            for (const file of walk(root)) {
                const src = readFileSync(file, "utf8");
                // Every quoted string in the file, not just single-literal
                // `className="..."` — this also catches each individual
                // string argument inside a `cn("a", "b")` call, where the
                // two classes could otherwise hide in different arguments.
                for (const literal of src.match(/"[^"\n]*"/g) ?? []) {
                    if (literal.includes("bg-brand")) {
                        assert.doesNotMatch(
                            literal,
                            /rounded-none/,
                            `${file} pairs bg-brand with rounded-none: ${literal}`,
                        );
                    }
                }
            }
        }
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
        assert.match(src, /setDockedHomeViewMount\(document\.querySelector\('\[data-testid="topbar-docked-home-view"\]'\)/);
        assert.match(src, /createPortal\(homeViewToggleEl, dockedHomeViewMount\)/);
        assert.match(src, /!homeViewDockActive && showHomeViewToggle/, "the same toggle must also render inline when not docked (mobile / below lg)");
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
