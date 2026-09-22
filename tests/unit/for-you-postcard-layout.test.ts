import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src/components/jobs/for-you");
const PAGE = join(__dirname, "../../src/app/jobs/page.tsx");

function source(name: string): string {
    return readFileSync(join(ROOT, name), "utf8");
}

describe("for-you postcard layout", () => {
    it("ForYouHome frame allows document scroll — no nested viewport trap", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /FOR_YOU_HOME_FRAME_CLASS/);
        assert.doesNotMatch(
            home,
            /overflow-hidden overscroll-none/,
            "For-you frame must not trap page scroll",
        );
        assert.doesNotMatch(
            home,
            /h-\[calc\(100dvh/,
            "100dvh belongs on Search detail panes only, not For-you",
        );
        assert.match(home, /data-testid="for-you-download-apply"/);
        assert.match(home, /data-testid="for-you-skip"/);
        assert.match(home, /data-testid="jobs-replace-resume"/);
    });

    it("jobs page shell uses min-h-screen for For you / pending — not a trapped 100dvh column", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /data-testid="for-you-home-pending"/);
        const page = readFileSync(PAGE, "utf8");
        assert.match(page, /className="min-h-screen"/);
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

    it("ForYouDeck renders only the active pack (no stacked peeking cards, no gesture hijack)", () => {
        const deck = source("ForYouDeck.tsx");
        assert.doesNotMatch(deck, /onTouchStart/);
        assert.doesNotMatch(deck, /onTouchEnd/);
        assert.doesNotMatch(deck, /shouldPackGestureAdvanceDeck/);
        assert.doesNotMatch(deck, /addEventListener\("wheel"/);
        assert.match(deck, /key=\{activePack\.id\}/, "keyed by job id so a new job starts at scrollTop 0");
        assert.doesNotMatch(deck, /flex-1 overflow-hidden/);
        assert.doesNotMatch(deck, /min-h-\[min\(72dvh/, "deck must not mimic a viewport-height trap");
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
        const headerIdx = pack.indexOf("border-b border-border bg-muted");
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
            /data-testid="for-you-pack"[\s\S]*?rounded-panel/,
            "pack root must use rounded-panel",
        );
        assert.match(pack, /flex flex-col gap-4/, "header inner layout must be a column with gap-4");
        assert.match(pack, /break-words/, "title h2 must break long words");
        const headerBlock = pack.match(/border-b border-border bg-muted[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
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

    it("ForYouHome skeleton and empty state use rounded-panel", () => {
        const home = source("ForYouHome.tsx");
        const skeletonBlock = home.match(/function ForYouPackSkeleton[\s\S]*?^}/m)?.[0] ?? "";
        assert.ok(skeletonBlock.length > 0, "ForYouPackSkeleton not found");
        assert.match(
            skeletonBlock,
            /overflow-hidden rounded-panel/,
            "skeleton root must use rounded-panel",
        );
        assert.match(
            home,
            /data-testid="for-you-empty"[\s\S]*?rounded-panel/,
            "empty state must use rounded-panel",
        );
    });
});
