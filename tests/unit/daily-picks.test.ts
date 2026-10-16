/**
 * The daily picks email (lib/daily-picks): which roles go out, that each goes
 * out once, what Today pins afterwards, and the guards on the run.
 * Today's own pick rules are the contract here: a pick is never a Stretch,
 * never above the résumé's level, never tracked (#855, today.ts).
 * The MCP `daily_picks` tool's parity with Today is in mcp-site-parity.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SITE_URL = 'https://velai.app';
import {
    DAILY_PICKS_MAX, DAILY_PICKS_PIN_MS, DAILY_PICKS_SENT_CAP, NOTHING_SENT,
    chooseDailyPicks, emailedToPin, pinEmailed, rankDailyPicks, rememberSent, sentKey, wasSent, type DailyPicksSent,
} from '../../src/lib/daily-picks/pick';
import { DAILY_PICKS_OFF, parseDailyPicksState } from '../../src/lib/daily-picks/state';
import { collectDailyPicks, type DailyPicksDeps } from '../../src/lib/daily-picks/collect';
import { NO_ADDRESS_ERROR, writeDailyPicksSetting } from '../../src/lib/daily-picks/account';
import { DAILY_PICKS_BASIS, buildDailyPicksEmail, type DailyPickItem } from '../../src/lib/email/templates/daily-picks';
import { dailyPickItem } from '../../src/lib/daily-picks/send';
import { POST as runDailyPicks } from '../../src/app/api/email/daily-picks/route';
import { toolDailyPicks, type ToolDeps } from '../../src/lib/agent/tools';
import { TODAY_PICKS_FETCH_LIMIT, TODAY_PICKS_WINDOW_MS, type TodayRole } from '../../src/lib/jobs/for-you/today';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
import type { BaseResume } from '../../src/lib/resume/base-resume';
import type { JobSearchParams, JobSearchResult, PublicJob } from '../../src/lib/jobs/types';
import type { ApplicationSummary } from '../../src/lib/pursuits/list';
import type { ResumeData } from '../../src/types/resume';
import { mkJob, mkResume } from '../support/jobs-corpus-stub';
import { jdTermsFromDescription } from '../../src/lib/match/jd-match';

const RESUME = mkResume({ location: 'Toronto, Ontario, Canada' });
const NOW_MS = Date.parse('2026-10-12T13:00:00Z');
const HOUR = 3_600_000;

/** Fits a mid software engineer in Toronto: own role, own level, in Canada. */
const fits = (id: string, fields: Partial<PublicJob> = {}) =>
    mkJob(id, { location: 'Toronto, ON', location_city: 'Toronto', location_country: 'Canada', company: `Co ${id}`, ...fields });

/** A posting written in French in the résumé's own line of work, and the saved choice of reading English only. */
const FRENCH_ENGINEERING_TEXT = `À propos du poste
Nous développons des services de paiement utilisés par plus de 2 000 clients au Québec et en Europe.

Votre rôle
Vous concevrez et livrerez des interfaces et des services en JavaScript et React, vous travaillerez avec les équipes de produit et de design, vous écrirez des tests automatisés et vous participerez aux revues de code de l'équipe.

Exigences
- Expérience en développement de logiciels et bonne connaissance de JavaScript et de React
- Capacité à communiquer avec les équipes techniques et avec la direction

Pourquoi nous rejoindre
Une équipe passionnée, un horaire flexible, des assurances collectives dès le premier jour et du travail à distance deux jours par semaine.`;
const inFrench = (id: string) => {
    const base = fits(id, { description: FRENCH_ENGINEERING_TEXT });
    return { ...base, jd_terms: jdTermsFromDescription(FRENCH_ENGINEERING_TEXT, base) } as PublicJob;
};
const READS_ENGLISH = async () => ({ configured: true, search: { languages: ['english'] }, answers: { custom: {} } });

function role(job: PublicJob, resume: ResumeData = RESUME): TodayRole {
    const score = scoreJobAgainstResume(resume, job, resolveCandidateSignals(resume));
    if (!score) throw new Error(`${job.id} has no score`);
    return { job, score };
}

const ids = (roles: TodayRole[]) => roles.map((r) => r.job.id);

describe('which roles a daily picks email names', () => {
    it('at most five, the best not sent before, by id or by the same opening re-posted', () => {
        const roles = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => role(fits(id)));
        const ranked = rankDailyPicks(roles, { tracked: new Set(), sent: NOTHING_SENT });
        assert.equal(ranked.length, 7);
        assert.equal(chooseDailyPicks(ranked, NOTHING_SENT).length, DAILY_PICKS_MAX);

        // 'b' went out by id; 'c' went out under another id (a re-posted copy of the same opening).
        const sent: DailyPicksSent = { ids: ['b'], keys: [sentKey(fits('c'))] };
        const picks = chooseDailyPicks(ranked, sent);
        assert.ok(!ids(picks).includes('b') && !ids(picks).includes('c'), JSON.stringify(ids(picks)));
        assert.equal(picks.length, DAILY_PICKS_MAX);
        assert.ok(wasSent(fits('c-repost', { company: 'Co c' }), sent), 'same company, title and place is the same opening');
    });

    it('never a Stretch, a role above the résumé\'s level, managing people they never managed, a role abroad or one tracked', () => {
        const roles = [
            role(fits('ok')),
            role(fits('senior', { title: 'Senior Software Engineer', experience_level: 'senior' })),
            role(fits('manager', { title: 'Engineering Manager', description: '<p>You will manage a team of 8 engineers and own their hiring.</p>' })),
            role(fits('abroad', { location: 'Austin, TX', location_city: 'Austin', location_country: 'United States' })),
            role(fits('tracked')),
        ];
        const ranked = rankDailyPicks(roles, { tracked: new Set(['tracked']), sent: NOTHING_SENT });
        assert.deepEqual(ids(ranked), ['ok']);
    });

    it('a role already emailed still ranks (for the MCP list), after the rest, and is not chosen again', () => {
        const roles = [role(fits('old')), role(fits('new'))];
        const sent: DailyPicksSent = { ids: ['old'], keys: [] };
        const ranked = rankDailyPicks(roles, { tracked: new Set(), sent });
        assert.deepEqual(ids(ranked), ['new', 'old']);
        assert.deepEqual(ids(chooseDailyPicks(ranked, sent)), ['new']);
    });
});

describe('what the account remembers once an email goes out', () => {
    it('appends the roles newest last, once each, by id and by opening', () => {
        const first = rememberSent(NOTHING_SENT, [fits('a'), fits('b')]);
        const second = rememberSent(first, [fits('b'), fits('c')]);
        assert.deepEqual(second.ids, ['a', 'b', 'c']);
        assert.equal(second.keys.length, 3);
        assert.equal(second.keys[2], sentKey(fits('c')));
    });

    it(`keeps the newest ${DAILY_PICKS_SENT_CAP}`, () => {
        let sent: DailyPicksSent = NOTHING_SENT;
        for (let i = 0; i < DAILY_PICKS_SENT_CAP + 10; i += 1) sent = rememberSent(sent, [fits(`r${i}`)]);
        assert.equal(sent.ids.length, DAILY_PICKS_SENT_CAP);
        assert.equal(sent.ids[0], 'r10');
        assert.equal(sent.ids.at(-1), `r${DAILY_PICKS_SENT_CAP + 9}`);
    });

    it('reads a stored record defensively: anything missing or malformed is never set', () => {
        assert.deepEqual(parseDailyPicksState(undefined), DAILY_PICKS_OFF);
        assert.deepEqual(parseDailyPicksState('on'), DAILY_PICKS_OFF);
        assert.deepEqual(
            parseDailyPicksState({ on: 'yes', sentIds: ['a', 3, null], sentKeys: 'x', lastSentAt: 'not a date', latestIds: ['a'] }),
            { on: false, changedAt: null, sent: { ids: ['a'], keys: [] }, lastSentAt: null, latestIds: ['a'] },
        );
        assert.equal(parseDailyPicksState({ on: true }).on, true);
    });
});

describe('Today pins the last email\'s picks', () => {
    it('while the email is recent, in its order', () => {
        const at = new Date(NOW_MS - 2 * HOUR).toISOString();
        assert.deepEqual(emailedToPin({ ids: ['x', 'y'], sentAt: at }, NOW_MS), ['x', 'y']);
        assert.deepEqual(emailedToPin({ ids: ['x'], sentAt: new Date(NOW_MS - DAILY_PICKS_PIN_MS - 1).toISOString() }, NOW_MS), []);
        assert.deepEqual(emailedToPin({ ids: ['x'], sentAt: null }, NOW_MS), []);
        assert.deepEqual(emailedToPin({ ids: ['x'], sentAt: new Date(NOW_MS + 2 * HOUR).toISOString() }, NOW_MS), [], 'a clock ahead of ours pins nothing');
    });

    it('puts them first in the email\'s order, and never adds one Today doesn\'t list', () => {
        const roles = [role(fits('a')), role(fits('b')), role(fits('c'))];
        assert.deepEqual(ids(pinEmailed(roles, ['c', 'gone', 'b'])), ['c', 'b', 'a']);
        assert.equal(pinEmailed(roles, []), roles);
        assert.equal(pinEmailed(roles, ['gone']), roles);
    });
});

function collectDeps(over: Partial<DailyPicksDeps> & { hits?: PublicJob[]; base?: BaseResume } = {}) {
    const searches: JobSearchParams[] = [];
    const deps: DailyPicksDeps = {
        getBaseResume: async () => over.base ?? { source: 'resume_data', resume_data: RESUME },
        getPreferences: async () => ({ configured: false, search: {}, answers: { custom: {} } }),
        search: async (params) => {
            searches.push(params);
            const hits = over.hits ?? [];
            return { hits, total: hits.length, backend: 'meilisearch', configured: true } as JobSearchResult;
        },
        listApplications: async () => [],
        ...over,
    };
    return { deps, searches };
}

describe('collecting one account\'s picks on the server', () => {
    it('searches the résumé\'s pack for the week, as Today does, and picks from it', async () => {
        const { deps, searches } = collectDeps({
            hits: [fits('a'), fits('senior', { title: 'Senior Software Engineer', experience_level: 'senior' }), fits('tracked')],
            listApplications: async () => [{ job_id: 'tracked' } as ApplicationSummary],
        });
        const out = await collectDailyPicks('u1', deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.equal(out.kind, 'ready');
        if (out.kind !== 'ready') return;
        assert.deepEqual(ids(out.picks), ['a']);
        assert.equal(searches[0]!.postedSinceMs, NOW_MS - TODAY_PICKS_WINDOW_MS);
        assert.equal(searches[0]!.limit, TODAY_PICKS_FETCH_LIMIT);
    });

    it('leaves out a role written in a language the person has not chosen, and counts it for the email and the agent', async () => {
        const { deps } = collectDeps({ hits: [fits('a'), inFrench('fr-1'), inFrench('fr-2')], getPreferences: READS_ENGLISH });
        const out = await collectDailyPicks('u1', deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.equal(out.kind, 'ready');
        if (out.kind !== 'ready') return;
        assert.deepEqual(ids(out.picks), ['a']);
        assert.deepEqual(out.languagesLeftOut, { french: 2 });
        // Choosing French brings them in, and nothing is counted.
        const chosen = collectDeps({ hits: [fits('a'), inFrench('fr-1')], getPreferences: async () => ({ configured: true, search: { languages: ['english', 'french'] }, answers: { custom: {} } }) });
        const both = await collectDailyPicks('u1', chosen.deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        if (both.kind !== 'ready') throw new Error('expected ready');
        assert.deepEqual(ids(both.picks).sort(), ['a', 'fr-1']);
        assert.equal(both.languagesLeftOut, undefined);
    });

    it('leaves roles past Senior out of the pool unless the résumé holds one itself, the way Today and the deck do', async () => {
        const plain = collectDeps({ hits: [fits('a')] });
        await collectDailyPicks('u1', plain.deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.equal(plain.searches[0]!.omitPastSenior, true, 'a résumé that shows no Staff or Principal role is not sent them');

        const staff = mkResume({ location: 'Toronto, Ontario, Canada', profession: 'Staff Software Engineer' });
        const holds = collectDeps({ base: { source: 'resume_data', resume_data: staff }, hits: [fits('a')] });
        await collectDailyPicks('u1', holds.deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.notEqual(holds.searches[0]!.omitPastSenior, true, 'a résumé that holds a Staff title keeps them');
    });

    it('ranks only a structured résumé: none, text only (never parsed on the server) or one with no role or skills is said so', async () => {
        const none = await collectDailyPicks('u', collectDeps({ base: { source: 'none' } }).deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.deepEqual(none, { kind: 'no-resume', reason: 'none' });
        const text = await collectDailyPicks('u', collectDeps({ base: { source: 'resume_text', resume_text: 'Nurse, 5 years' } }).deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.deepEqual(text, { kind: 'no-resume', reason: 'text-only' });
        const blank = mkResume({ profession: '' });
        blank.competencies = [];
        const unusable = await collectDailyPicks('u', collectDeps({ base: { source: 'resume_data', resume_data: blank } }).deps, { nowMs: NOW_MS, sent: NOTHING_SENT });
        assert.deepEqual(unusable, { kind: 'no-resume', reason: 'unusable' });
    });

    it('a failed search is "unavailable", never "nothing new today"', async () => {
        const down = collectDeps({ search: async () => ({ hits: [], total: 0, backend: 'meilisearch', configured: true, unavailable: true }) as JobSearchResult });
        assert.deepEqual(await collectDailyPicks('u', down.deps, { nowMs: NOW_MS, sent: NOTHING_SENT }), { kind: 'unavailable' });
        const unset = collectDeps({ search: async () => ({ hits: [], total: 0, backend: 'none', configured: false }) as unknown as JobSearchResult });
        assert.deepEqual(await collectDailyPicks('u', unset.deps, { nowMs: NOW_MS, sent: NOTHING_SENT }), { kind: 'unavailable' });
    });
});

describe('the email', () => {
    const item = (over: Partial<DailyPickItem> = {}): DailyPickItem => ({
        title: 'Software Engineer', employer: 'Acme', location: 'Toronto, ON', salary: null, fit: 'Strong',
        why: 'Your role, at your level, in Canada', href: 'https://velai.app/jobs/software-engineer-acme-1', ...over,
    });
    const model = (picks: DailyPickItem[]) => ({ siteUrl: 'https://velai.app', unsubscribeUrl: 'https://velai.app/unsubscribe?token=t', picks });

    it('says how many, the rule every pick passed, each one\'s fit and why, and where to turn it off', () => {
        const one = buildDailyPicksEmail(model([item()]));
        assert.equal(one.subject, '1 new role fits your résumé');
        assert.equal(buildDailyPicksEmail(model([item(), item({ title: 'Frontend Engineer' })])).subject, '2 new roles fit your résumé');
        for (const body of [one.html, one.text]) {
            assert.ok(body.includes('Strong match'), 'the fit word');
            assert.ok(body.includes('Your role, at your level, in Canada'), 'the reason');
            assert.ok(body.includes('https://velai.app/settings?tab=account'), 'turn it off in Settings');
            assert.ok(body.includes('https://velai.app/unsubscribe?token=t'), 'one-click unsubscribe');
        }
        assert.ok(one.text.includes(DAILY_PICKS_BASIS));
    });

    it('escapes what the posting wrote', () => {
        const { html } = buildDailyPicksEmail(model([item({ title: '<script>alert(1)</script>', employer: 'A & B' })]));
        assert.ok(!html.includes('<script>alert(1)'));
        assert.ok(html.includes('&lt;script&gt;') && html.includes('A &amp; B'));
    });

    it('words a pick from its score and links its page on the site', () => {
        const pick = dailyPickItem(role(fits('a')), 'https://velai.app');
        assert.ok(pick.fit === 'Strong' || pick.fit === 'Good', pick.fit);
        assert.ok(pick.why.length > 0);
        assert.ok(pick.href.startsWith('https://velai.app/jobs/'), pick.href);
        assert.equal(pick.employer, 'Co a');
    });
});

describe('the run and the switch refuse what they must', () => {
    const post = (headers: Record<string, string> = {}) =>
        runDailyPicks(new Request('https://velai.app/api/email/daily-picks', { method: 'POST', headers, body: '{"dryRun":true}' }));

    it('never runs without the cron secret configured, or with the wrong one', async () => {
        const before = process.env.EMAIL_DIGEST_CRON_SECRET;
        try {
            delete process.env.EMAIL_DIGEST_CRON_SECRET;
            assert.equal((await post({ authorization: 'Bearer anything' })).status, 503);
            process.env.EMAIL_DIGEST_CRON_SECRET = 'right';
            assert.equal((await post()).status, 401);
            assert.equal((await post({ authorization: 'Bearer wrong' })).status, 401);
        } finally {
            if (before === undefined) delete process.env.EMAIL_DIGEST_CRON_SECRET;
            else process.env.EMAIL_DIGEST_CRON_SECRET = before;
        }
    });

    it('can\'t be turned on without an address mail reaches', async () => {
        assert.deepEqual(await writeDailyPicksSetting('u', null, true), { error: NO_ADDRESS_ERROR });
    });
});

describe('the MCP daily_picks tool', () => {
    function toolDeps(over: Partial<ToolDeps> & { base?: BaseResume; hits?: PublicJob[]; sent?: DailyPicksSent } = {}) {
        const calls: string[] = [];
        const { deps: collect } = collectDeps({ base: over.base, hits: over.hits ?? [fits('a'), fits('b')] });
        const deps = {
            uid: 'user-1',
            ...collect,
            getDailyPicks: async () => {
                calls.push('get');
                return { state: { ...DAILY_PICKS_OFF, on: true, sent: over.sent ?? NOTHING_SENT }, on: true, reachable: true, blockedGlobally: false };
            },
            setDailyPicksEmail: async (_uid: string, on: boolean) => {
                calls.push(`set:${on}`);
                return { ok: true as const };
            },
            consumeRecordBudget: async () => ({ ok: true as const }),
            ...over,
        } as unknown as ToolDeps;
        return { deps, calls };
    }

    it('lists the picks with each one\'s reason, and which went out by email', async () => {
        const { deps } = toolDeps({ sent: { ids: ['a'], keys: [] } });
        const out = await toolDailyPicks(deps, {});
        if ('error' in out) throw new Error(out.error);
        assert.deepEqual(out.picks.map((p) => [p.id, p.emailed]), [['b', false], ['a', true]]);
        assert.ok(out.picks.every((p) => p.why.length > 0));
        assert.equal(out.email.on, true);
    });

    it('says how many roles it left out for their language and the one way in, never dropping them silently', async () => {
        const { deps } = toolDeps({ hits: [fits('a'), inFrench('fr-1'), inFrench('fr-2')], getPreferences: READS_ENGLISH });
        const out = await toolDailyPicks(deps, {});
        if ('error' in out) throw new Error(out.error);
        assert.deepEqual(out.picks.map((p) => p.id), ['a']);
        assert.deepEqual(out.left_out, { languages: { french: 2 } });
        assert.match(out.note ?? '', /2 written in French left out this week because you read postings in English/);
        assert.match(out.note ?? '', /set_preferences with search\.languages \["english", "french"\]/);
        // Nothing left out for language: no field, no sentence.
        const plain = await toolDailyPicks(toolDeps({ hits: [fits('a')], getPreferences: READS_ENGLISH }).deps, {});
        if ('error' in plain) throw new Error(plain.error);
        assert.equal(plain.left_out, undefined);
        assert.equal(plain.note, undefined);
    });

    it('turns the email on or off first, then reads it back', async () => {
        const { deps, calls } = toolDeps();
        await toolDailyPicks(deps, { email: false });
        assert.deepEqual(calls, ['set:false', 'get']);
    });

    it('says what to do when the résumé can\'t be ranked', async () => {
        const text = await toolDailyPicks(toolDeps({ base: { source: 'resume_text', resume_text: 'Nurse' } }).deps, {});
        assert.ok('error' in text && text.error.includes('daily_picks'), JSON.stringify(text));
        const none = await toolDailyPicks(toolDeps({ base: { source: 'none' } }).deps, {});
        assert.ok('error' in none && none.error.includes('set_resume'), JSON.stringify(none));
    });

    it('a failed search is unavailable, not zero picks', async () => {
        const { deps } = toolDeps({ search: async () => ({ hits: [], total: 0, backend: 'meilisearch', configured: true, unavailable: true }) as JobSearchResult });
        const out = await toolDailyPicks(deps, {});
        if ('error' in out) throw new Error(out.error);
        assert.equal(out.unavailable, true);
    });
});
