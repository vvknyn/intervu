import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexCategories } from '../../src/lib/jobs/index-categories';
import { JOBS_USP } from '../../src/lib/jobs/jobs-usp-copy';

describe("indexCategories: field directory single source of truth", () => {
    it('the directory spans more than one field', () => {
        assert.ok(indexCategories.length >= 6, 'directory should offer at least six fields');
        const queries = indexCategories.map((cat) => cat.q);
        assert.equal(
            new Set(queries).size,
            queries.length,
            'directory cards must not collide on the same search query',
        );
    });

    it('technology leads the field directory (tech-first ICP)', () => {
        assert.equal(indexCategories[0]?.title, 'Software and tech');
        assert.equal(indexCategories[0]?.q, 'Software Engineer');
    });

    it('field directory uses human titles, not ledger chrome', () => {
        for (const cat of indexCategories) {
            assert.ok(cat.title.length > 0, 'each field needs a human title');
            assert.match(cat.title, /[a-z]/, `${cat.title} should read like plain language`);
        }
    });

    it('no card carries an unmeasured badge', () => {
        for (const cat of indexCategories) {
            assert.ok(!('metric' in cat), `${cat.title} card still carries a metric badge`);
        }
    });
});

describe('jobs toolbar chip row: field chips derive from indexCategories, not a parallel list', () => {
    const PAGE = join(__dirname, '..', '..', 'src', 'app', 'jobs', 'JobsContent.tsx');

    function chipRowSource(): string {
        const src = readFileSync(PAGE, 'utf8');
        const start = src.indexOf('const fieldDirectoryMenu');
        const end = src.indexOf('const savedSearchControl');
        assert.ok(start !== -1 && end !== -1 && end > start, 'chip-row anchors moved — update this test\'s markers');
        return src.slice(start, end);
    }

    it('references the shared indexCategories export', () => {
        assert.match(chipRowSource(), /indexCategories/, 'chip row no longer derives from indexCategories');
    });

    it('does not hardcode a quoted label (a parallel list literal)', () => {
        const offenders = chipRowSource().match(/label:\s*["'`]/g) ?? [];
        assert.deepEqual(offenders, [], 'chip row hardcodes a quoted label — restate via indexCategories instead of a parallel list');
    });
});

describe('jobs landing masthead: absorbed inline, dead exports retired', () => {
    const JOBS_PAGE = join(__dirname, '..', '..', 'src', 'app', 'jobs', 'JobsContent.tsx');

    it('renders the tested headline and provenance line when at rest, with no hero count and no live count (D1 + A3: both counts stay off the masthead)', () => {
        const src = readFileSync(JOBS_PAGE, 'utf8');
        // #652 (f6a8e9cc): the masthead is the `{atRest ? (` arm inside the
        // `showSearchHome` gate (the signed-in onboarding card that also
        // gated it was retired for the board).
        const start = src.indexOf('{atRest ? (', src.indexOf('{showSearchHome ? ('));
        const end = src.indexOf('<h1 className="sr-only">Jobs</h1>', start);
        assert.notStrictEqual(start, -1, 'masthead ternary anchor moved — update this test');
        assert.notStrictEqual(end, -1, 'sr-only fallback h1 anchor moved — update this test');
        const branch = src.slice(start, end);
        assert.match(branch, /\{JOBS_USP\.mastheadTitle\}/);
        assert.match(branch, /\{JOBS_USP\.searchDescription\}/);
        assert.match(JOBS_USP.searchDescription, /screened for stale postings/);
        assert.doesNotMatch(branch, /\{resultCountLine\}/);
        assert.doesNotMatch(branch, /\{liveCountEl\}/);
        assert.match(src.slice(end), /\{resultCountLine\}/, 'resultCountLine must still head the results list exactly once');
        assert.match(src.slice(end), /\{liveCountEl\}/, 'liveCountEl no longer rendered anywhere — A3 requires it once, at the end of the results list');
    });
});
