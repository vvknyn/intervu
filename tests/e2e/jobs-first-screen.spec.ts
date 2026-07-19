import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-FIRST-SCREEN - /jobs renders on first paint, no entry gate
 *
 * Grows across the /jobs redesign tasks. Task 4 removes the JobsEntryGate
 * ask/choose screens entirely — mode now starts at "browse" and the results
 * UI is the only render path, so job rows (or an honest empty/error state)
 * must appear with zero interaction.
 *
 * Environment-tolerant like jobs-search-polish.spec.ts: this suite runs
 * against a real dev server, and Meilisearch may or may not be configured
 * there. Assertions never depend on which branch is active except the
 * negative gate check, which must hold either way.
 *
 * Structural, not text-based: a later task adds an upsell card containing
 * wording similar to the old gate's ("Upload résumé"), so the negative
 * assertion below targets the gate's distinctive CTA button — "No, I'll
 * search", which existed ONLY on the deleted ASK screen — never job-adjacent
 * copy that a future card could also contain.
 */

// Task 12 review fix — warm the dev server's /jobs route ONCE before any
// test in this file runs. Turbopack's dev-mode compile cache can be wiped
// (observed: "filesystem cache has been deleted because we previously
// detected an internal error"), and the very first hit after that pays a
// full cold compile — enough to blow a normal test's assertion timeout,
// while every hit afterward is fast (same process, cache now warm). That
// was landing as a flaky/hard-failing FIRST test in this file — not a
// product regression (the same assertion passes reliably once warm) and not
// something a longer per-test timeout should paper over everywhere. Pay the
// cold-compile cost exactly once, here, with a timeout generous enough to
// absorb it, before the real tests (and their normal timeouts) run.
test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
        await page.goto('/jobs');
        await page
            .locator('[data-job-row]')
            .or(page.getByText(/being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/temporarily unavailable/i))
            .first()
            .waitFor({ state: 'visible', timeout: 60_000 });
    } finally {
        await page.close();
    }
});

test.describe('JOBS-FIRST-SCREEN - gate-free entry', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* private mode / storage disabled */
            }
        });
    });

    test('anonymous first paint shows job rows — no gate, no interaction', async ({ page }) => {
        await page.goto('/jobs');

        // Structural gate check: the ASK screen's "No, I'll search" button
        // must never render — it existed only in JobsEntryGate, now deleted.
        await expect(page.getByRole('button', { name: /No, I.?ll search/i })).toHaveCount(0);

        // Results render on first paint, no click/type required: an actual job
        // row (JobRow carries `data-job-row`), or — tolerant of an unconfigured
        // Meilisearch in this environment — one of the honest empty/error
        // surfaces the results view falls back to. Never the gate.
        const resultsOrEmpty = page
            .locator('[data-job-row]')
            .or(page.getByText(/being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/temporarily unavailable/i))
            .first();
        await expect(resultsOrEmpty).toBeVisible({ timeout: 10_000 });
    });

    test('legacy entry key is cleaned up', async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.setItem('intervu.jobs.entry', JSON.stringify({ mode: 'browse' }));
            } catch {
                /* private mode / storage disabled */
            }
        });
        await page.goto('/jobs');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => localStorage.getItem('intervu.jobs.entry'))).toBeNull();
    });

    test("deep link reconstructs the exact screen", async ({ page }) => {
        await page.goto("/jobs?q=engineer&work=remote&posted=7d&salary=150k");
        await expect(page.getByRole("textbox").first()).toHaveValue("engineer");
        // Active filter chips reflect the URL (chip text per existing chips loop at page.tsx:1254-1263):
        await expect(page.getByText("Remote", { exact: false }).first()).toBeVisible();
    });

    test("opening a job pushes a URL; back closes the detail", async ({ page }) => {
        await page.goto("/jobs");
        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await page.goBack();
        await expect(page).not.toHaveURL(/job=/);
    });

    test("refresh reproduces the same results state", async ({ page }) => {
        await page.goto("/jobs?posted=7d");
        const countBefore = await page.getByText(/roles|results/i).first().textContent();
        await page.reload();
        await expect(page.getByText(/roles|results/i).first()).toHaveText(countBefore ?? "");
    });

    /**
     * Reviewer finding (Task 5 review): only `job` was re-derived from the URL
     * after mount — q/facets/salaryMin/visaOnly/postedBucket/sort/hideGhosts
     * were seeded once and never reconciled on history navigation. Reachable
     * drift: open a job (push adds a history entry on top of `?q=engineer`) →
     * edit the query to "designer" (replace rewrites only the TOP entry) →
     * press Back → the URL reverts to `?q=engineer` but the screen kept
     * showing "designer". The fix makes the URL the reactive source for every
     * parsed field, not just `job`, so Back always matches the address bar.
     */
    test("back after opening a job and editing the query restores the URL's query, not the edited one", async ({ page }) => {
        await page.goto("/jobs?q=engineer");
        const searchInput = page.getByRole("textbox").first();
        await expect(searchInput).toHaveValue("engineer");

        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await expect(page).toHaveURL(/q=engineer/);

        // Replace rewrites only the top history entry (the job-open one) —
        // this is the drift the reviewer flagged.
        await searchInput.fill("designer");
        await expect(searchInput).toHaveValue("designer");
        await expect(page).toHaveURL(/q=designer/);

        await page.goBack();
        await expect(page).toHaveURL(/q=engineer/);
        await expect(page).not.toHaveURL(/q=designer/);
        await expect(searchInput).toHaveValue("engineer");
    });

    /**
     * Class coverage, not just the `q` instance: the same drift is reachable
     * through a filter mutation. Open a job (push → `?job=`), then apply the
     * "Last week" posted-bucket filter from the rail (replace, on top of the
     * push — mirroring the reviewer's push-then-replace pattern for a
     * non-`q` field, carrying `job=` along since `buildUrlState()` defaults
     * `jobId` to whatever the URL currently holds). Back must unwind past
     * BOTH: the URL reverts to the bare `/jobs` entry, and the screen must
     * match — no `posted` filter, no active chip, no open detail. Starts
     * from the unfiltered default view (always has rows, per the "anonymous
     * first paint" test above) rather than a pre-filtered URL, so this test
     * isn't sensitive to how many roles currently fall in the 7-day bucket.
     */
    test("back after opening a job and applying a posted-bucket filter restores the prior state", async ({ page }) => {
        await page.goto("/jobs");
        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await expect(page).not.toHaveURL(/posted=/);

        const postedButton = page
            .getByRole("region", { name: "Job filters" })
            .getByRole("button", { name: "Last week" });
        await postedButton.click();
        await expect(page).toHaveURL(/posted=7d/);
        await expect(page).toHaveURL(/job=/); // replace preserves the open job
        await expect(page.getByTestId("active-filter-chip").filter({ hasText: "Last week" })).toBeVisible();

        await page.goBack();
        await expect(page).not.toHaveURL(/posted=7d/);
        await expect(page).not.toHaveURL(/job=/);
        await expect(page.getByTestId("active-filter-chip")).toHaveCount(0);
    });

    /**
     * TASK 6 — Trust toolbar: corpus-count placeholder, freshness stamp, fit sort.
     */
    test("placeholder carries the live corpus count", async ({ page }) => {
        await page.goto("/jobs");
        // Captured off the first real search response (250ms debounce + a live
        // Meilisearch round-trip, never a dedicated count request — see
        // controller resolution #2), so a synchronous `getAttribute()` right
        // after `goto()` races it. Poll instead, matching this file's own
        // 10s allowance for other real-backend assertions above.
        await expect
            .poll(() => page.getByRole("textbox").first().getAttribute("placeholder"), { timeout: 10_000 })
            .toMatch(/Search [\d,]+ live-checked roles/);
    });

    test("freshness stamp renders relative age", async ({ page }) => {
        await page.goto("/jobs");
        // `formatRelativeAge` (Task 3, locked — see its own unit test) formats
        // "6 min ago" WITH a space before the unit but "2h ago"/"3d ago"
        // WITHOUT one. `\s?` (not a mandatory literal space) covers both.
        await expect(page.getByText(/updated (just now|\d+\s?(min|h|d)?\s?ago)/i)).toBeVisible();
    });

    // Resolution #4: the sort control's accessible name is "Sort results"
    // (SelectTrigger's aria-label at page.tsx) — not the visible text "Sort:",
    // which jobs-search-polish.spec.ts's TC-JOBS-SORT-001/002 already target
    // via `getByRole('combobox', { name: /Sort results/i })`. Mirrored here.
    test("sort menu offers Rank by fit", async ({ page }) => {
        await page.goto("/jobs");
        await page.getByRole("combobox", { name: /Sort results/i }).click();
        await expect(page.getByText("Rank by fit", { exact: false })).toBeVisible();
    });

    /**
     * TASK 7 — Filter rail: promotion, More group, ghost toggle, 1024px
     * threshold. 1100px sits between the OLD xl (1280px) and NEW lg (1024px)
     * thresholds, so this specifically proves the rail moved to lg — it would
     * fail under the pre-Task-7 xl:-gated rail. No click required: first paint
     * must already show it (mirrors TC-JOBS-LAYOUT-002 in
     * jobs-search-polish.spec.ts, which asserts the same thing pinned to the
     * 1024px boundary itself).
     */
    test("desktop 1100px shows the filter rail with the ghost toggle, no click needed", async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 800 });
        await page.goto("/jobs");

        const filters = page.getByRole("region", { name: "Job filters" });
        await expect(filters).toBeVisible();
        await expect(filters.getByRole("checkbox", { name: /Hide likely-ghost/i })).toBeVisible();
    });

    /**
     * TASK 8 — Row badges + résumé upsell card. Anonymous session, no
     * résumé on hand, so the card is expected on first paint (gate =
     * NOT dismissed AND NOT resumeIsUsable(local resume state)).
     */
    test("upsell card shows once and dismissal survives reload", async ({ page }) => {
        await page.goto("/jobs");
        // "Upload your résumé" is the ResumeUpsellCard's own distinctive CTA
        // text (verified unique on this page) — not tied to the exact
        // "match against N roles" / "match roles" wording, which varies
        // depending on whether the honest corpus count has resolved yet.
        const card = page.getByText("Upload your résumé", { exact: false });
        await expect(card).toBeVisible();
        await page.getByRole("button", { name: /dismiss|✕/i }).first().click();
        await expect(card).not.toBeVisible();
        await page.reload();
        await expect(page.getByText("Upload your résumé", { exact: false })).not.toBeVisible();
    });

    // Resolution #2: `formatRelativeAge` (Task 3, locked) has no space before
    // the h/d unit ("2h ago"/"3d ago") but does before "min" ("6 min ago"),
    // and "just now" under 60s. The regex below matches exactly those three
    // shapes plus "just now" — no bare `\d+ ?ago` catch-all.
    //
    // Staleness fix: `badgeFor` only renders "✓ live" when a row's
    // `updated_at` is within `STALE_THRESHOLD_MS` of now (freshness.ts) —
    // past that it renders the neutral "checked {age}" instead, so it makes
    // no liveness claim data this old can't back. Which prefix renders here
    // depends on how fresh the live jobs index actually is at test time, so
    // this assertion accepts either prefix — it still proves a `clear` row
    // renders a real age-bearing badge, just not which side of the
    // threshold today's data happens to fall on.
    test("clear rows carry an age-bearing freshness badge", async ({ page }) => {
        await page.goto("/jobs");
        await expect(
            page.getByText(/(✓ live|checked) (just now|\d+ min ago|\d+h ago|\d+d ago)/).first(),
        ).toBeVisible();
    });

    // TASK 9 — Typeahead. The results pane already has its own always-mounted
    // `role="listbox" aria-label="Job results"` (browse mode), so an
    // unqualified `getByRole("listbox")` (the brief's literal snippet — it
    // carries no `.first()`) strict-mode-fails: 2 elements match. Naming the
    // query after the dropdown's own `aria-label="Search suggestions"` fixes
    // that collision — it can only match the element under test. The
    // `.or([data-suggestions])` is kept only for forward-compat with a
    // future local-source (no `suggest` prop) caller that might mark its
    // dropdown that way instead; it never matches today.
    test("typing shows suggestions; Enter searches without a full page reload", async ({ page }) => {
        await page.goto("/jobs");
        const box = page.getByRole("textbox").first();
        await box.fill("engineer");
        await expect(
            page.getByRole("listbox", { name: "Search suggestions" }).or(page.locator("[data-suggestions]"))
        ).toBeVisible();
        await expect(page).toHaveURL(/q=engineer/);

        // A marker on `window` distinguishes "no reload" from "reload": a
        // full page navigation gets a fresh JS context and wipes this,
        // whereas an App Router client transition (or no navigation at all,
        // if the URL is already correct — see the same-URL guard in
        // `applyUrlState`, page.tsx) does not. The URL alone can't tell
        // these apart, since it ends up `?q=engineer` either way.
        await page.evaluate(() => {
            (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker = true;
        });
        await box.press("Enter");
        await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeHidden();
        await expect(page).toHaveURL(/q=engineer/);
        expect(
            await page.evaluate(() => (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker),
        ).toBe(true);
    });

    // TASK 9 review fix — the CRITICAL push contract had vacuous coverage:
    // typing already writes `?q=X` via `replace`, so asserting the URL alone
    // around an Enter press can't tell push from a no-op (in fact, for a
    // plain Enter with nothing changed since typing, push IS now correctly a
    // no-op — see the same-URL guard in `applyUrlState`). Picking a
    // suggestion is the scenario that genuinely exercises `push`: the
    // suggestion's text differs from what was typed, so the target can never
    // equal the URL the guard is comparing against. Verified empirically
    // (throwaway diagnostic, not committed) against the real dev server:
    // `window.history.length` increments by exactly 1 across ArrowDown+Enter
    // here, and stays flat across a plain typed Enter.
    test("ArrowDown then Enter selects a suggestion and pushes a new history entry", async ({ page }) => {
        await page.goto("/jobs");
        const box = page.getByRole("textbox").first();
        await box.fill("eng");
        const listbox = page.getByRole("listbox", { name: "Search suggestions" });
        await expect(listbox).toBeVisible();

        const firstOption = listbox.getByRole("option").first();
        const suggestionText = ((await firstOption.textContent()) ?? "").trim();
        expect(suggestionText.length).toBeGreaterThan(0);
        // A real title/company from the live index for a 3-char substring
        // essentially never comes back as literally "eng" — this is the
        // divergence the push-vs-no-op distinction depends on.
        expect(suggestionText.toLowerCase()).not.toBe("eng");

        const historyLengthBeforeSelect = await page.evaluate(() => window.history.length);
        await box.press("ArrowDown");
        await box.press("Enter");

        await expect(box).toHaveValue(suggestionText);
        await expect.poll(() => page.evaluate(() => window.history.length)).toBeGreaterThan(
            historyLengthBeforeSelect,
        );

        // Back lands on the pre-selection ("eng") state, not a fully cleared
        // query — proving a genuine new entry was pushed on top, not a
        // replace of the typed-state entry.
        await page.goBack();
        await expect(box).toHaveValue("eng");
    });

    /**
     * TASK 11 — Empty states + dead-link tombstone.
     *
     * "zzzzunfindablezzz" + a $200k salary floor is chosen to reliably
     * produce zero hits against the live corpus without depending on its
     * exact contents. `activeFilterEntries` (FilterPanel.tsx) is the single
     * source for the empty state's clear-chips — same list that drives the
     * toolbar chips and the mobile sheet — so a salaryMin filter here always
     * yields at least one chip. Targets the chip's own `data-testid`
     * (review fix) rather than `/Clear/i` text — that regex was already
     * satisfied pre-change by the pre-existing toolbar "Clear all" button,
     * so it never actually proved OUR chip rendered.
     */
    test("zero results names the excluders and offers ghost reveal", async ({ page }) => {
        await page.goto("/jobs?q=zzzzunfindablezzz&salary=200k");
        await expect(page.getByText("No roles match.")).toBeVisible();
        await expect(page.getByTestId("empty-state-clear-chip").first()).toBeVisible();
    });

    /**
     * A `job` id absent from the live corpus (never assigned, or long since
     * removed) — the URL is otherwise a plain browse, so the default
     * unfiltered fetch loads real rows and the detail pane's "not found in
     * loaded hits" gap (Task 5) is what this exercises. No takedown date is
     * ever asserted — `PublicJob` (lib/jobs/types.ts) carries no per-job
     * takedown timestamp.
     *
     * INFRA CONTEXT (not pinned as expected behavior — 2nd review fix):
     * the tombstone is meant to render only once a targeted existence check
     * (`searchJobsAction({ id, limit: 1 })`) POSITIVELY confirms the id is
     * gone (`classifyExistenceCheck`, lib/jobs/result-state.ts — requires a
     * complete `meilisearch` backend, no error note, zero hits; anything
     * else, including today's live 400 on `id = ...` — verified 2026-07-19,
     * Meilisearch's primary key isn't auto-filterable on this index yet —
     * classifies "unknown"). This test does NOT assert the tombstone is
     * absent: pinning that would lock in the current infra gap as
     * "expected" and go red — for the RIGHT reason — the moment someone
     * fixes it, inviting a well-meaning revert of the very fix this whole
     * review thread exists to land. What it DOES assert, which holds
     * regardless of which side of that infra gap the check resolves on: a
     * dead id must NEVER render a DIFFERENT job's detail as though it were
     * the linked one (the original bug), and the pane must always show
     * SOME acknowledgment the visitor asked about a specific role, never a
     * silent blank (the regression the non-assertive `DeadJobUnresolved`
     * state below was added to fix).
     */
    test("dead job link never renders a different job's detail in its place", async ({ page }) => {
        await page.goto("/jobs?job=nonexistent-id-12345");
        // Real rows load (proves the page didn't just stall) …
        await expect(page.locator("[data-testid=job-row]").first()).toBeVisible({ timeout: 10_000 });
        // … but the detail pane never claims a specific job for this id —
        // its accessible name stays the generic "Job details" (see the
        // `detailJob ? "Job details: …" : "Job details"` aria-label),
        // never naming an unrelated job the way the original bug did. This
        // holds whether the existence check lands on "not_found" (the
        // tombstone) or "unknown"/"checking" (`DeadJobUnresolved`) — neither
        // branch ever sets `detailJob`.
        await expect(page.getByRole("region", { name: "Job details", exact: true })).toBeVisible();
        // The pane is never silently blank either way: either the tombstone
        // or the neutral "can't confirm" state renders, both carrying the
        // same "See similar roles"/"Browse live roles" CTA.
        await expect(
            page.getByText("This role is no longer available.")
                .or(page.getByText("Can't confirm this role's status right now."))
                .or(page.getByText("Checking this role…")),
        ).toBeVisible({ timeout: 15_000 });
    });

    /**
     * Round-3 review fix — proves the "dead id's one free pass gets spent,
     * URL clears" branch (`shouldClearDeadLinkUrl`, lib/jobs/result-state.ts;
     * called from the search effect in page.tsx) actually executes in a
     * real browser. This is a direct response to two prior rounds where a
     * fix was reported done while its own guard condition could never be
     * true — first an e2e that asserted a CTA without ever clicking it,
     * then this exact predicate shipped as a self-contradiction
     * (`!wasConfirmed && alreadyUsedItsPass`, impossible given
     * `wasConfirmed`'s own definition). A unit test on the extracted
     * predicate proves the LOGIC; this proves page.tsx actually WIRES it —
     * a genuinely dead id, left in the URL, must have `job=` cleared once a
     * SECOND search still can't find it (its first fetch already spent the
     * one free "preserve" pass; see `firstUnresolvedDeadLinkIdRef`).
     */
    test("dead id's job= param clears from the URL once a second search still can't find it", async ({ page }) => {
        const deadId = `nonexistent-id-urlclear-${Date.now()}`;
        await page.goto(`/jobs?job=${deadId}`);
        // Fetch 1 resolves (real rows load) — grants the id its one free pass.
        await expect(page.locator("[data-testid=job-row]").first()).toBeVisible({ timeout: 10_000 });
        await expect(page).toHaveURL(new RegExp(`job=${deadId}`));

        // A NEW search changes searchKey, firing fetch 2 with the SAME dead
        // id still the previous selection (typing never touches `job=`).
        const box = page.getByPlaceholder(/live-checked roles/i);
        await box.fill("engineer");
        await expect(page).toHaveURL(/q=engineer/);

        // Fetch 2 still can't find it → the pass is already spent →
        // shouldClearDeadLinkUrl(true, false) → the URL converges to
        // ambient browsing, `job=` gone, `q=engineer` preserved.
        await expect(page).not.toHaveURL(new RegExp(`job=${deadId}`), { timeout: 15_000 });
        await expect(page).toHaveURL(/q=engineer/);
    });

    /**
     * Whole-branch review fix — a DIFFERENT way the URL can drift, never
     * covered by the dead-link test above: open a real, live job (confirmed
     * present in the current hits, not a dead id), then narrow the search so
     * that SAME job no longer matches. `resolveSelectionAfterRefresh` falls
     * straight to its `hits[0]`-or-null fallback here — `wasConfirmed` is
     * `true` on the very first look (the job WAS just confirmed present), so
     * this never touches the dead-link "free pass" machinery at all, and the
     * OLD narrow `shouldClearDeadLinkUrl(alreadyUsedItsPass, foundInFreshHits)`
     * guard could never fire for it (`alreadyUsedItsPass` is always `false`
     * here) — `job=<excluded-id>` stayed stuck in the address bar while the
     * pane silently moved on, so sharing that URL reproduced a job the
     * recipient's own filters exclude. `shouldClearStaleJobUrl` is the fix;
     * this proves page.tsx actually wires it for THIS case, not just the
     * dead-link one above.
     *
     * Deliberately queries "engineer" rather than a guaranteed-zero-hit
     * string: investigating this fix surfaced a separate, PRE-EXISTING
     * timing sensitivity in how quickly a browser reflects two
     * closely-spaced `router.replace()` calls when the query also collapses
     * results to literally zero (a full EmptyResults re-render lands at the
     * same moment as the URL write) — reproducible on the unmodified
     * `shouldClearDeadLinkUrl` mechanism too when engineered into that same
     * zero-hit shape, so it's a Next.js router characteristic orthogonal to
     * this fix, not something introduced here. "engineer" keeps the result
     * set non-empty (broad, real corpus term) while still excluding the
     * specific just-opened row, which is what this test needs to isolate.
     */
    test("a query change that excludes the open job clears job= from the URL, not just the detail pane", async ({ page }) => {
        await page.goto("/jobs");
        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        const openedId = new URL(page.url()).searchParams.get("job");
        expect(openedId).toBeTruthy();

        const box = page.getByPlaceholder(/live-checked roles/i);
        await box.fill("engineer");
        // The replace-on-type carries `job=<openedId>` forward (buildUrlState
        // defaults jobId to whatever the URL currently holds) — the drift is
        // only visible once the debounced re-search actually resolves below.
        await expect(page).toHaveURL(/q=engineer/);

        await expect(page).not.toHaveURL(new RegExp(`job=${openedId}(&|$)`), { timeout: 20_000 });
        await expect(page).toHaveURL(/q=engineer/);
    });
});

/**
 * TASK 10 — Mobile: chips row, sheet live count, detail sticky bar.
 *
 * Below-lg viewport (390x844). The chips row absorbs the old standalone
 * mobile "Filters" button (see jobs-search-polish.spec.ts's
 * TC-JOBS-LAYOUT-002B, updated in the same commit) — its "All (n)" chip now
 * opens a bottom Sheet with a live, debounced result count instead of the
 * old bounded inline overlay.
 */
test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("chips row is visible and opens the sheet with a live count", async ({ page }) => {
        await page.goto("/jobs");
        await expect(page.getByText("All (", { exact: false })).toBeVisible();
        await page.getByText("All (", { exact: false }).click();
        await expect(page.getByRole("button", { name: /Show [\d,]+ roles/ })).toBeVisible();
    });

    // Review fix (2026-07-19): the original version read `applyBtn.textContent()`
    // immediately after opening — inside the 250ms debounce window — so it
    // compared the value `openFilterSheet` SEEDED (from `result?.total`,
    // before any edit) to itself. It could not fail. This rewrite actually
    // edits a pending filter inside the sheet, waits for the button's number
    // to change (proof the debounced re-count fired), THEN applies and checks
    // the applied page shows that same (post-edit) number.
    test("sheet count reflects a debounced pending-filter change and matches the applied result", async ({ page }) => {
        await page.goto("/jobs");
        await page.getByText("All (", { exact: false }).click();

        const applyBtn = page.getByRole("button", { name: /Show [\d,]+ roles/ });
        await expect(applyBtn).toBeVisible();
        const seeded = (await applyBtn.textContent())!.replace(/\D/g, "");

        // Toggle a PENDING filter inside the sheet — resolution #3: this must
        // only move the debounced count, never the applied page behind it.
        await page
            .getByRole("region", { name: "Job filters" })
            .getByRole("button", { name: "Last week" })
            .click();

        // Poll until the button's number actually changes from the open-time
        // seed — the debounce is 250ms plus a real round trip.
        await expect
            .poll(async () => (await applyBtn.textContent())?.replace(/\D/g, ""), { timeout: 10_000 })
            .not.toBe(seeded);
        const settled = (await applyBtn.textContent())!.replace(/\D/g, "");

        await applyBtn.click();
        // Wait for the sheet to fully leave the DOM before reading the
        // applied page's count — Radix's exit animation keeps the closing
        // sheet (and the just-read `settled` text inside it) mounted for a
        // beat, and a same-text page-wide search could otherwise match that
        // stale, departing element instead of the real applied-page count.
        await expect(page.getByRole("button", { name: /Show [\d,]+ roles/ })).toHaveCount(0);
        await expect(
            page.getByText(new RegExp(`${Number(settled).toLocaleString()}|${settled}`)).first(),
        ).toBeVisible();
    });

    // Resolution #5: exact scroll restoration is flaky under the list's
    // virtualization/infinite-scroll, so this asserts a <200px tolerance
    // rather than pixel-exact equality.
    test("system back closes detail and preserves scroll", async ({ page }) => {
        await page.goto("/jobs");
        await page.mouse.wheel(0, 1500);
        const y = await page.evaluate(() => window.scrollY);
        await page.locator("[data-testid=job-row], main li").nth(5).click();
        await page.goBack();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(200);
    });
});
