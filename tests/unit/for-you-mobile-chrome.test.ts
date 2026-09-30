import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOR_YOU = join(__dirname, "../../src/components/jobs/for-you");
const JOBS = join(__dirname, "../../src/components/jobs");
const RESUME = join(__dirname, "../../src/components/resume-builder");
const COMPANY = join(__dirname, "../../src/components/company");

/**
 * Tap targets: the 44px touch floor is the coarse-pointer hit area every control
 * gets (globals.css, gated by tests/unit/control-scale.test.ts), so these
 * assert a control-scale `size` step shared by the row, never a hand-rolled
 * `min-h-11` visual. A button sits on the md step (no `size`, the default): the
 * 44px step is for fields and the /jobs Search submit only (2026-09-29,
 * tests/unit/control-type.test.ts).
 */
function buttonBlock(src: string, testid: string): string {
    // The JSX attribute, not a selector string: `data-testid="x"`, or `data-testid={active ? "x" : undefined}`
    // on a card that only wires its controls while it is the open role.
    const at = src.search(new RegExp(`\\sdata-testid=(?:"${testid}"|\\{[^}]*"${testid}")`));
    assert.ok(at >= 0, `${testid} must exist`);
    return src.slice(src.lastIndexOf("<Button", at), src.indexOf("</Button>", at));
}
const sizesOf = (src: string, ...testids: string[]) =>
    testids.map((id) => {
        assert.doesNotMatch(buttonBlock(src, id), /\bmin-h-|\bh-\d/, `${id} must not hand-roll its height`);
        return /\bsize="([\w-]+)"/.exec(buttonBlock(src, id))?.[1];
    });

describe("for-you mobile chrome", () => {
    it("ForYouHome keeps pack navigation and skip controls at phone-friendly tap targets", () => {
        const src = readFileSync(join(FOR_YOU, "ForYouHome.tsx"), "utf8");
        assert.doesNotMatch(src, /for-you-preferences/, "preference chips are Search-only");
        // One role at a time (stacked role cards): Previous / Next move through the pack, Skip drops a role.
        assert.match(src, /<RoleStack/);
        assert.match(src, /onSwipe=/, "a phone swipe moves through the stack too");
        assert.deepEqual(
            sizesOf(src, "for-you-download-apply", "for-you-skip", "for-you-previous", "for-you-next"),
            [undefined, undefined, undefined, undefined],
        );
        const stack = readFileSync(join(FOR_YOU, "RoleStack.tsx"), "utf8");
        assert.match(stack, /resolveDeckSwipe/);
        assert.match(stack, /touch-pan-y/, "vertical scroll inside a card stays native");
    });

    it("LocalCustomizePanel dialog and footer actions are phone-friendly", () => {
        const src = readFileSync(join(JOBS, "LocalCustomizePanel.tsx"), "utf8");
        assert.match(src, /<DialogBody[^>]*data-testid="local-customize-panel"/, "body scrolls on the dialog primitive");
        assert.doesNotMatch(src, /max-h-\[\d+dvh\]/, "height cap lives on the primitive, not per site");
        // One footer row, one step.
        assert.deepEqual(
            sizesOf(src, "local-customize-close", "local-customize-copy", "local-customize-pdf"),
            ["sm", "sm", "sm"],
        );
    });

    it("ResumeImportModal shrinks on short phones", () => {
        const src = readFileSync(join(RESUME, "ResumeImportModal.tsx"), "utf8");
        assert.match(src, /<DialogBody\b/, "one scroll region between header and footer");
        assert.doesNotMatch(src, /ScrollArea/, "no nested scroller inside the dialog body");
        assert.doesNotMatch(src, /max-h-\[\d+dvh\]/, "height cap lives on the primitive, not per site");
        // The review fields live in the shared form both résumé entry points render.
        assert.match(src, /<ResumeReviewFields\b/);
        assert.match(readFileSync(join(RESUME, "ResumeReviewFields.tsx"), "utf8"), /grid-cols-1[\s\S]*sm:grid-cols-2/);
    });

    it("CompanyRoleSearch title clamps instead of overflowing on narrow viewports", () => {
        const src = readFileSync(join(COMPANY, "CompanyRoleSearch.tsx"), "utf8");
        assert.match(src, /min-w-0 text-base font-semibold/);
        assert.match(src, /line-clamp-2/, "title must clamp rather than overflow unbounded");
    });

    it("ApplyIntentDialog takes its mobile height cap from the primitive", () => {
        const src = readFileSync(join(JOBS, "ApplyIntentDialog.tsx"), "utf8");
        assert.match(src, /<DialogBody\b/);
        assert.doesNotMatch(src, /max-h-\[\d+dvh\]/, "height cap lives on the primitive, not per site");
    });

    it("ApplyIntentDialog uses p-0 shell with explicit px-6 zone padding", () => {
        const src = readFileSync(join(JOBS, "ApplyIntentDialog.tsx"), "utf8");
        assert.match(
            src,
            /DialogContent className="[^"]*\bp-0\b[^"]*"/,
            "DialogContent must override primitive p-6 with p-0",
        );
        assert.match(src, /shrink-0 px-6 pt-6 pr-12/, "header zone must carry px-6");
        assert.match(
            src,
            /<DialogBody className="[^"]*\bpx-6\b/,
            "middle scroller must carry px-6",
        );
        assert.match(
            src,
            /border-t border-border px-6/,
            "footer zone must carry px-6",
        );
    });

    it("ForYouDeck exposes swipe navigate + touch-pan-y for phone deck", () => {
        const src = readFileSync(join(FOR_YOU, "ForYouDeck.tsx"), "utf8");
        assert.match(src, /onSwipeNavigate/);
        assert.match(src, /touch-pan-y/);
        assert.match(src, /resolveDeckSwipe/);
        assert.match(src, /data-testid="for-you-deck"/);
    });

    it("CategoryHubGrid hub is touch-first with safe-area and full-width CTAs", () => {
        const src = readFileSync(join(JOBS, "CategoryHubGrid.tsx"), "utf8");
        assert.match(src, /data-testid="job-packs-hub"/);
        assert.match(src, /safe-area-inset-bottom/);
        assert.match(src, /touch-manipulation/);
        assert.deepEqual(sizesOf(src, "hub-browse-all-matches"), [undefined]);
        // The packs are chips (the control scale's ctl-md step, which grows its hit area on touch) in a row that wraps.
        assert.match(src, /chipVariants\(\{ active: activeCategoryId === category\.id, interactive: true \}\)/);
        assert.match(src, /data-testid="hub-pack-chips" className="flex flex-wrap/);
    });

    it("ApplyReturnPrompt is Yes / Not yet / Skip with thumb-sized targets", () => {
        const src = readFileSync(join(JOBS, "ApplyReturnPrompt.tsx"), "utf8");
        assert.match(src, />\s*Yes\s*</);
        assert.match(src, />\s*Not yet\s*</);
        assert.deepEqual(sizesOf(src, "apply-return-mark-applied", "apply-return-not-yet", "apply-return-skip"), [undefined, undefined, undefined]);
        assert.match(src, /safe-area-inset-bottom/);
        assert.match(src, /aria-live="polite"/);
        assert.doesNotMatch(src, />\s*I applied\s*</);
    });
});
