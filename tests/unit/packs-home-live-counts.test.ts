import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HUB = join(__dirname, "../../src/components/jobs/CategoryHubGrid.tsx");
const PAGE = join(__dirname, "../../src/app/jobs/JobsContent.tsx");
const HOME = join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx");

describe("packs home live counts + deeper deck", () => {
    it("DEFAULT_CATEGORY_HUBS has no hardcoded job counts", () => {
        const src = readFileSync(HUB, "utf8");
        const hubs = src.match(/export const DEFAULT_CATEGORY_HUBS[\s\S]*?\n\];/)?.[0] ?? "";
        assert.ok(hubs.length > 0);
        // Counts only ever come in live (`hubCountLabels`); the pack list holds ids and labels.
        assert.doesNotMatch(hubs, /countLabel/);
        assert.doesNotMatch(hubs, /\b\d+\+? (jobs|roles)\b/);
    });

    it("page keeps PAGE=20 for SERP and FOR_YOU_PAGE=150 for pack deck (2026-10-13: 60 held only ~2 weeks of PM roles)", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /const PAGE = 20/);
        assert.match(src, /const FOR_YOU_PAGE = 150/);
        assert.match(src, /firstPageLimit = deepForYou \? FOR_YOU_PAGE : PAGE/);
        assert.match(src, /hubCountLabels=\{hubCountLabels\}/);
        // Today takes the daily tip's place whenever it shows (signed in, or a résumé on the device).
        assert.match(src, /dailyApplyTip=\{todayShown \? null : DAILY_APPLY_HUB_TIP\}/);
        assert.match(src, /hubCorpusLine=\{hubCorpusLine\}/);
        assert.match(src, /hubMatching=/);
        assert.match(src, /hubRemovalsLine=/);
        assert.match(src, /HUB_PROBE_LIMITS/);
        assert.doesNotMatch(src, /appliedTodayChrome/);
    });

    it("CategoryHubGrid surfaces corpus + removals + matching pulse", () => {
        const src = readFileSync(HUB, "utf8");
        assert.match(src, /data-testid="hub-corpus-line"/);
        assert.match(src, /data-testid="hub-removals-line"/);
        assert.match(src, /hubMatching/);
        assert.match(src, /data-matching=/);
    });

    it("ForYouHome keeps nav-only top chrome; corpus line sits with Show more", () => {
        const src = readFileSync(HOME, "utf8");
        assert.match(src, /data-testid="for-you-show-more"/);
        assert.match(src, /Show more matches/);
        assert.match(src, /data-testid="for-you-showing-total"/);
        assert.match(src, /onLoadMore/);
        assert.doesNotMatch(src, /appliedTodayChrome/);
        assert.doesNotMatch(src, /for-you-applied-today/);
        const showMoreWrap =
            src.match(/data-testid="for-you-show-more-wrap"[\s\S]{0,900}/)?.[0] ?? "";
        assert.match(showMoreWrap, /for-you-showing-total/);
        const topNav =
            src.match(/data-testid="for-you-deck-position"[\s\S]{0,400}/)?.[0] ?? "";
        assert.doesNotMatch(topNav, /for-you-showing-total/);
    });
});
