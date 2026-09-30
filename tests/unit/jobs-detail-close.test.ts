import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUSHED_IN_APP, previousEntryIsOurs, urlWithoutJob } from '../../src/lib/jobs/detail-close';

describe('previousEntryIsOurs', () => {
    it('follows the Navigation API when the browser has it', () => {
        assert.equal(previousEntryIsOurs({ history: { state: null }, navigation: { canGoBack: true } }), true);
        // A shared link opened in a fresh tab: nothing of ours before it, even on an entry we marked.
        assert.equal(previousEntryIsOurs({ history: { state: { [PUSHED_IN_APP]: true } }, navigation: { canGoBack: false } }), false);
    });

    it('without it, trusts only an entry /jobs pushed itself', () => {
        assert.equal(previousEntryIsOurs({ history: { state: { [PUSHED_IN_APP]: true, __NA: true } } }), true);
        assert.equal(previousEntryIsOurs({ history: { state: { __NA: true } } }), false);
        assert.equal(previousEntryIsOurs({ history: { state: null } }), false);
        assert.equal(previousEntryIsOurs({ history: { state: 'x' } }), false);
        assert.equal(previousEntryIsOurs({ history: { state: null }, navigation: {} }), false);
    });
});

describe('urlWithoutJob', () => {
    it('drops only the job param', () => {
        assert.equal(urlWithoutJob({ pathname: '/jobs', search: '?q=data+analyst&job=abc&posted=any' }), '/jobs?q=data+analyst&posted=any');
        assert.equal(urlWithoutJob({ pathname: '/jobs', search: '?job=abc' }), '/jobs');
        assert.equal(urlWithoutJob({ pathname: '/jobs', search: '' }), '/jobs');
    });
});

describe('JobsContent closes a job through closeDetail', () => {
    const src = readFileSync(new URL('../../src/app/jobs/JobsContent.tsx', import.meta.url), 'utf8');

    it('never steps Back unguarded', () => {
        const backs = src.split('\n').filter((line) => /router\.back\(\)/.test(line) && !/^\s*(\/\/|\*|\{?\/\*)/.test(line) && !/`router\.back\(\)`/.test(line));
        assert.deepEqual(backs.map((l) => l.trim()), ['if (previousEntryIsOurs(window)) router.back();']);
    });

    it('marks the entries it pushes', () => {
        assert.match(src, /window\.history\.pushState\(\{ \[PUSHED_IN_APP\]: true \}, "", target\)/);
    });
});
