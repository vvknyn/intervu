import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { needsResumeEntry } from '../../src/lib/jobs/resume-entry';

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
