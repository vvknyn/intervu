import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hubPackCorpusParams } from "../../src/lib/jobs/for-you/hub-pack-corpus";
import { HUB_PACK_IDS } from "../../src/lib/jobs/for-you/hub-pack-filters";
import { DEFAULT_URL_STATE, PACK_POSTED_BUCKET } from "../../src/lib/jobs/url-state";
import type { PostedBucket } from "../../src/lib/jobs/types";

// Lookback windows narrowest → widest. Not `FRESHNESS_BUCKETS`
// (posting-age-buckets.ts): that is the trends chart's own 7d/30d/60d/older
// band set, which has no "90d" — the board default since 2026-09-30.
const POSTED_WINDOWS: readonly PostedBucket[] = ["1d", "3d", "7d", "30d", "90d"];

// A pill must count in the same posted window as the list it opens: packs use
// PACK_POSTED_BUCKET, so a pill counting all-time beside it showed
// "1,937,058 roles" over a "75,028 roles from the last 30 days" list.
describe("hub pack pills count inside the packs' posted window", () => {
    const rank = (b: string) => (POSTED_WINDOWS as readonly string[]).indexOf(b);
    const packRank = rank(PACK_POSTED_BUCKET);
    for (const packId of HUB_PACK_IDS) {
        it(`${packId} carries a posted window no wider than the pack window`, () => {
            const bucket = hubPackCorpusParams(packId, undefined).postedBucket;
            assert.ok(bucket, `${packId} has no posted window (counts all-time)`);
            assert.ok(rank(bucket) >= 0 && rank(bucket) <= packRank, `${packId} window ${bucket} is wider than ${PACK_POSTED_BUCKET}`);
        });
    }
    it("the all pack counts exactly the pack window", () => {
        assert.equal(hubPackCorpusParams("all", undefined).postedBucket, PACK_POSTED_BUCKET);
    });
});

// Packs are recommendations: a fresh role beats reach. The board's typed-search
// default is wider (90 days); packs stay at 30 (pack audit, 2026-09-30).
describe("packs keep a narrower window than the board default", () => {
    it("PACK_POSTED_BUCKET is 30 days and narrower than DEFAULT_URL_STATE's", () => {
        assert.equal(PACK_POSTED_BUCKET, "30d");
        const rank = (b: string) => (POSTED_WINDOWS as readonly string[]).indexOf(b);
        assert.ok(rank(PACK_POSTED_BUCKET) < rank(DEFAULT_URL_STATE.postedBucket!));
    });
});
