import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsResumeEntry, needsResumeReplace, offersRankByFit } from '../../src/lib/jobs/resume-entry';

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

describe('needsResumeReplace', () => {
    it('résumé confirmed on file — show replace (signed in or guest)', () => {
        assert.equal(needsResumeReplace({ resumeOnFile: true }), true);
    });

    it('no résumé on file — stay quiet', () => {
        assert.equal(needsResumeReplace({ resumeOnFile: false }), false);
    });

    it('presence unknown — stay quiet', () => {
        assert.equal(needsResumeReplace({ resumeOnFile: null }), false);
    });
});

describe('local-ai guest banner replace entry', () => {
    it('banner wires Replace résumé through handleUploadClick', () => {
        const page = readFileSync(join(__dirname, '../../src/app/jobs/JobsContent.tsx'), 'utf8');
        const bannerStart = page.indexOf('data-testid="local-ai-guest-banner"');
        const bannerEnd = page.indexOf('data-testid="guest-save-banner"', bannerStart);
        const banner = page.slice(bannerStart, bannerEnd > bannerStart ? bannerEnd : bannerStart + 900);
        assert.match(banner, /data-testid="local-ai-replace-resume"/);
        assert.match(banner, /handleUploadClick\(\)/);
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
