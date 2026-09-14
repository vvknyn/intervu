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
    it("caps For you to leftover viewport space so the pack cannot grow with the JD", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /FOR_YOU_HOME_FRAME_CLASS/);
        assert.match(home, /overflow-hidden overscroll-none/);
        assert.match(home, /data-testid="for-you-download-apply"/);
        assert.doesNotMatch(home, /fixed inset-x-0 bottom-0/);
        assert.match(home, /h-11 min-h-11[\s\S]*data-testid="for-you-download-apply"/);
        assert.match(home, /h-11 min-h-11[\s\S]*data-testid="for-you-skip"/);
        assert.match(home, /data-testid="jobs-replace-resume"/);
        assert.match(home, /onReplaceResume/);
        assert.doesNotMatch(
            home,
            /h-\[calc\(100dvh/,
            "100dvh belongs on the jobs shell, not a second nested calc",
        );
    });

    it("jobs shell is the viewport bound for For you / pending, not Search", () => {
        const home = source("ForYouHome.tsx");
        assert.match(home, /data-testid="for-you-home-pending"/);
        const page = readFileSync(PAGE, "utf8");
        assert.match(page, /100dvh-var\(--topbar-h\)/);
        assert.match(page, /showSearchHome/);
        assert.match(page, /showJobsHomePending/);
        assert.match(page, /ForYouHomePending/);
        assert.match(page, /headerDockActive = isLgUp && showSearchHome/);
        assert.match(
            page,
            /showJobsToolbarSection && showSearchHome/,
            "Search toolbar must not mount while presence is pending",
        );
    });

    it("sizes the deck to leftover flex space with a definite pack frame", () => {
        const deck = source("ForYouDeck.tsx");
        assert.match(deck, /relative min-h-0 flex-1 overflow-hidden pb-6/);
        assert.match(deck, /onTouchStart/);
        assert.match(deck, /onTouchEnd/);
        assert.match(deck, /shouldAdvancePackOnSwipe/);
        assert.match(deck, /absolute inset-x-0 top-0 bottom-6/);
        assert.match(deck, /addEventListener\("wheel"/);
        assert.doesNotMatch(deck, /className=\{cn\("relative h-full/);
    });

    it("keeps the pack a bounded postcard with inner JD scroll", () => {
        const pack = source("ForYouPack.tsx");
        assert.match(pack, /h-full max-h-full min-h-0[\s\S]*overflow-hidden/);
        assert.match(pack, /max-h-\[40%\]/);
        assert.match(pack, /data-pack-meta-scroll/);
        assert.match(pack, /data-pack-scroll/);
        assert.match(pack, /data-pack-scroll[\s\S]*overflow-y-auto/);
        assert.doesNotMatch(pack, /lg:min-h-\[420px\]/);
    });
});
