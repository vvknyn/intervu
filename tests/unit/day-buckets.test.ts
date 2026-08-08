import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, last14UtcDays, todayUtcDateLabel, utcDayRange } from '../../src/lib/jobs/day-buckets';

// /trends' 14-day posted series and the daily-snapshot doc-id both depend on
// day boundaries being computed in UTC, never the runtime's local timezone —
// local-time day math shifts by daylight-saving transitions, which would
// silently misbucket postings around every DST changeover.
describe('utcDayRange', () => {
    it('daysAgo=0 is the current UTC calendar day, exactly 86,400,000ms wide', () => {
        const nowMs = Date.UTC(2026, 7, 8, 15, 30, 0); // 2026-08-08T15:30:00Z
        const range = utcDayRange(nowMs, 0);
        assert.equal(range.dateLabel, '2026-08-08');
        assert.equal(range.startMs, Date.UTC(2026, 7, 8, 0, 0, 0));
        assert.equal(range.endMs - range.startMs, DAY_MS);
    });

    it('daysAgo=N steps back exactly N UTC calendar days', () => {
        const nowMs = Date.UTC(2026, 7, 8, 3, 0, 0);
        assert.equal(utcDayRange(nowMs, 1).dateLabel, '2026-08-07');
        assert.equal(utcDayRange(nowMs, 7).dateLabel, '2026-08-01');
    });

    it('crosses a month/year boundary correctly', () => {
        const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0); // 2026-01-01
        assert.equal(utcDayRange(nowMs, 1).dateLabel, '2025-12-31');
    });

    it('DST class case — US spring-forward day is still exactly 24h wide in UTC (2026-03-08, America/New_York DST start)', () => {
        // A local-time (`new Date(y, m, d)`) implementation run in an
        // America/New_York process would compute this "day" as 23h wide —
        // Date.UTC has no DST concept, so it must come out exactly 86.4Ms
        // regardless of what timezone the test runner's OS is set to.
        const nowMs = Date.UTC(2026, 2, 9, 6, 0, 0); // 2026-03-09 06:00 UTC
        const range = utcDayRange(nowMs, 1); // the DST-transition day itself
        assert.equal(range.dateLabel, '2026-03-08');
        assert.equal(range.endMs - range.startMs, DAY_MS);
    });

    it('DST class case — US fall-back day (2026-11-01, America/New_York DST end) is also exactly 24h wide', () => {
        const nowMs = Date.UTC(2026, 10, 2, 6, 0, 0);
        const range = utcDayRange(nowMs, 1);
        assert.equal(range.dateLabel, '2026-11-01');
        assert.equal(range.endMs - range.startMs, DAY_MS);
    });
});

describe('last14UtcDays', () => {
    it('returns 14 contiguous, oldest-first days ending on today', () => {
        const nowMs = Date.UTC(2026, 7, 8, 12, 0, 0);
        const days = last14UtcDays(nowMs);
        assert.equal(days.length, 14);
        assert.equal(days[13].dateLabel, '2026-08-08');
        assert.equal(days[0].dateLabel, '2026-07-26');
        for (let i = 1; i < days.length; i++) {
            assert.equal(days[i].startMs - days[i - 1].startMs, DAY_MS);
        }
    });
});

describe('todayUtcDateLabel', () => {
    it('matches utcDayRange(nowMs, 0)\'s dateLabel — the daily-snapshot doc-id convention', () => {
        const nowMs = Date.UTC(2026, 7, 8, 23, 59, 0);
        assert.equal(todayUtcDateLabel(nowMs), '2026-08-08');
    });
});
