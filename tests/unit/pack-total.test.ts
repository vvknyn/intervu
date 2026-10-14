/**
 * A pack's "only N roles match" number is what its filters return from the
 * SAME search call the pack retrieves with (`packSearchParams`) — not the size
 * of the deck on screen. Covered for personas in different countries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countResults, resolveBroadenOptions } from '../../src/lib/jobs/broaden';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { packFilters, packSearchParams } from '../../src/lib/jobs/for-you/pack-filters';
import type { JobSearchResult } from '../../src/lib/jobs/types';
import { corpusStub, mkJob, mkResume } from '../support/jobs-corpus-stub';

const CORPUS = [
    ...['ca1', 'ca2', 'ca3'].map((id) => mkJob(id, { location_country: 'Canada' })),
    ...['us1', 'us2', 'us3', 'us4', 'us5'].map((id) => mkJob(id, { location_country: 'United States' })),
];

const personas = [
    { name: 'Canada', resume: mkResume({ location: 'Toronto, Ontario, Canada' }), expected: 3 },
    { name: 'United States', resume: mkResume({ location: 'Austin, TX' }), expected: 5 },
];

describe('pack total comes from the pack search', () => {
    for (const persona of personas) {
        it(`${persona.name}: sends packSearchParams(filters) and reports that search's total`, async () => {
            const filters = packFilters(persona.resume, resolveCandidateSignals(persona.resume));
            const { search, calls } = corpusStub(CORPUS);
            assert.equal(await countResults(filters, search), persona.expected);
            assert.deepEqual({ ...calls[0], limit: undefined, offset: undefined }, { ...packSearchParams(filters), limit: undefined, offset: undefined });
            assert.equal(calls[0].limit, 1, 'a count, not a page of rows');
        });
    }

    it('a pack\'s count leaves out roles past Senior as its deck does, unless the résumé shows one', async () => {
        const filters = packFilters(personas[0].resume, resolveCandidateSignals(personas[0].resume));
        const mine = corpusStub(CORPUS);
        await countResults(filters, mine.search);
        assert.equal(mine.calls[0].omitPastSenior, true);
        const staff = corpusStub(CORPUS);
        await countResults(filters, staff.search, { keepPastSenior: true });
        assert.equal(staff.calls[0].omitPastSenior, undefined);
    });

    it('a failed or unavailable search is unknown (null), never a made-up number', async () => {
        const filters = packFilters(personas[0].resume, resolveCandidateSignals(personas[0].resume));
        const result = (patch: Partial<JobSearchResult>): JobSearchResult => ({ hits: [], total: 7, configured: true, ...patch }) as JobSearchResult;
        const sleep = async () => {};
        assert.equal(await countResults(filters, async () => result({ unavailable: true }), { sleep }), null);
        assert.equal(await countResults(filters, async () => result({ configured: false }), { sleep }), null);
        assert.equal(await countResults(filters, async () => { throw new Error('down'); }, { sleep }), null);
    });

    it('a refused count (an outage, or the rate limit, which answers the same way) is asked once more after a wait', async () => {
        const filters = packFilters(personas[0].resume, resolveCandidateSignals(personas[0].resume));
        const replies: JobSearchResult[] = [
            { hits: [], total: 0, backend: 'meilisearch', configured: true, unavailable: true },
            { hits: [], total: 7, backend: 'meilisearch', configured: true },
        ];
        const waits: number[] = [];
        let calls = 0;
        const total = await countResults(filters, async () => replies[calls++], { sleep: async (ms) => { waits.push(ms); } });
        assert.equal(total, 7);
        assert.equal(calls, 2);
        assert.equal(waits.length, 1);
        assert.ok(waits[0] >= 2000 && waits[0] < 4000, `jittered like the list retry, got ${waits[0]}`);
    });

    it('an unconfigured backend is not retried: nothing will change', async () => {
        const filters = packFilters(personas[0].resume, resolveCandidateSignals(personas[0].resume));
        let calls = 0;
        const total = await countResults(filters, async () => { calls++; return { hits: [], total: 0, backend: 'meilisearch', configured: false } as JobSearchResult; }, { sleep: async () => {} });
        assert.equal(total, null);
        assert.equal(calls, 1);
    });

    it('the broaden ladder counts through the same function (options only where the count is real)', async () => {
        const filters = packFilters(personas[0].resume, resolveCandidateSignals(personas[0].resume));
        const options = await resolveBroadenOptions({ state: filters, total: 3, search: corpusStub(CORPUS).search });
        assert.ok(options.every((o) => o.count > 3));
    });
});

describe('JobsContent wiring (call-site gate, no file allowlist)', () => {
    const SRC = readFileSync('src/app/jobs/JobsContent.tsx', 'utf8');
    const HOME = readFileSync('src/components/jobs/for-you/ForYouHome.tsx', 'utf8');

    it('the deck total is not the pack total', () => {
        assert.doesNotMatch(HOME, /packTotal\s*=\s*visiblePacks/);
        assert.match(HOME, /countResults\(filters,/);
    });

    it('every scoring call on the board passes the resolved signals', () => {
        const calls = SRC.split('\n').filter((line) => line.includes('scoreJobAgainstResume('));
        assert.ok(calls.length >= 2);
        for (const line of calls) assert.match(line, /scoreJobAgainstResume\(resume, h, signals\)/, line);
    });

    it('fit-ranking and the hub probe read the pack filters, not a résumé-only location', () => {
        assert.doesNotMatch(SRC, /packApplyLocationFacets/);
        assert.equal((SRC.match(/packFilters\(/g) ?? []).length, 2);
    });

    it('renders the broaden options for empty and thin results, and has no Canada carve-out', () => {
        assert.match(SRC, /broadenSlot=\{broadenNudge\}/);
        assert.match(SRC, /^\s*\{broadenNudge\}$/m);
        assert.doesNotMatch(SRC, /isCanadaDeckJob|canada-deck|resolveUrlSort/);
    });
});
