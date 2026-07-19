import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateLegacyProfile } from '@/lib/resume/profile-migration';
import type { ResumeProfile } from '@/types/resume';

function profile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
    return {
        name: '',
        profession: '',
        yearsOfExperience: 0,
        location: '',
        email: '',
        phone: '',
        ...overrides,
    };
}

describe('migrateLegacyProfile', () => {
    it('moves a legacy name-in-profession value to name and clears profession', () => {
        const migrated = migrateLegacyProfile(profile({ profession: 'Jane Doe' }));
        assert.equal(migrated.name, 'Jane Doe');
        assert.equal(migrated.profession, '');
    });

    it('leaves an already-correct profile (both fields set) unchanged', () => {
        const input = profile({ name: 'Jane Doe', profession: 'Product Lead' });
        const migrated = migrateLegacyProfile(input);
        assert.deepEqual(migrated, input);
    });

    it('leaves a fully-empty profile unchanged (nothing to migrate)', () => {
        const input = profile();
        const migrated = migrateLegacyProfile(input);
        assert.deepEqual(migrated, input);
    });

    it('does not overwrite an existing name even if profession is also set', () => {
        // Defensive: should never happen post-fix, but must not clobber real data.
        const input = profile({ name: 'Jane Doe', profession: 'Some stale value' });
        const migrated = migrateLegacyProfile(input);
        assert.equal(migrated.name, 'Jane Doe');
        assert.equal(migrated.profession, 'Some stale value');
    });
});
