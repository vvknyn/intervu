import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResumePresenceCache } from '../../src/lib/resume/resume-presence-cache';

describe('resume presence cache: one read for every subscriber', () => {
    it('three subscribers asking at once make one server call', async () => {
        let calls = 0;
        const cache = createResumePresenceCache(async () => {
            calls += 1;
            return true;
        });
        assert.deepEqual(await Promise.all([cache.read('u'), cache.read('u'), cache.read('u')]), [true, true, true]);
        assert.equal(calls, 1);
    });

    it('a subscriber that mounts later within the window is answered from the kept answer', async () => {
        let calls = 0;
        let t = 0;
        const cache = createResumePresenceCache(async () => { calls += 1; return false; }, () => t, 100);
        await cache.read('u');
        t = 50;
        assert.equal(cache.peek('u'), false);
        await cache.read('u');
        assert.equal(calls, 1);
        t = 150;
        assert.equal(cache.peek('u'), null);
        await cache.read('u');
        assert.equal(calls, 2);
    });

    it('answers are per account', async () => {
        let calls = 0;
        const cache = createResumePresenceCache(async () => { calls += 1; return true; });
        await cache.read('a');
        await cache.read('b');
        assert.equal(calls, 2);
    });

    it('a failed read is not kept: the next ask tries again', async () => {
        let calls = 0;
        const cache = createResumePresenceCache(async () => {
            calls += 1;
            if (calls === 1) throw new Error('down');
            return true;
        });
        await assert.rejects(cache.read('u'));
        assert.equal(cache.peek('u'), null);
        assert.equal(await cache.read('u'), true);
    });

    it('a seeded answer (the server-rendered page) means no call at all', async () => {
        let calls = 0;
        const cache = createResumePresenceCache(async () => { calls += 1; return false; });
        cache.seed('u', true);
        assert.equal(await cache.read('u'), true);
        assert.equal(calls, 0);
    });
});
