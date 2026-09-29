import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Two company-page defects reported 2026-08-24.
 *
 * 1. The Follow button in the "unlock hiring intel" overlay sat hard left under
 *    a centred heading. `CompanyFollowControl` had `self-start` in its own base
 *    classes — a statement about its position in a parent whose flex direction
 *    it cannot know. In the page header (a row) that means "top"; in the
 *    overlay (a column) it means "left", and it silently beat the overlay's
 *    `items-center`.
 *
 * 2. Opening a company page showed nothing for 2.8–4.4s (measured on prod), so
 *    the app read as frozen. Fixed with a route-level skeleton.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const CONTROL = read("src/components/companies/CompanyFollowControl.tsx");
const GATE = read("src/components/company/CompanyIntelGate.tsx");
const CO_PAGE = read("src/app/co/[slug]/page.tsx");
const CO_LOADING = read("src/app/co/[slug]/loading.tsx");
const ROLE_SEARCH = read("src/components/company/CompanyRoleSearch.tsx");

/** Alignment a component would be asserting about a container it doesn't own. */
const SELF_PLACEMENT = /\b(?:sm:|md:|lg:|xl:|2xl:)?(?:self-(?:start|end|center|stretch)|justify-self-)/;

/** The className of the outermost element a component returns. */
function rootClassName(src: string, label: string): string {
    const m = src.match(/return \(\s*(?:\/\/[^\n]*\n\s*|\{\/\*[\s\S]*?\*\/\}\s*)*<\w+\s+className=\{?cn\("([^"]*)"/);
    assert.ok(m, `${label}: could not read its root className`);
    return m[1];
}

/** The className of the outermost element the file's component returns, tag-agnostic. */
function frameClassName(src: string, label: string): string {
    const m = src.match(/return \(\s*<\w+\b[^>]*?className="([^"]*)"/);
    assert.ok(m, `${label}: could not read the className of its frame element`);
    return m[1];
}

describe("follow control: the parent places it, not the other way round", () => {
    it("states no alignment of its own", () => {
        const root = rootClassName(CONTROL, "CompanyFollowControl");
        assert.doesNotMatch(
            root,
            SELF_PLACEMENT,
            "a self-* class here means the control overrides any container it's dropped into, " +
                "and its meaning flips with that container's flex direction",
        );
        assert.doesNotMatch(
            root,
            /\bitems-/,
            "alignment follows from where the caller puts it, so the caller states it",
        );
    });

    it("its caption doesn't hardcode a text side either", () => {
        // Right-aligned copy only makes sense if the control sits on the right,
        // which is a fact about the parent.
        const caption = CONTROL.match(/data-testid="follow-email-verified"[\s\S]{0,300}?className="([^"]*)"/);
        assert.ok(caption, "the verified-email caption should still be there");
        assert.doesNotMatch(caption[1], /\btext-(?:left|right|center)\b/, "let it inherit from the caller");
    });

    it("every call site says where it wants the control", () => {
        // The case OTHER than the one that surfaced the bug: the two call sites
        // that were RELYING on the removed defaults must now be explicit, or
        // they silently fall back to `stretch`.
        for (const [label, src] of [
            ["company page header", CO_PAGE],
            ["unlock overlay", GATE],
            ["no-open-roles panel", ROLE_SEARCH],
        ] as const) {
            const call = src.match(/<CompanyFollowControl[\s\S]{0,400}?\/>/);
            assert.ok(call, `${label}: no CompanyFollowControl call site found`);
            assert.match(
                call[0],
                /className="[^"]*\bitems-(?:start|end|center)\b/,
                `${label} must state the control's alignment now that the control no longer assumes one`,
            );
        }
    });

    it("the unlock overlay centres, and nothing inside it opts out", () => {
        const overlay = GATE.match(/<div className="absolute inset-0[^"]*"/);
        assert.ok(overlay, "the gate's overlay should still be an absolute cover");
        assert.match(overlay[0], /\bitems-center\b/, "the overlay is the thing that decides centring");
        const overlayBlock = GATE.slice(GATE.indexOf("absolute inset-0"));
        assert.doesNotMatch(overlayBlock, SELF_PLACEMENT, "a child opting out is exactly the bug that was fixed");
    });

    it("the placement probe can actually detect placement", () => {
        // Without this the assertions above would pass on any string at all.
        assert.match("flex shrink-0 flex-col items-end gap-2 self-start", SELF_PLACEMENT);
        assert.match("shrink-0 sm:self-start", SELF_PLACEMENT);
        assert.doesNotMatch("flex shrink-0 flex-col gap-2", SELF_PLACEMENT);
    });
});

describe("company page: the wait is shown, and shaped like the page", () => {
    it("the route has an instant loading state", () => {
        assert.match(CO_LOADING, /export default function \w+\(/, "loading.tsx must default-export a component");
        assert.match(CO_LOADING, /<WaitState[\s\S]*skeleton=\{/, "a page-shaped skeleton on the shared wait ladder, not a spinner");
    });

    it("the skeleton reserves the same frame as the real page", () => {
        // A skeleton whose container differs from the page's makes the content
        // jump on arrival, which is worse than no skeleton at all.
        assert.equal(
            frameClassName(CO_LOADING, "loading.tsx"),
            frameClassName(CO_PAGE, "page.tsx"),
            "the skeleton's frame must use the page's own gutters and max-width",
        );
    });

    it("the logo placeholder is the size the real logo will be", () => {
        // CompanyLogo `lg` is h-14 w-14; the same pinning is already documented
        // on its `md` size against the job-card skeleton.
        const logoSize = read("src/components/jobs/CompanyLogo.tsx").match(/lg:\s*"(h-\d+ w-\d+)/);
        assert.ok(logoSize, "could not read CompanyLogo's lg size");
        assert.match(
            CO_LOADING,
            new RegExp(`<WaitBar className="${logoSize[1]}\\b`),
            `the skeleton's logo slot must be ${logoSize[1]}, or the header shifts when the real logo lands`,
        );
    });

    it("announces itself to a screen reader without reading out the bars", () => {
        // WaitState owns both: role="status" + an sr-only label, and an aria-hidden skeleton wrapper.
        assert.match(CO_LOADING, /<WaitState\s+label="[^"]+"/, "a loading state should be announced");
        const primitive = read("src/components/ui/wait-state.tsx");
        assert.match(primitive, /role="status"/);
        assert.match(primitive, /<div aria-hidden className=\{view\.skeleton/, "the decorative bars should not be");
    });
});
