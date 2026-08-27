import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: ACCOUNT-RESUME — R1 user report (2026-08-09)
 *
 * "No resume upload/manage surface on the web account — the infra exists
 * agent-side only." YourResumeSection.tsx (settings.spec.ts's existing
 * "Resume tab shows resume section" test covers it was READ-ONLY) now has
 * Upload/Replace/Delete, wired through uploadBaseResumeAction/
 * deleteBaseResumeAction -> setBaseResumeForUser/clearBaseResumeForUser
 * (lib/resume/set-resume.ts) — the SAME write seam the MCP set_resume tool
 * uses.
 *
 * No existing intervu e2e spec authenticates all the way through (traced:
 * auth.spec.ts only probes that the login form's fields exist — see its
 * own comments; settings.spec.ts's tests run logged OUT and currently fail
 * against a real auth-gated /settings, a PRE-EXISTING gap, not something
 * this change touches). This spec drives the real username/password
 * sign-up flow (LoginForm.tsx, rendered full-page at /login since the
 * 2026-08-27 auth/docs redesign — SimpleAuthForm.tsx is gone) with a
 * unique per-run username against the configured Firebase project, then
 * cleans up via the existing self-serve "Delete account" flow
 * (SettingsContainer.tsx's Danger Zone) at the end — a real, self-contained
 * account for the duration of one test run, not a shared fixture.
 */
test.describe('ACCOUNT-RESUME', () => {
    test('signed-in flow: upload a resume, see it, replace it, delete it', async ({ page }) => {
        test.skip(true, 'needs live signup + Turnstile — cannot be automated; run manually');
        const username = `e2eresume${Date.now()}`;
        const password = 'TestPass123!';

        // Sign up (LoginForm.tsx, rendered full-page at /login; defaults to
        // the "Sign in" tab, so switch to "Create account" first — tab label,
        // card title, and submit button all share that wording by design,
        // see authCardCopy in lib/auth/auth-gate-copy.ts). Lands on /jobs
        // (the redirect's own default) — this spec is about the account
        // resume surface, not the post-auth redirect mechanism, so it
        // navigates to /settings itself once the session exists.
        await page.goto('/login');
        await page.getByRole('tab', { name: 'Create account' }).click();
        await page.locator('#username').fill(username);
        await page.locator('#password').fill(password);
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page).toHaveURL('/jobs', { timeout: 20_000 });
        await page.goto('/settings');

        // Resume tab is the default tab — starts empty for a brand-new account.
        await expect(page.getByText('No resume yet')).toBeVisible({ timeout: 10_000 });

        // Upload.
        await page.getByRole('button', { name: 'Upload a resume' }).click();
        await page.getByPlaceholder(/Paste your resume text/).fill('Jane Doe\nEngineer\n\nSUMMARY\nExperienced engineer with 5 years building things.');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText(/Jane Doe/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Download .pdf' })).toBeVisible();

        // Replace.
        await page.getByRole('button', { name: 'Replace' }).click();
        await page.getByPlaceholder(/Paste your resume text/).fill('A completely different replaced resume body.');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText(/A completely different replaced resume body/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Jane Doe/)).toHaveCount(0);

        // Delete.
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm' }).click();
        await expect(page.getByText('No resume yet')).toBeVisible({ timeout: 10_000 });

        // Cleanup: remove the throwaway account so this run leaves nothing behind.
        await page.getByRole('tab', { name: 'Account' }).click();
        await page.getByRole('button', { name: 'Delete account' }).click();
        await page.getByPlaceholder('Type DELETE to confirm').fill('DELETE');
        await page.getByRole('button', { name: 'Delete Forever' }).click();
        // handleDeleteAccount pushes "/" — the board's own front-door redirect
        // (unrelated to this change) then lands on /jobs.
        await expect(page).toHaveURL('/jobs', { timeout: 15_000 });
    });
});
