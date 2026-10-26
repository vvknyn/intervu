import type { Page, Request } from '@playwright/test';
import { ONBOARDING_COMPLETED_STORAGE_KEY } from '../../../src/lib/jobs/onboarding-first-paint';
import { LOCAL_AI_RESUME_KEY } from '../../../src/lib/local-ai/resume-storage';
import { expect, test } from './fixtures';
import { answerListSearch, isListSearch } from './list-search';

/**
 * A saved search made from the résumé follows the résumé on the device, and none of the résumé's words
 * leave the device because of it: only the résumé's own search carries them, marked as never logged
 * (`fromResume`, or `sort=fit` on a count). Guest path: the résumé and the saved rows are seeded in localStorage.
 */
const RESUME = {
    profile: { name: 'Morgan Lee', profession: 'Technical Account Manager', yearsOfExperience: 9, location: 'Toronto, Ontario, Canada', email: 'morgan.lee.e2e@example.com', phone: '', linkedin: '', website: '' },
    experience: [{ id: 'exp1', company: 'Northwind Cloud', role: 'Technical Account Manager', dates: '2019 - Present', description: 'Owned adoption and renewals for enterprise accounts.' }],
    competencies: [{ category: 'Skills', skills: ['Customer Success', 'Salesforce'] }],
    education: [{ id: 'edu1', degree: 'B.Eng.', institution: 'State University', year: '2015' }],
    generatedSummary: 'Technical Account Manager in enterprise SaaS.',
};
const RESUME_WORD = 'Technical Account Manager';
// What the row stored when it was saved, from an earlier résumé: it must never stand in for the current terms.
const STORED_Q = '"Gardener" OR "Beekeeper"';
const ROWS = [
    { id: '1', name: STORED_Q, href: `?q=${encodeURIComponent(STORED_Q)}&sort=fit`, createdAt: '2026-10-20T00:00:00.000Z', origin: 'resume' },
    { id: '2', name: 'designer', href: '?q=designer', createdAt: '2026-10-20T00:00:00.000Z' },
];

const POSTING = {
    id: '11111111-0000-4000-8000-000000000001', title: 'Product Manager', company: 'Harbor Pay', company_domain: null, location: 'Toronto, ON',
    location_city: 'Toronto', location_state: 'Ontario', location_country: 'Canada', work_type: 'hybrid', description: null, employment_type: 'full_time',
    experience_level: 'mid', salary_min: null, salary_max: null, salary_currency: null, salary_period: null, visa_sponsorship: null, tags: [],
    apply_url: 'https://example.com/apply', source: 'journey', posted_at: new Date(Date.now() - 86_400_000).toISOString(), first_seen_at: null,
    updated_at: null, vacancy_status: 'open', ghost_badge: 'unscored',
};

type Seen = { kind: 'list' | 'action'; body: string; step: string };

/** Marked = the never-logged résumé search: a list search with `fromResume`, or a count whose search is `sort=fit`. */
const marked = (s: Seen) => (s.kind === 'list' ? /"fromResume":\s*true/.test(s.body) : /"sort"\s*:\s*"fit"/.test(s.body));
/** The board's own read of "when was this population last updated" for the search the visitor started: same words as Rank by fit sends today, writes no log row. */
const isFreshnessProbe = (s: Seen) => s.kind === 'action' && !s.body.includes('"scope"') && s.body.startsWith('[{"q"');
const carriesResumeWords = (s: Seen) => s.body.includes(RESUME_WORD) || s.body.includes('Gardener') || s.body.includes('Beekeeper');

async function open(page: Page) {
    const seen: Seen[] = [];
    let step = 'load';
    page.on('request', (req: Request) => {
        if (req.method() !== 'POST') return;
        const path = new URL(req.url()).pathname;
        const body = req.postData() ?? '';
        if (path === '/api/jobs/search') seen.push({ kind: 'list', body, step });
        else if (req.headers()['next-action']) seen.push({ kind: 'action', body, step });
    });
    await page.addInitScript(
        ([resumeKey, onboardKey, resume, rows]) => {
            localStorage.setItem(onboardKey as string, '1');
            localStorage.setItem(resumeKey as string, JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: 'e2e-synthetic' }));
            localStorage.setItem('intervu.saved-searches', JSON.stringify(rows));
        },
        [LOCAL_AI_RESUME_KEY, ONBOARDING_COMPLETED_STORAGE_KEY, RESUME, ROWS] as const,
    );
    // The list's first page answers with one role in the browser only (the search itself still runs), so the results line and its alert switch render.
    await page.route('**/*', (route) => {
        const req = route.request();
        const body = req.postData() ?? '';
        if (!isListSearch(req) || !body.includes('"withFacets":true') || !body.includes('"offset":0')) return route.fallback();
        return answerListSearch(route, { hits: [POSTING], total: 1, backend: 'meilisearch', configured: true, searchId: 'journey-privacy' });
    });
    await page.goto('/jobs?q=product%20manager&posted=any', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('saved-search-item').first()).toBeVisible({ timeout: 45_000 });
    return { seen, setStep: (s: string) => { step = s; } };
}

const resumeChip = (page: Page) => page.getByTestId('saved-search-item').filter({ hasText: 'Résumé keywords' });

test.describe('saved search from the résumé — no résumé word leaves the device on its own', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('load, alert toggle and idle send none; applying the chip is the marked résumé search', { tag: ['@J-ALERTS-51'] }, async ({ page }) => {
        const { seen, setStep } = await open(page);
        // Load: the typed row is counted (control, so the probe can see a count), the résumé row is not.
        await expect.poll(() => seen.filter((s) => s.kind === 'action' && s.body.includes('"scope":"saved"') && s.body.includes('designer')).length, { timeout: 30_000 }).toBeGreaterThan(0);
        await expect(resumeChip(page)).toBeVisible();
        await page.waitForTimeout(2000);
        expect(seen.filter(carriesResumeWords), 'load').toEqual([]);
        await expect(resumeChip(page).locator('xpath=..').getByTestId('saved-search-new-count')).toHaveCount(0);

        // Alert toggle on a typed search (a guest opens the email form).
        setStep('alert');
        await page.getByTestId('search-alert-switch').getByText('Job alert', { exact: true }).click({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        expect(seen.filter((s) => s.step === 'alert').filter(carriesResumeWords), 'alert toggle').toEqual([]);

        // Idle.
        setStep('idle');
        await page.waitForTimeout(4000);
        expect(seen.filter((s) => s.step === 'idle'), 'idle').toEqual([]);

        // Apply: a search the visitor started. It carries the current words, marked; the address does not.
        setStep('apply');
        await resumeChip(page).click();
        await expect.poll(() => seen.filter((s) => s.step === 'apply' && s.kind === 'list' && s.body.includes(RESUME_WORD)).length, { timeout: 30_000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1500);
        const applied = seen.filter((s) => s.step === 'apply' && carriesResumeWords(s));
        expect(applied.length).toBeGreaterThan(0);
        for (const s of applied.filter((a) => !isFreshnessProbe(a))) {
            expect(marked(s), `${s.kind} carrying résumé words must be marked: ${s.body.slice(0, 400)}`).toBe(true);
            expect(s.body, 'the stored terms never stand in').not.toMatch(/Gardener|Beekeeper/);
        }
        // The résumé's chip is counted now, marked: the board is on the résumé's own search.
        expect(applied.some((s) => s.kind === 'action' && s.body.includes('"scope":"saved"') && marked(s))).toBe(true);
        expect(page.url()).not.toContain('Technical');
        expect(decodeURIComponent(page.url())).not.toContain(RESUME_WORD);

        // Alert toggle on the résumé's own search: still nothing unmarked.
        setStep('alert2');
        await page.getByTestId('search-alert-switch').getByText('Job alert', { exact: true }).click({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        expect(seen.filter((s) => s.step === 'alert2' && carriesResumeWords(s) && !marked(s))).toEqual([]);
    });
});
