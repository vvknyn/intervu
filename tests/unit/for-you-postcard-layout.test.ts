import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src/components/jobs/for-you");
const PAGE = join(__dirname, "../../src/app/jobs/JobsContent.tsx");

function source(name: string): string {
    return readFileSync(join(ROOT, name), "utf8");
}

describe("for-you postcard layout", () => {
    it("ForYouHome stack fills the screen from a floor — each role card scrolls inside itself, the page scrolls past a short screen", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /FOR_YOU_HOME_FRAME_CLASS/);
        assert.match(home, /<RoleStack[\s\S]*className="flex-1"/, "the stack takes the space left");
        const css = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");
        const stage = css.match(/\.role-stack-stage \{[^}]*\}/)?.[0] ?? "";
        assert.match(
            home,
            /<div className="role-stack-screen">\s*\{thinBlock\}\s*(?:\{tuning \?[\s\S]*?\) : null\}\s*)?<RoleStack/,
            "the stack shares the screen under the pack's header row with a thin pack's broaden options",
        );
        const screen = css.match(/\.role-stack-screen \{[^}]*\}/)?.[0] ?? "";
        assert.match(
            screen,
            /min-height: calc\(\s*100svh - var\(--topbar-h\) - 3\.5rem - var\(--mobile-tabbar-h\)/,
            "the screen under the header row, down to the phone tab bar, not what the page leaves over",
        );
        assert.match(stage, /min-height: min\(\s*30rem,/, "never squeezed below a usable card (a sign-up card or header scrolls the page instead)");
        assert.doesNotMatch(css, /body:has\(\[data-testid="for-you-home"\]\)\s*\{[^}]*overflow: hidden/, "the pack page is not locked to the viewport");
        assert.match(stage, /var\(--mobile-tabbar-h\) - env\(safe-area-inset-bottom/, "the floor leaves room for the phone tab bar and the home indicator");
        assert.match(home, /\}, \[hasRoles\]\);/, "the fit restarts when a pack's roles arrive, not on every change in their number");
        assert.match(home, /querySelector\("\[data-mobile-tabbar\]"\)/, "opening a pack fits the stack above the tab bar as measured (its height var is set on body, not :root)");
        assert.match(home, /room < 0 \? room :/, "a page left scrolled past the stack scrolls back up to the Previous/Next bar");
        assert.match(home, /addEventListener\("scroll", fit/, "a scroll the router makes after the first fit refits");
        assert.match(css, /@media \(max-height: 30rem\)[^{]*\{\s*\.role-card-actions \{\s*flex-flow: row wrap;/, "a phone on its side puts the card's actions on one row");
        assert.doesNotMatch(home, /for-you-list-scroll|for-you-back-to-list|deckWindowRange/, "no ranked list beside the stack");
        const card = source("StackedRoleCard.tsx");
        assert.match(card, /flex-col overflow-y-auto"/, "a phone card is one scroll");
        assert.doesNotMatch(card, /overscroll-contain/, "at its end a card's scroll carries on to the page");
        assert.match(card, /lg:grid-cols-\[minmax\(0,26rem\)_minmax\(0,1fr\)\]/, "desktop: inferred left, posting right");
        assert.match(card, /sticky bottom-0[^"]*lg:static/, "actions stay pinned on a phone, sit under the left column on desktop");
        assert.doesNotMatch(
            home,
            /overflow-hidden overscroll-none/,
            "For-you frame must not use the old page-scroll trap",
        );
        assert.doesNotMatch(
            home,
            /h-\[calc\(100dvh/,
            "100dvh belongs on Search detail panes only, not For-you",
        );
        assert.match(home, /"for-you-download-apply"/);
        assert.match(home, /"for-you-skip"/);
        assert.match(home, /data-testid="jobs-replace-resume"/);
    });

    it("jobs page shell uses min-h-screen for For you / pending — not a trapped 100dvh column", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /data-testid="for-you-home-pending"/);
        const page = readFileSync(PAGE, "utf8");
        // 7d3ecc07: only an open pack deck locks the panes (its list scrolls in
        // its own column); the For-you home and pending state keep min-h-screen.
        // `forYouOpen` is For you shown to a signed-in visitor (a guest gets its gate card).
        assert.match(page, /: "min-h-screen"/);
        assert.match(page, /const deckPanesLocked = forYouOpen && \(showAdvancedSearch \|\| forYouPackDeckOpen\);/);
        assert.doesNotMatch(
            page,
            /showSearchHome[\s\S]*100dvh-var\(--topbar-h\)/,
            "For-you must not reuse Search's trapped viewport shell",
        );
        assert.match(page, /showJobsHomePending/);
        assert.match(page, /ForYouHomePending/);
        assert.match(page, /headerDockActive = isLgUp && showSearchHome/);
        assert.match(
            page,
            /showJobsToolbarSection && showSearchHome/,
            "Search toolbar must not mount while presence is pending",
        );
    });

    it("ForYouDeck renders one resting pack — swipe allowed, no wheel hijack or permanent stacked peek", () => {
        const deck = source("ForYouDeck.tsx");
        assert.match(deck, /resolveDeckSwipe/);
        assert.match(deck, /touch-pan-y/);
        assert.match(deck, /onTouchStart/);
        assert.match(deck, /onTouchEnd/);
        assert.match(deck, /computeDeckDragOffset/);
        assert.match(deck, /onAnimationEnd/);
        assert.match(deck, /shouldActivateDeckHorizontalDrag/);
        assert.doesNotMatch(deck, /shouldPackGestureAdvanceDeck/);
        assert.doesNotMatch(deck, /addEventListener\("wheel"/);
        assert.match(deck, /key=\{pack\.id\}/, "pack slots keyed by job id");
        assert.match(deck, /showCross/, "dual-card render is commit-only, not a resting stack");
        assert.doesNotMatch(deck, /flex-1 overflow-hidden/);
        assert.match(deck, /for-you-deck-shell/, "named deck shell min-height prevents commit-time CLS");
    });

    it("JD column only is the inner scroller — header and fit/why stay outside data-pack-scroll", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /data-pack-scroll/);
        assert.match(pack, /JD_SCROLL_CLASS[\s\S]*overflow-y-auto[\s\S]*max-h-\[min\(60dvh,640px\)\]/);
        assert.match(pack, /data-pack-scroll className=\{JD_SCROLL_CLASS\}/);
        assert.doesNotMatch(pack, /overscroll-contain/);
        assert.doesNotMatch(pack, /data-pack-scroll[\s\S]*sticky top-0/, "header must not live inside the JD scroller");
        assert.match(
            pack,
            /lg:grid-cols-\[280px_1fr\]/,
            "desktop: fit/why column left, JD column right",
        );
        const scrollIdx = pack.indexOf("data-pack-scroll");
        const asideIdx = pack.indexOf("<aside");
        const headerIdx = pack.indexOf("POSTCARD_HEADER_DIVIDER");
        assert.ok(headerIdx < scrollIdx, "pack header must render before the JD scroller");
        assert.ok(asideIdx < scrollIdx, "fit/why aside must render before the JD scroller");
        assert.doesNotMatch(pack, /max-h-\[40%\]/);
        assert.doesNotMatch(pack, /data-pack-meta-scroll/);
        assert.doesNotMatch(pack, /lg:min-h-\[420px\]/);
    });

    it("ForYouPack uses rounded-panel and keeps chips below the identity+FIT block", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(
            pack,
            /export const POSTCARD_SHELL[\s\S]*?rounded-panel/,
            "POSTCARD_SHELL must include rounded-panel",
        );
        assert.match(
            pack,
            /className=\{cn\(POSTCARD_SHELL, className\)\}/,
            "pack root must compose POSTCARD_SHELL",
        );
        assert.match(pack, /flex flex-col gap-4/, "header inner layout must be a column with gap-4");
        assert.match(pack, /break-words/, "title h2 must break long words");
        const headerBlock = pack.match(/POSTCARD_HEADER_DIVIDER[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
        assert.ok(headerBlock.length > 0, "pack header block not found");
        const identityRow = headerBlock.match(/<div className="flex items-start gap-3">[\s\S]*?<\/div>/)?.[0] ?? "";
        assert.ok(identityRow.length > 0, "identity row not found");
        assert.doesNotMatch(
            identityRow,
            /flex-wrap/,
            "identity row must not wrap FIT into the chip row",
        );
        assert.match(headerBlock, /flex flex-wrap gap-2/, "chip row still wraps chips");
    });

    it("ForYouPack header and body grid share lg:px-8 horizontal inset on desktop", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(
            pack,
            /POSTCARD_HEADER_DIVIDER/,
            "pack header must use shared postcard divider + px-4 lg:px-8",
        );
        assert.match(pack, /POSTCARD_ON_CREAM_BORDER/, "pack exports cream-paper border token");
        assert.match(
            pack,
            /grid gap-6 py-4 px-4 lg:py-6 lg:px-8/,
            "pack body grid must use px-4 lg:px-8",
        );
    });

    it("ForYouHome skeleton and empty state use rounded-panel", () => {
        const home = source("ForYouHome.tsx");
        const skeletonBlock = readFileSync(
            join(__dirname, "../../src/components/layout/jobs-session-loading.tsx"),
            "utf8",
        );
        assert.match(skeletonBlock, /ForYouDeckSkeleton/);
        assert.match(
            skeletonBlock,
            /for-you-deck-paper-postcard/,
            "skeleton paper slot must use postcard shell class",
        );
        assert.match(
            skeletonBlock,
            /border-b border-border py-4 px-4 lg:py-6 lg:px-8/,
            "skeleton header must match pack horizontal inset",
        );
        assert.match(
            source("ForYouPack.tsx"),
            /POSTCARD_HEADER_DIVIDER/,
            "live pack header must use postcard divider token",
        );
        assert.match(
            skeletonBlock,
            /grid gap-6 py-4 px-4 lg:grid-cols-\[280px_1fr\] lg:py-6 lg:px-8/,
            "skeleton body grid must match pack horizontal inset",
        );
        assert.match(
            home,
            /ConceptAEmptyState[\s\S]*for-you-empty/,
            "empty state must use shared Concept A empty",
        );
    });

    it("JD body uses the shared on-device template chrome (emoji section labels)", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /useAiJobDescription/);
        assert.match(pack, /JD_TEMPLATE_LABELS/);
        assert.match(pack, /JD_TEMPLATE_ORDER/);
        assert.match(pack, /data-testid="for-you-jd-template"/);
        assert.doesNotMatch(
            pack,
            /<h4 className=\{cn\(SECTION_LABEL, "mb-2"\)\}>About<\/h4>/,
            "legacy About/Responsibilities/Requirements labels must yield to the shared template",
        );
    });

    it("soft-fails thin JD templates to title/company/apply/snippet — never empty ✨ The role", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /jdTemplateIsThin/);
        assert.match(pack, /jdSearchIndexSnippet/);
        assert.match(pack, /data-testid="for-you-jd-soft-fail"/);
        assert.match(pack, /data-testid="for-you-jd-apply-link"/);
        assert.match(pack, /Apply at/);
    });

    it("falls back to scrollable full formatted body when source is rich but template is thin", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /descriptionNeedsFill/);
        assert.match(pack, /formatDescription/);
        assert.match(pack, /data-testid="for-you-jd-full-body"/);
        assert.match(pack, /for-you-jd-soft-fail/);
    });

});
