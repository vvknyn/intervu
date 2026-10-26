import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test the REAL shared chokepoint (tsx resolves the @/ alias from tsconfig).
import { computeYearsOfExperience } from '@/lib/resume/years-of-experience';
import type { ResumeExperience } from '@/types/resume';

function exp(dates: string, id = 'e1'): ResumeExperience {
    return { id, company: 'Acme', role: 'Engineer', dates, description: '' };
}

describe('computeYearsOfExperience', () => {
    it('normal case (dataset A) — two sequential roles spanning to "now"', () => {
        const now = new Date(2026, 0, 1); // Jan 1, 2026
        const years = computeYearsOfExperience(
            [exp('Jan 2015 - Dec 2019', 'e1'), exp('Jan 2020 - Present', 'e2')],
            now,
        );
        assert.equal(years, 11); // 2015-01-01 -> 2026-01-01
    });

    it('normal case (dataset B) — a different date set and a different "now"', () => {
        const now = new Date(2020, 6, 1); // Jul 1, 2020
        const years = computeYearsOfExperience([exp('Feb 2013 - Present')], now);
        assert.equal(years, 7); // 2013-02-01 -> 2020-07-01 is ~7y5m
    });

    it('reads day-first, dashed and month-name dates, and ranges still running "till date"', () => {
        const now = new Date(2026, 0, 1); // Jan 1, 2026
        assert.equal(computeYearsOfExperience([exp('01.09.2015 – 01.09.2018')], now), 3);
        assert.equal(computeYearsOfExperience([exp('05-2019 - till date')], now), 6); // 2019-05 -> 2026-01 is 6y8m
        assert.equal(computeYearsOfExperience([exp('October 2018 to October 2020')], now), 2);
    });

    it('a future-dated role does not inflate the result or crash', () => {
        const now = new Date(2026, 0, 1); // Jan 1, 2026
        const years = computeYearsOfExperience(
            [exp('Jan 2015 - Dec 2019', 'e1'), exp('Feb 2026 - Present', 'e2')], // starts AFTER now
            now,
        );
        // The future role is excluded entirely — only the 2015-2019 span counts.
        assert.equal(years, 4);
    });

    it('missing/partial dates are skipped, not guessed at', () => {
        const now = new Date(2026, 0, 1);
        const years = computeYearsOfExperience(
            [exp('', 'e1'), exp('not a date', 'e2'), exp('Jun 2018 - Aug 2021', 'e3')],
            now,
        );
        assert.equal(years, 3); // only the one parseable entry counts
    });

    it('a role with no end date (current job) is treated as ongoing to "now"', () => {
        const now = new Date(2026, 0, 1);
        const years = computeYearsOfExperience([exp('Jan 2021')], now); // no separator/end at all
        assert.equal(years, 5);
    });

    it('returns null when no entry has a usable date', () => {
        const now = new Date(2026, 0, 1);
        const years = computeYearsOfExperience([exp(''), exp('garbage')], now);
        assert.equal(years, null);
    });
});
