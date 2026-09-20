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
    });

    it("keeps the pack ONE native scroller (JD scroll inside the postcard only)", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /data-pack-scroll/);
        assert.match(pack, /data-pack-scroll[\s\S]*overflow-y-auto/);
        assert.doesNotMatch(pack, /max-h-\[40%\]/);
        assert.doesNotMatch(pack, /data-pack-meta-scroll/);
        assert.doesNotMatch(pack, /lg:min-h-\[420px\]/);
    });
});
