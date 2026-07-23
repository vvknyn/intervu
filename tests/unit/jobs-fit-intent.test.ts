import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FitIntentGuard } from '../../src/lib/jobs/fit-intent';

// Review fix (2026-07-18): `handleRankByFit` (src/app/page.tsx) awaits
// an async résumé fetch before applying fit. Without this guard, picking a
// different sort — or fit again — mid-fetch let a stale résumé fetch
// silently overwrite the user's newer choice once it resolved late.
describe('FitIntentGuard', () => {
    it('a fresh token is current until a later begin() supersedes it', () => {
        const guard = new FitIntentGuard();
        const first = guard.begin();
        assert.equal(guard.isCurrent(first), true);
    });

    it('a later begin() invalidates an earlier token — the core race fix', () => {
        const guard = new FitIntentGuard();
        const stale = guard.begin(); // e.g. the first "Rank by fit" click
        const fresh = guard.begin(); // user picked a different sort mid-fetch
        assert.equal(guard.isCurrent(stale), false);
        assert.equal(guard.isCurrent(fresh), true);
    });

    it('re-picking fit itself also supersedes the earlier in-flight fetch', () => {
        const guard = new FitIntentGuard();
        const firstClick = guard.begin();
        const secondClick = guard.begin();
        assert.equal(guard.isCurrent(firstClick), false);
        assert.equal(guard.isCurrent(secondClick), true);
    });

    it('an unissued token stops being current once any real token is issued', () => {
        const guard = new FitIntentGuard();
        const token = guard.begin();
        assert.equal(guard.isCurrent(token - 1), false);
    });
});
