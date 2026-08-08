import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDailySnapshotDoc,
    computeLatestDelta,
    isAlreadyExistsError,
    sinceLabel,
    type DailySnapshotDoc,
} from '../../src/lib/trends/daily-snapshot';

function snap(date: string, active: number, closed: number): DailySnapshotDoc {
    return { date, totalDocs: active + closed, active, closed, capturedAt: `${date}T00:05:00.000Z` };
}

describe('buildDailySnapshotDoc', () => {
    it('shapes a doc keyed by the UTC date, with the numbers passed straight through', () => {
        const nowMs = Date.UTC(2026, 7, 8, 0, 5, 0);
        const doc = buildDailySnapshotDoc({ totalDocs: 2_900_000, active: 1_558_454, closed: 1_300_000 }, nowMs);
        assert.equal(doc.date, '2026-08-08');
        assert.equal(doc.active, 1_558_454);
        assert.equal(doc.closed, 1_300_000);
        assert.equal(doc.totalDocs, 2_900_000);
        assert.equal(doc.capturedAt, new Date(nowMs).toISOString());
    });
});

describe('isAlreadyExistsError — the create-if-absent decision', () => {
    it('a Firestore ALREADY_EXISTS (gRPC code 6) error is treated as expected, not a failure', () => {
        assert.equal(isAlreadyExistsError({ code: 6, message: 'ALREADY_EXISTS' }), true);
    });

    it('any other error code is a genuine failure, not a silent no-op', () => {
        assert.equal(isAlreadyExistsError({ code: 5, message: 'NOT_FOUND' }), false);
        assert.equal(isAlreadyExistsError(new Error('network blip')), false);
    });

    it('non-object/null thrown values are also treated as genuine failures', () => {
        assert.equal(isAlreadyExistsError('boom'), false);
        assert.equal(isAlreadyExistsError(null), false);
        assert.equal(isAlreadyExistsError(undefined), false);
    });
});

describe('computeLatestDelta', () => {
    it('net-active and newly-closed between the two most recent snapshots', () => {
        const snapshots = [snap('2026-08-06', 1_500_000, 1_200_000), snap('2026-08-07', 1_558_454, 1_205_000)];
        const delta = computeLatestDelta(snapshots);
        assert.deepEqual(delta, { netActiveChange: 58_454, newlyClosed: 5_000, sinceDate: '2026-08-06' });
    });

    it('fewer than two snapshots — undefined, never a fabricated delta', () => {
        assert.equal(computeLatestDelta([]), undefined);
        assert.equal(computeLatestDelta([snap('2026-08-07', 100, 10)]), undefined);
    });

    it('missing-yesterday class case — a gap in captures still diffs the two most recent, not a fabricated adjacent-day pair', () => {
        // 2026-08-05 exists, 2026-08-06 was missed (e.g. a failed ISR
        // revalidation), the next capture is 2026-08-08 — three days later.
        const snapshots = [
            snap('2026-08-05', 1_400_000, 1_190_000),
            snap('2026-08-08', 1_558_454, 1_205_000),
        ];
        const delta = computeLatestDelta(snapshots);
        assert.deepEqual(delta, { netActiveChange: 158_454, newlyClosed: 15_000, sinceDate: '2026-08-05' });
    });

    it('active count can net negative (more closed than opened) — delta reflects that, not clamped to zero', () => {
        const snapshots = [snap('2026-08-06', 1_558_454, 1_200_000), snap('2026-08-07', 1_540_000, 1_210_000)];
        const delta = computeLatestDelta(snapshots);
        assert.equal(delta?.netActiveChange, -18_454);
    });
});

describe('sinceLabel', () => {
    it('exactly one UTC day back reads "yesterday"', () => {
        assert.equal(sinceLabel('2026-08-06', '2026-08-07'), 'yesterday');
    });

    it('a multi-day gap states the literal date rather than mislabeling it "yesterday"', () => {
        assert.equal(sinceLabel('2026-08-05', '2026-08-08'), '2026-08-05');
    });

    it('a zero-day gap (same date twice — shouldn\'t normally happen, but must not lie) also states the literal date', () => {
        assert.equal(sinceLabel('2026-08-07', '2026-08-07'), '2026-08-07');
    });
});
