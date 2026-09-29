import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { auditRecommendation, failedChecks, renderAuditMarkdown } from '../e2e/audit/pack-audit';
import { structureResumeText } from '../../src/lib/resume/structure-resume-text';
import type { ResumeData } from '../../src/types/resume';
import { NOW, mkJob } from '../support/jobs-corpus-stub';

const PM = structureResumeText(
    readFileSync(path.join(process.cwd(), 'tests/fixtures/vivek-pm-resume.txt'), 'utf8').replace(/'/g, '’'),
) as ResumeData;

const audit = (tile: Parameters<typeof auditRecommendation>[0]['tile'], job: ReturnType<typeof mkJob>) =>
    auditRecommendation({ resume: PM, tile, position: 1, job, shownBand: 'Good', nowMs: NOW });

describe('pack audit checks', () => {
    it('a senior product role in Canada passes every check under All', () => {
        const v = audit('all', mkJob('pm', { title: 'Senior Product Manager', location_country: 'Canada', experience_level: 'senior', tags: ['roadmap'] }));
        assert.deepEqual(v.checks, { place: 'pass', level: 'pass', role: 'pass', pack: 'pass' });
        assert.deepEqual(failedChecks(v), []);
    });

    it('another country, a junior level and an engineering title each fail their own check', () => {
        const v = audit('all', mkJob('be', { title: 'Backend Engineer', location_country: 'Germany', experience_level: 'entry', tags: ['api'] }));
        assert.deepEqual(failedChecks(v).sort(), ['level', 'place', 'role']);
    });

    it('remote with no country is open to anyone; an unstated level is unknown, not a failure', () => {
        const v = audit('remote', mkJob('r', { title: 'Product Manager', work_type: 'remote', location_country: null, experience_level: 'unknown' }));
        assert.equal(v.checks.place, 'pass');
        assert.equal(v.checks.level, 'unknown');
        assert.equal(v.checks.pack, 'pass');
    });

    it('a tile checks its own membership', () => {
        const onsite = mkJob('o', { title: 'Product Manager', location_country: 'Canada', experience_level: 'senior' });
        assert.equal(audit('remote', onsite).checks.pack, 'fail');
        assert.equal(audit('salary', onsite).checks.pack, 'fail');
        assert.equal(audit('ai', onsite).checks.pack, 'fail');
        assert.equal(audit('ai', { ...onsite, title: 'Product Manager, Machine Learning' }).checks.pack, 'pass');
    });

    it('a title tied to no target role is unknown for role, not a pass', () => {
        const v = audit('all', mkJob('hs', { title: 'Health And Safety Manager', location_country: 'Canada', experience_level: 'senior', tags: ['health'] }));
        assert.equal(v.checks.role, 'unknown');
    });

    it('scores the row as the list does, without the posting description', () => {
        const job = mkJob('pm', { title: 'Senior Product Manager', location_country: 'Canada', experience_level: 'senior', tags: ['roadmap'] });
        const withDescription = { ...job, description: 'Own the roadmap. '.repeat(10) + 'Forklift welding HVAC plumbing carpentry masonry.' };
        assert.equal(audit('all', withDescription).band, audit('all', job).band);
    });

    it('renders a row per recommendation', () => {
        const v = audit('all', mkJob('pm', { title: 'Product Manager | Payments', location_country: 'Canada', experience_level: 'senior' }));
        const md = renderAuditMarkdown([{ name: 'pm', searched: ['Product Manager'], verdicts: [v], empty: ['good'] }]);
        assert.match(md, /Product Manager \/ Payments/);
        assert.match(md, /Tiles with no roles: good\./);
    });
});
