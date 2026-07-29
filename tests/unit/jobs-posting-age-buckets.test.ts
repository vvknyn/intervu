import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyPostingAgeBucket,
    postingAgeFilterClauses,
    FRESHNESS_BUCKETS,
} from '../../src/lib/jobs/posting-age-buckets';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000; // fixed clock so every assertion is deterministic

describe('classifyPostingAgeBucket', () => {
    it('a posting from right now is "7d"', () => {
        assert.equal(classifyPostingAgeBucket(NOW, NOW), '7d');
    });

    it('BOUNDARY — exactly 7 days old still counts as "7d" (inclusive near edge)', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 7 * DAY_MS, NOW), '7d');
    });

    it('one ms older than the 7-day edge rolls into "30d"', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 7 * DAY_MS - 1, NOW), '30d');
    });

    it('BOUNDARY — exactly 30 days old is still "30d"', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 30 * DAY_MS, NOW), '30d');
    });

    it('one ms older than the 30-day edge rolls into "60d"', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 30 * DAY_MS - 1, NOW), '60d');
    });

    it('BOUNDARY — exactly 60 days old is still "60d"', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 60 * DAY_MS, NOW), '60d');
    });

    it('one ms older than the 60-day edge is "older"', () => {
        assert.equal(classifyPostingAgeBucket(NOW - 60 * DAY_MS - 1, NOW), 'older');
    });
});

describe('postingAgeFilterClauses', () => {
    it('"7d" is a single lower-bound clause', () => {
        assert.deepEqual(postingAgeFilterClauses('7d', NOW), [`posted_ts >= ${NOW - 7 * DAY_MS}`]);
    });

    it('"30d" is bounded on both sides, agreeing with the classifier\'s edges', () => {
        assert.deepEqual(postingAgeFilterClauses('30d', NOW), [
            `posted_ts < ${NOW - 7 * DAY_MS}`,
            `posted_ts >= ${NOW - 30 * DAY_MS}`,
        ]);
    });

    it('"60d" is bounded on both sides', () => {
        assert.deepEqual(postingAgeFilterClauses('60d', NOW), [
            `posted_ts < ${NOW - 30 * DAY_MS}`,
            `posted_ts >= ${NOW - 60 * DAY_MS}`,
        ]);
    });

    it('"older" is a single upper-bound clause', () => {
        assert.deepEqual(postingAgeFilterClauses('older', NOW), [`posted_ts < ${NOW - 60 * DAY_MS}`]);
    });

    it('every bucket produces filter clauses (no bucket silently no-ops)', () => {
        for (const bucket of FRESHNESS_BUCKETS) {
            assert.ok(postingAgeFilterClauses(bucket, NOW).length > 0);
        }
    });
});
