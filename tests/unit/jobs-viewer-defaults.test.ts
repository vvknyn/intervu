import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { viewerDefaults } from '../../src/lib/jobs/viewer-defaults';

const GUEST = { resumeOnFile: false, remoteOnly: false };

describe('viewerDefaults', () => {
    it('a guest or a viewer with no résumé and no preference gets nothing', () => {
        assert.deepEqual(viewerDefaults({}, GUEST), { sort: null, workType: null });
    });
    it('résumé on file and no sort in the address: fit', () => {
        assert.equal(viewerDefaults({}, { ...GUEST, resumeOnFile: true }).sort, 'fit');
        assert.equal(viewerDefaults({ sort: null }, { ...GUEST, resumeOnFile: true }).sort, 'fit');
    });
    it('an explicit sort of any kind wins over the default', () => {
        for (const sort of ['relevance', 'newest', 'salary', 'fit']) {
            assert.equal(viewerDefaults({ sort }, { ...GUEST, resumeOnFile: true }).sort, null, sort);
        }
    });
    it('saved remote-only and no work type in the address: remote', () => {
        assert.equal(viewerDefaults({}, { ...GUEST, remoteOnly: true }).workType, 'remote');
    });
    it('an explicit work type (any value, including a removal marker) wins', () => {
        for (const workType of ['remote', 'hybrid', 'any']) {
            assert.equal(viewerDefaults({ workType }, { ...GUEST, remoteOnly: true }).workType, null, workType);
        }
    });
    it('both defaults resolve independently', () => {
        const viewer = { resumeOnFile: true, remoteOnly: true };
        assert.deepEqual(viewerDefaults({}, viewer), { sort: 'fit', workType: 'remote' });
        assert.deepEqual(viewerDefaults({ sort: 'newest' }, viewer), { sort: null, workType: 'remote' });
        assert.deepEqual(viewerDefaults({ workType: 'hybrid' }, viewer), { sort: 'fit', workType: null });
    });
});
