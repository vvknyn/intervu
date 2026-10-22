import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jobsResumeEntries, needsResumeEntry, offersRankByFit, resumeReadLine } from '../../src/lib/jobs/resume-entry';
import type { ResumeData } from '../../src/types/resume';

describe('needsResumeEntry', () => {
    it('guest, no résumé known — show the entry', () => {
        assert.equal(
            needsResumeEntry({ signedIn: false, resumeOnFile: false, fitActive: false }),
            true,
        );
    });

    it('signed in, server confirms no résumé — show the entry', () => {
        assert.equal(
            needsResumeEntry({ signedIn: true, resumeOnFile: false, fitActive: false }),
            true,
        );
    });

    it('résumé confirmed on file — never invite again, regardless of sign-in state', () => {
        assert.equal(
            needsResumeEntry({ signedIn: true, resumeOnFile: true, fitActive: false }),
            false,
        );
    });

    it('presence unknown (server round trip not back yet) — stay quiet rather than flash a wrong invite', () => {
        assert.equal(
            needsResumeEntry({ signedIn: true, resumeOnFile: null, fitActive: false }),
            false,
        );
    });

    it('already ranking by fit — the entry has nothing left to offer', () => {
        assert.equal(
            needsResumeEntry({ signedIn: false, resumeOnFile: false, fitActive: true }),
            false,
        );
    });
});

describe('offersRankByFit', () => {
    const cases: Array<[boolean | null, boolean, boolean]> = [
        [true, false, true],
        [false, false, true],
        [null, false, false],
        [true, true, false],
        [false, true, false],
        [null, true, false],
    ];
    for (const [resumeOnFile, fitActive, want] of cases) {
        it(`resumeOnFile=${resumeOnFile} fitActive=${fitActive} -> ${want}`, () => {
            assert.equal(offersRankByFit({ resumeOnFile, fitActive }), want);
        });
    }
    it('the add-a-résumé invite stays off for someone who has one', () => {
        assert.equal(needsResumeEntry({ signedIn: true, resumeOnFile: true, fitActive: false }), false);
    });
});

describe('jobsResumeEntries', () => {
    const states: Array<[boolean | null, boolean, string[]]> = [
        [false, false, ['toolbar', 'sort', 'detail']],
        [true, false, ['toolbar', 'sort']],
        [null, false, ['detail']],
        [true, true, []],
        [false, true, ['detail']],
        [null, true, ['detail']],
    ];
    for (const [resumeOnFile, fitActive, want] of states) {
        it(`resumeOnFile=${resumeOnFile} fitActive=${fitActive} -> ${want.join('+') || 'none'}`, () => {
            const got = jobsResumeEntries({ resumeOnFile, fitActive });
            assert.deepEqual(got, want);
            assert.ok(got.length <= 3, 'never more than three résumé entry points on /jobs');
        });
    }
});

describe('resumeReadLine', () => {
    const resume = (profile: Partial<ResumeData['profile']>, roles: string[] = []) =>
        ({ profile, experience: roles.map((role) => ({ role })) }) as unknown as ResumeData;

    it('title then place, behind the one "Ranked by your résumé" lead', () => {
        assert.equal(
            resumeReadLine(resume({ profession: 'Data Engineer', location: 'Toronto' })),
            'Ranked by your résumé · Data Engineer · Toronto',
        );
    });
    it('falls back to the first experience role when the profile has no title', () => {
        assert.equal(resumeReadLine(resume({ location: 'Berlin' }, ['', 'Staff Designer'])), 'Ranked by your résumé · Staff Designer · Berlin');
    });
    it('role alone when there is no place', () => {
        assert.equal(resumeReadLine(resume({ profession: 'Nurse' })), 'Ranked by your résumé · Nurse');
    });
    it('still says it ranked by the résumé when it read neither', () => {
        assert.equal(resumeReadLine(resume({})), 'Ranked by your résumé');
    });
});
