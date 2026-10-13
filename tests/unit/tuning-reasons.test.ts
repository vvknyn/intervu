/**
 * "More / fewer like this — why?" (tuning.ts `TuningReason`, review
 * 2026-10-13): a tap still nudges on its own; a reason makes it steer by
 * exactly that and nothing else.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    REASONS_FOR,
    REASON_TEXT,
    roleFeatures,
    summarizeTuning,
    tuneDeck,
    tuningLine,
    withReason,
    type TuningNudge,
    type TuningReason,
} from '../../src/lib/jobs/for-you/tuning';
import type { PublicJob } from '../../src/lib/jobs/types';
import { mkJob } from '../support/jobs-corpus-stub';

const NOW = Date.parse('2026-10-13T12:00:00Z');

const tam = (id: string, fields: Partial<PublicJob>) =>
    mkJob(id, { title: 'Technical Account Manager', company: 'Acme', experience_level: 'mid', work_type: 'onsite', location_country: 'Canada', location_city: 'Toronto', ...fields });

// The tapped role: a senior security TAM at Acme, remote. Every reason has something to steer by.
const tapped = tam('tapped', { title: 'Senior Technical Account Manager, Security', experience_level: 'senior', work_type: 'remote' });

// The rest of the deck, each sharing exactly one thing with the tapped role.
const deck: PublicJob[] = [
    tam('plain-1', { company: 'Northwind' }),
    tam('plain-2', { company: 'Globex' }),
    tam('plain-3', { company: 'Initech' }),
    tam('same-company', { company: 'Acme' }),
    tam('senior', { title: 'Senior Technical Account Manager', company: 'Umbrella', experience_level: 'senior' }),
    tam('remote', { company: 'Hooli', work_type: 'remote' }),
    tam('security', { title: 'Technical Account Manager, Security', company: 'Stark' }),
    mkJob('csm', { title: 'Customer Success Manager', company: 'Wayne', experience_level: 'mid', location_country: 'Canada', location_city: 'Toronto' }),
];

function nudged(signal: 'more' | 'fewer', reason?: TuningReason): TuningNudge {
    const all = [tapped, ...deck];
    const base: TuningNudge = { jobId: tapped.id, signal, at: NOW, features: roleFeatures(tapped, all, { signal }) };
    return reason ? withReason([base], tapped.id, reason, roleFeatures(tapped, all, { signal, reason }))[0]! : base;
}

/** Where each role lands after the nudge, by id. */
function order(nudge: TuningNudge): string[] {
    return tuneDeck(deck, [nudge], [], NOW).map((job) => job.id);
}

const last = (ids: string[], n = 1) => ids.slice(-n);
const first = (ids: string[], n = 1) => ids.slice(0, n);

describe('a reason narrows what a "fewer" steers by', () => {
    it('"This company" moves only that employer\'s roles', () => {
        assert.deepEqual(last(order(nudged('fewer', 'company'))), ['same-company']);
    });

    it('"Wrong level" moves only the roles at that level', () => {
        assert.deepEqual(last(order(nudged('fewer', 'level'))), ['senior']);
    });

    it('"Location or remote" moves only the roles where it is (remote here)', () => {
        assert.deepEqual(last(order(nudged('fewer', 'place'))), ['remote']);
    });

    it('"The field or skills" moves the field (Security), not the TAM roles themselves', () => {
        const ids = order(nudged('fewer', 'field'));
        assert.deepEqual(last(ids), ['security']);
        assert.ok(ids.indexOf('plain-1') < ids.indexOf('security'));
    });

    it('"Not my kind of role" moves every role of that kind, not the other kind', () => {
        const ids = order(nudged('fewer', 'role'));
        assert.equal(ids[0], 'csm', ids.join(' '));
    });

    it('"Applied or stale" moves nothing: only that posting goes', () => {
        assert.deepEqual(order(nudged('fewer', 'done')), deck.map((job) => job.id));
    });
});

describe('a reason narrows what a "more" steers by', () => {
    it('"This company" brings that employer up', () => {
        assert.deepEqual(first(order(nudged('more', 'company'))), ['same-company']);
    });

    it('"Location or remote" brings remote roles up', () => {
        assert.deepEqual(first(order(nudged('more', 'place'))), ['remote']);
    });
});

describe('the tuning line names the reason', () => {
    const line = (signal: 'more' | 'fewer', reason: TuningReason) => {
        const summary = summarizeTuning([nudged(signal, reason)], NOW);
        return summary ? tuningLine(summary) : null;
    };

    it('says what was steered away from or toward', () => {
        assert.equal(line('fewer', 'company'), 'Tuned away from Acme.');
        assert.equal(line('fewer', 'level'), 'Tuned away from senior roles.');
        assert.equal(line('fewer', 'place'), 'Tuned away from remote roles.');
        assert.equal(line('fewer', 'field'), 'Tuned away from Security.');
        assert.equal(line('more', 'role'), 'Tuned toward Technical Account Manager.');
    });

    it('"Applied or stale" adds nothing to the line', () => {
        assert.equal(line('fewer', 'done'), null);
    });
});

describe('the choices offered', () => {
    it('every reason offered has its words; "Applied or stale" only after "fewer"', () => {
        for (const signal of ['more', 'fewer'] as const) {
            for (const reason of REASONS_FOR[signal]) assert.ok(REASON_TEXT[signal][reason], `${signal}/${reason}`);
        }
        assert.ok(REASONS_FOR.fewer.includes('done'));
        assert.ok(!REASONS_FOR.more.includes('done'));
    });

    it('without a reason a tap still steers, as before', () => {
        const ids = order(nudged('fewer'));
        assert.notDeepEqual(ids, deck.map((job) => job.id));
    });
});

describe('the store keeps the reason', async () => {
    const { recordNudge, setNudgeReason, getNudgesSnapshot, resetNudges, loadNudges } = await import('../../src/lib/jobs/for-you/tuning-store');

    it('a reason given after the tap replaces the guess and its label', () => {
        resetNudges();
        recordNudge(tapped, 'fewer', [tapped, ...deck], { nowMs: NOW });
        setNudgeReason(tapped, 'company', [tapped, ...deck]);
        const stored = getNudgesSnapshot().find((n) => n.jobId === tapped.id)!;
        assert.equal(stored.reason, 'company');
        assert.equal(stored.features.label, 'Acme');
        resetNudges();
    });

    it('a reason with no tap behind it (taken back first) is ignored', () => {
        resetNudges();
        setNudgeReason(tapped, 'company', deck);
        assert.equal(getNudgesSnapshot().length, 0);
    });

    it('loading never throws without browser storage', () => {
        assert.deepEqual(loadNudges(NOW), []);
    });
});
