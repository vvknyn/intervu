/**
 * One slot per employer in every list that recommends (employer-slot.ts): the collapse itself, then what each list
 * does with it, on roles that stand for any employer (nothing here names a real one).
 *   - the deck's hook is covered by J-JOBS-146 (a skip hands the slot on) and Today's rows by J-JOBS-147;
 *   - the daily picks email and the MCP `daily_picks` and `for_you` tools are covered below and in
 *     mcp-site-parity.test.ts.
 */
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SITE_URL = 'https://velai.app';
import { collapseByEmployer, EMPLOYER_SLOT_OPENINGS, slotLeads, slotOpenings } from '../../src/lib/jobs/for-you/employer-slot';
import { pickToday, todaySlots, type TodayRole } from '../../src/lib/jobs/for-you/today';
import { chooseDailyPicks, DAILY_PICKS_MAX, emailedJobs, NOTHING_SENT, rankDailyPicks, type DailyPicksSent } from '../../src/lib/daily-picks/pick';
import { dailyPickItem } from '../../src/lib/daily-picks/send';
import { buildDailyPicksEmail, type DailyPickItem } from '../../src/lib/email/templates/daily-picks';
import { formatDeckShowingLine, formatRolesAtEmployers } from '../../src/lib/jobs/for-you/left-out-copy';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
import type { PublicJob } from '../../src/lib/jobs/types';
import { mkJob, mkResume } from '../support/jobs-corpus-stub';

const NOW_MS = Date.parse('2026-10-12T13:00:00Z');
// The fixtures are dated from the stub's clock; read them against it, not today's, so they do not age past the 30 days a For you list keeps.
before(() => mock.timers.enable({ apis: ['Date'], now: NOW_MS }));
after(() => mock.timers.reset());

const job = (id: string, company: string | null, company_domain: string | null = null) => ({ id, company, company_domain }) as PublicJob;
const leads = (slots: ReturnType<typeof collapseByEmployer<PublicJob>>) => slots.map((s) => s.lead.id);

describe('collapseByEmployer: the employer is the slot', () => {
    it('keeps the first role of an employer as its slot, and the second employer keeps its own place', () => {
        const slots = collapseByEmployer([job('a1', 'Acme', 'acme.com'), job('b1', 'Beta', 'beta.com'), job('a2', 'Acme', 'acme.com')], (j) => j);
        assert.deepEqual(leads(slots), ['a1', 'b1']);
        assert.deepEqual(slots[0]!.more.map((j) => j.id), ['a2']);
        assert.deepEqual(slots[1]!.more, []);
        assert.equal(slots[0]!.hidden, 0);
    });

    it('an employer with nine openings is one slot, and the single opening after it is the second, not the tenth', () => {
        const nine = Array.from({ length: 9 }, (_, i) => job(`big-${i}`, 'Big Co', 'big.com'));
        const slots = collapseByEmployer([...nine, job('small-1', 'Small Co', 'small.com')], (j) => j);
        assert.deepEqual(leads(slots), ['big-0', 'small-1']);
        assert.equal(slots[0]!.more.length, EMPLOYER_SLOT_OPENINGS - 1);
        assert.equal(slots[0]!.hidden, 9 - EMPLOYER_SLOT_OPENINGS);
        // Nothing is lost silently: the slot counts every opening it holds, shown or not.
        assert.equal(slotOpenings(slots[0]!), 9);
        assert.equal(slots.reduce((sum, slot) => sum + slotOpenings(slot), 0), 10);
    });

    it('a slot sits where its best role sits, and its other roles keep the list\'s order', () => {
        // The list is already in the one order: b1 before a1 before a2, so Beta is first even though Acme has more.
        const slots = collapseByEmployer([job('b1', 'Beta', 'beta.com'), job('a1', 'Acme', 'acme.com'), job('a2', 'Acme', 'acme.com'), job('a3', 'Acme', 'acme.com')], (j) => j);
        assert.deepEqual(leads(slots), ['b1', 'a1']);
        assert.deepEqual(slots[1]!.more.map((j) => j.id), ['a2', 'a3']);
    });

    it('without a domain the employer is its name, however the name is written', () => {
        const slots = collapseByEmployer([job('a1', 'Acme, Inc.'), job('b1', 'Beta'), job('a2', 'ACME inc'), job('a3', 'Acme')], (j) => j);
        assert.deepEqual(leads(slots), ['a1', 'b1']);
        assert.deepEqual(slots[0]!.more.map((j) => j.id), ['a2', 'a3']);
    });

    it('a role with a name and no domain joins the employer\'s domain slot, whichever comes first', () => {
        const domainFirst = collapseByEmployer([job('a1', 'Acme', 'acme.com'), job('a2', 'Acme', null)], (j) => j);
        assert.deepEqual(leads(domainFirst), ['a1']);
        const nameFirst = collapseByEmployer([job('a2', 'Acme', null), job('a1', 'Acme', 'acme.com'), job('a3', 'Acme', 'acme.com')], (j) => j);
        assert.deepEqual(leads(nameFirst), ['a2']);
        assert.deepEqual(nameFirst[0]!.more.map((j) => j.id), ['a1', 'a3']);
    });

    it('one domain is one employer whatever the name says (a subsidiary), and the domain is read bare', () => {
        const slots = collapseByEmployer([job('a1', 'Semtech Canada', 'https://www.Semtech.com/'), job('a2', 'Semtech Corporation', 'semtech.com')], (j) => j);
        assert.deepEqual(leads(slots), ['a1']);
    });

    it('two domains under one name are two employers: a name alone never joins them', () => {
        const slots = collapseByEmployer([job('m1', 'Mercury', 'mercury.com'), job('m2', 'Mercury', 'mercuryinsurance.com'), job('m3', 'Mercury', null)], (j) => j);
        // The domain-less role has two employers it could be and joins the first by its name.
        assert.deepEqual(leads(slots), ['m1', 'm2']);
        assert.deepEqual(slots[0]!.more.map((j) => j.id), ['m3']);
    });

    it('a role that names no employer is its own slot, never joined to another with none', () => {
        const slots = collapseByEmployer([job('x1', null), job('x2', ''), job('x3', null, null)], (j) => j);
        assert.deepEqual(leads(slots), ['x1', 'x2', 'x3']);
    });

    it('a job board\'s own host is not an employer: two companies on one portal stay two', () => {
        const slots = collapseByEmployer([job('p1', 'Alpha Labs', 'alpha.greenhouse.io'), job('p2', 'Beta Works', 'beta.greenhouse.io'), job('p3', 'Alpha Labs', 'alpha.greenhouse.io')], (j) => j);
        assert.deepEqual(leads(slots), ['p1', 'p2']);
        assert.deepEqual(slots[0]!.more.map((j) => j.id), ['p3']);
    });

    it('is the identity on a list of different employers, and on an empty one', () => {
        const items = ['a', 'b', 'c'].map((id) => job(id, `Co ${id}`, `${id}.com`));
        assert.deepEqual(slotLeads(collapseByEmployer(items, (j) => j)), items);
        assert.deepEqual(collapseByEmployer([], (j: PublicJob) => j), []);
    });
});

const RESUME = mkResume({ location: 'Toronto, Ontario, Canada' });
/** Fits a mid software engineer in Toronto: own role, own level, in Canada. */
const fits = (id: string, company: string, fields: Partial<PublicJob> = {}) =>
    mkJob(id, { location: 'Toronto, ON', location_city: 'Toronto', location_country: 'Canada', company, company_domain: `${company.toLowerCase().replace(/\W+/g, '')}.com`, ...fields });
function role(j: PublicJob): TodayRole {
    const score = scoreJobAgainstResume(RESUME, j, resolveCandidateSignals(RESUME));
    if (!score) throw new Error(`${j.id} has no score`);
    return { job: j, score };
}
const ids = (roles: TodayRole[]) => roles.map((r) => r.job.id);

describe('Today and the daily picks: five rows are five employers', () => {
    const roles = [
        role(fits('a1', 'Alpha', { title: 'Software Engineer' })),
        role(fits('a2', 'Alpha', { title: 'Backend Software Engineer' })),
        role(fits('b1', 'Beta')),
        role(fits('a3', 'Alpha', { title: 'Frontend Software Engineer' })),
        role(fits('c1', 'Gamma')),
    ];

    it('lists each employer once, with its other picks inside its row', () => {
        const picks = pickToday(roles, { skipped: new Set(), tracked: new Set(), nowMs: NOW_MS });
        assert.equal(picks.length, 5, 'the order itself is not collapsed: Search-like callers still see every role');
        const rows = todaySlots(picks);
        assert.equal(rows.length, 3);
        const alpha = rows.find((r) => r.job.company === 'Alpha')!;
        assert.equal(alpha.employer?.more.length, 2);
        assert.equal(new Set(rows.flatMap((r) => [r.job.id, ...(r.employer?.more.map((m) => m.job.id) ?? [])])).size, 5, 'every pick is a row or inside one');
        assert.ok(rows.filter((r) => r.job.company !== 'Alpha').every((r) => r.employer === undefined));
    });

    it('a thumbs down on an employer\'s row hands its slot to its next role, in that role\'s own place', () => {
        const lead = todaySlots(pickToday(roles, { skipped: new Set(), tracked: new Set(), nowMs: NOW_MS })).find((r) => r.job.company === 'Alpha')!;
        const after = todaySlots(pickToday(roles, { skipped: new Set([lead.job.id]), tracked: new Set(), nowMs: NOW_MS }));
        const next = after.find((r) => r.job.company === 'Alpha')!;
        assert.notEqual(next.job.id, lead.job.id);
        assert.equal(next.employer?.more.length, 1);
        assert.ok(!ids(after).includes(lead.job.id) && !after.some((r) => r.employer?.more.some((m) => m.job.id === lead.job.id)));
    });

    it('the email names five employers at most, each with its other roles under it', () => {
        const many = [...'abcdefgh'].flatMap((c) => [role(fits(`${c}1`, `Co ${c}`)), role(fits(`${c}2`, `Co ${c}`, { title: 'Backend Software Engineer' }))]);
        const ranked = rankDailyPicks(many, { tracked: new Set(), sent: NOTHING_SENT, nowMs: NOW_MS });
        const picks = chooseDailyPicks(ranked, NOTHING_SENT);
        assert.equal(picks.length, DAILY_PICKS_MAX);
        assert.equal(new Set(picks.map((p) => p.job.company)).size, DAILY_PICKS_MAX);
        assert.ok(picks.every((p) => p.employer?.more.length === 1));
        // What the account is recorded as sent is every role the email names, a pick then the roles under it.
        assert.equal(emailedJobs(picks).length, DAILY_PICKS_MAX * 2);
        assert.deepEqual(emailedJobs(picks).slice(0, 2).map((j) => j.company), [picks[0]!.job.company, picks[0]!.job.company]);
    });

    it('an employer whose best role went out yesterday leads today with the next one it has not sent', () => {
        const pair = [role(fits('a1', 'Alpha')), role(fits('a2', 'Alpha', { title: 'Backend Software Engineer' })), role(fits('b1', 'Beta'))];
        const sent: DailyPicksSent = { ids: ['a1'], keys: [] };
        const ranked = rankDailyPicks(pair, { tracked: new Set(), sent, nowMs: NOW_MS });
        const picks = chooseDailyPicks(ranked, sent);
        assert.deepEqual(new Set(ids(picks)), new Set(['a2', 'b1']));
        assert.ok(picks.every((p) => p.employer === undefined), 'a1 was sent: it is not named again under Alpha');
    });

    it('the email words each role under a pick with its fit and link, counts every role it names, and says what it does not show', () => {
        const picks = chooseDailyPicks(rankDailyPicks(roles, { tracked: new Set(), sent: NOTHING_SENT, nowMs: NOW_MS }), NOTHING_SENT);
        const items = picks.map((p) => dailyPickItem(p, 'https://velai.app'));
        const alpha = items.find((i) => i.employer === 'Alpha')!;
        assert.equal(alpha.more?.length, 2);
        assert.ok(alpha.more!.every((m) => m.href.startsWith('https://velai.app/jobs/') && (m.fit === 'Strong' || m.fit === 'Good')));
        const email = buildDailyPicksEmail({ siteUrl: 'https://velai.app', unsubscribeUrl: 'https://velai.app/unsubscribe?token=t', picks: items });
        assert.equal(email.subject, '5 new roles fit your résumé', 'five roles named, at three employers');
        assert.ok(email.html.includes('More at Alpha') && email.text.includes('More at Alpha:'));
        for (const m of alpha.more!) assert.ok(email.html.includes(m.href) && email.text.includes(m.href));

        const crowded: DailyPickItem = { ...alpha, hidden: { count: 5, href: 'https://velai.app/co/alpha-com' } };
        const long = buildDailyPicksEmail({ siteUrl: 'https://velai.app', unsubscribeUrl: 'https://velai.app/unsubscribe?token=t', picks: [crowded] });
        assert.ok(long.html.includes('See the other 5 at Alpha') && long.text.includes('See the other 5 at Alpha: https://velai.app/co/alpha-com'));
    });
});

describe('the deck\'s count says roles and employers', () => {
    it('"12 roles fit your résumé at 7 employers", and the old line when every role is its own employer', () => {
        assert.equal(formatRolesAtEmployers(14, 7), '14 roles at 7 employers', 'the words the hub chip and the deck header share');
        assert.equal(formatRolesAtEmployers(7, 7), '7 roles');
        assert.equal(formatRolesAtEmployers(1, 1), '1 role');
        assert.equal(formatRolesAtEmployers(3, 1), '3 roles at 1 employer');
        assert.equal(formatRolesAtEmployers(1234, 600), '1,234 roles at 600 employers');
        assert.equal(formatDeckShowingLine(12, 'fit', 7), '12 roles · ranked by fit');
        assert.equal(formatDeckShowingLine(8, 'fit', 8), '8 roles · ranked by fit');
        assert.equal(formatDeckShowingLine(8, 'fit'), '8 roles · ranked by fit');
        assert.equal(formatDeckShowingLine(3, 'older', 1), '3 roles fit your résumé at 1 employer · all posted over 30 days ago');
        assert.equal(formatDeckShowingLine(5, 'near', 2), '5 closest roles at 2 employers · each a weaker fit');
    });
});
