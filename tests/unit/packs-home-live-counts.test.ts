import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB = join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx");
const PAGE = join(__dirname, "../../src/app/jobs/page.tsx");
const HOME = join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx");

describe("packs home live counts + deeper deck", () => {
    it("DEFAULT_CATEGORY_HUBS has no hardcoded job counts", () => {
        const src = readFileSync(HUB, "utf8");
        const hubs = src.match(/export const DEFAULT_CATEGORY_HUBS[\s\S]*?\n\];/)?.[0] ?? "";
        assert.match(hubs, /countLabel:\s*""/);
        assert.doesNotMatch(hubs, /\b(24|18|42|35|58|14|9|6) jobs\b/);
    });

    it("page keeps PAGE=20 for SERP and FOR_YOU_PAGE=60 for pack deck", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /const PAGE = 20/);
        assert.match(src, /const FOR_YOU_PAGE = 60/);
        assert.match(src, /firstPageLimit = deepForYou \? FOR_YOU_PAGE : PAGE/);
        assert.match(src, /hubCountLabels=\{hubCountLabels\}/);
        assert.match(src, /dailyApplyTip=\{DAILY_APPLY_HUB_TIP\}/);
        assert.doesNotMatch(src, /appliedTodayChrome/);
    });

    it("ForYouHome keeps nav-only top chrome; corpus line sits with Show more", () => {
        const src = readFileSync(HOME, "utf8");
        assert.match(src, /data-testid="for-you-show-more"/);
        assert.match(src, /Show more matches/);
        assert.match(src, /data-testid="for-you-showing-total"/);
        assert.match(src, /onLoadMore/);
        assert.doesNotMatch(src, /appliedTodayChrome/);
        assert.doesNotMatch(src, /for-you-applied-today/);
        // corpus line lives in the show-more wrap, not the top nav row
        const showMoreWrap =
            src.match(/data-testid="for-you-show-more-wrap"[\s\S]{0,900}/)?.[0] ?? "";
        assert.match(showMoreWrap, /for-you-showing-total/);
        const topNav =
            src.match(/data-testid="for-you-deck-position"[\s\S]{0,400}/)?.[0] ?? "";
        assert.doesNotMatch(topNav, /for-you-showing-total/);
    });
});
