import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    MOCK_FOR_YOU_DECK_BAND_SCORES,
    MOCK_FOR_YOU_DECK_JOBS,
} from "../../src/lib/jobs/for-you/mock-deck-fixtures";
import { matchBandLabel, matchBand } from "../../src/lib/match/score";

const ROOT = join(__dirname, "../..");

describe("for-you deck mock fixture", () => {
    it("ships three US jobs with band-only fit totals", () => {
        assert.equal(MOCK_FOR_YOU_DECK_JOBS.length, 3);
        const labels = MOCK_FOR_YOU_DECK_JOBS.map((job) => {
            const score = MOCK_FOR_YOU_DECK_BAND_SCORES.get(job.id);
            assert.ok(score, `missing band score for ${job.id}`);
            return matchBandLabel(matchBand(score!.total));
        });
        assert.deepEqual(labels, ["Strong", "Good", "Stretch"]);
    });

    it("fixture copy avoids Canada and numeric fit breakdown strings", () => {
        const src = readFileSync(join(ROOT, "src/lib/jobs/for-you/mock-deck-fixtures.ts"), "utf8");
        assert.doesNotMatch(src, /Canada|Toronto|Ontario|\b\d+\s*%\s*Match/i);
        for (const job of MOCK_FOR_YOU_DECK_JOBS) {
            assert.notEqual(job.location_country, "CA");
            assert.doesNotMatch(JSON.stringify(job), /Canada|Toronto/i);
        }
    });

    it("mock route uses production deck components only", () => {
        const mock = readFileSync(join(ROOT, "src/components/mock/ForYouDeckMock.tsx"), "utf8");
        assert.match(mock, /ForYouHome/);
        assert.doesNotMatch(mock, /data-testid="for-you-pack"[\s\S]*createElement\("div"/);
        const page = readFileSync(join(ROOT, "src/app/mock/for-you-deck/page.tsx"), "utf8");
        assert.match(page, /ForYouDeckMockLoader/);
        assert.doesNotMatch(page, /href=.*mock\/for-you-deck/);
    });

    it("mock wires optimistic save through ForYouHome onGoAfter and RowBookmarkButton testids", () => {
        const mock = readFileSync(join(ROOT, "src/components/mock/ForYouDeckMock.tsx"), "utf8");
        assert.match(mock, /buildOptimisticPursuit/);
        assert.match(mock, /onGoAfter=\{handleGoAfter\}/);
        assert.match(mock, /activePursuit=\{activePursuit\}/);
        assert.match(mock, /MOCK_FOR_YOU_SAVE_DELAY_MS/);
        const home = readFileSync(join(ROOT, "src/components/jobs/for-you/ForYouHome.tsx"), "utf8");
        assert.match(home, /<JobDetail/);
        assert.match(home, /onGoAfter\?\.?\(/);
        assert.match(home, /data-testid="for-you-deck-save"/);
        const bookmark = readFileSync(join(ROOT, "src/components/jobs/RowBookmarkButton.tsx"), "utf8");
        assert.match(bookmark, /data-testid="job-save-trigger"/);
        assert.match(bookmark, /data-testid="job-save-optimistic"/);
        assert.match(bookmark, /data-testid="job-save-confirmed"/);
    });

    it("fixture module is not imported from product jobs surfaces", () => {
        const page = readFileSync(join(ROOT, "src/app/jobs/page.tsx"), "utf8");
        assert.doesNotMatch(page, /mock-deck-fixtures/);
        const deck = readFileSync(join(ROOT, "src/components/jobs/for-you/ForYouDeck.tsx"), "utf8");
        assert.doesNotMatch(deck, /mock-deck-fixtures/);
    });
});
