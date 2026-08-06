import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-FIRST-SCREEN - /jobs renders on first paint, no entry gate
 *
 * Task 4 removed the JobsEntryGate ask/choose screens entirely, and they must
 * stay gone. What replaced "rows on first paint" is a single ask screen that
 * carries the real search line (see the first two tests): the first screen now
 * asks for a role instead of listing the corpus, so most tests below state an
 * intent in the URL before they can assert on the ledger. `posted=any` is the
 * intent of choice — it leaves the query empty and the default sort intact,
 * which several tests measure.
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
        await page.goto('/jobs?posted=any');
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
    /**
     * RETIRED 2026-07-25 — four tests that opened a job and then edited the
     * query or filters. That journey no longer exists: the detail sheet is
     * modal, so with it open the background is unreachable (a modal marks the
     * page aria-hidden and its overlay eats pointer events), and closing it
     * clears `job=` from the URL — measured `?posted=any&job=03a588a4…` →
     * `?posted=any`. A deep link keeps `job=` on first load by design (the
     * dead-id "one free pass"), so the second client-side search those tests
     * needed cannot be reached from the UI at all.
     *
     * They were failing for that reason, not for a defect. `shouldClearStaleJobUrl`
     * and `resolveSelectionAfterRefresh` remain live — page.tsx calls them on every
     * fetch — and keep their unit coverage in tests/unit/jobs-result-state.test.ts,
     * which is the right level for pure predicates anyway. The narrower
     * `shouldClearDeadLinkUrl` had no call site left at all and was deleted with them.
     */

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* private mode / storage disabled */
            }
        });
    });

    /**
     * First paint asks for a role rather than listing the corpus.
     *
     * This inverts what this test asserted before (rows with zero
     * interaction). The old JobsEntryGate is still gone and still must not
     * come back — the negative check below is unchanged and is the point:
     * asking for a role is ONE screen with the real search line on it, not the
     * deleted two-step ask/choose gate that made people pick a lane before
     * seeing anything.
     *
     * The absence of rows is the load-bearing assertion: an empty query no
     * longer runs the corpus-wide, facet-computing browse that every cold
     * visit used to pay for. (A single lightweight corpus probe still runs, for
     * the placeholder's count — hence no claim here about zero requests.)
     */
    test('anonymous first paint asks for a role — no gate, no ledger', async ({ page }) => {
        await page.goto('/jobs');

        // Structural gate check: the ASK screen's "No, I'll search" button
        // must never render — it existed only in JobsEntryGate, now deleted.
        await expect(page.getByRole('button', { name: /No, I.?ll search/i })).toHaveCount(0);

        await expect(page.getByTestId('jobs-ask')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-job-row]')).toHaveCount(0);

        // The search line is the one input, and it holds focus — the ask
        // deliberately ships no box of its own.
        await expect(page.getByPlaceholder(/What kind of work/i)).toBeFocused();
    });

    test('typing a role leaves the ask and reveals the ledger', async ({ page }) => {
        await page.goto('/jobs');
        await expect(page.getByTestId('jobs-ask')).toBeVisible({ timeout: 10_000 });

        await page.getByPlaceholder(/What kind of work/i).fill('engineer');

        // Rows, or one of the honest empty/error surfaces if Meilisearch isn't
        // configured in this environment — but never the ask, which has been
        // answered.
        await expect(
            page
                .locator('[data-job-row]')
                .or(page.getByText(/No roles match/i))
                .or(page.getByText(/being connected/i))
                .or(page.getByText(/temporarily unavailable/i))
                .first(),
        ).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('jobs-ask')).toHaveCount(0);
    });

    test('legacy entry key is cleaned up', async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.setItem('intervu.jobs.entry', JSON.stringify({ mode: 'browse' }));
            } catch {
                /* private mode / storage disabled */
            }
        });
        await page.goto('/jobs?posted=any');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => localStorage.getItem('intervu.jobs.entry'))).toBeNull();
    });

    test("deep link reconstructs the exact screen", async ({ page }) => {
        await page.goto("/jobs?q=engineer&work=remote&posted=7d&salary=150k");
        await expect(page.getByRole("textbox").first()).toHaveValue("engineer");
        // Portal redesign: individual active-filter chips no longer render in
        // a toolbar row (consolidated into the "All filters (N)" pill — see
        // the "back after opening a job and applying a filter" test below).
        // The URL→state round-trip for a facet is instead proven by its
        // effect: every returned card is remote (workLoc line, JobCard in
        // page.tsx), OR — zero hits — the empty state's own clear-chip names
        // it ("Clear Remote", activeFilterEntries via EmptyResults). Either
        // way "Remote" is on the page; which branch fires depends only on
        // whether the live corpus has a remote "engineer" match right now.
        await expect(page.getByText("Remote", { exact: false }).first()).toBeVisible();
    });

    test("opening a job pushes a URL; back closes the detail", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const firstRow = page.getByTestId("job-row").first();
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
     * TASK 6 — Trust toolbar: corpus-count placeholder, freshness stamp, fit sort.
     */
    test("placeholder asks what kind of work the user wants", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await expect(page.getByRole("textbox").first()).toHaveAttribute(
            "placeholder",
            /What kind of work/i,
        );
    });

    test("freshness stamp renders relative age", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        // `formatRelativeAge` (Task 3, locked — see its own unit test) formats
        // "6 min ago" WITH a space before the unit but "2h ago"/"3d ago"
        // WITHOUT one. `\s?` (not a mandatory literal space) covers both.
        await expect(page.getByText(/updated (just now|\d+\s?(min|h|d)?\s?ago)/i)).toBeVisible();
    });

    // Portal redesign rewrite: the "Sort results" combobox (with its own
    // "Rank by fit" dropdown item) is gone — sort is now three plain
    // `SortSegment` buttons (page.tsx: freshest / top pay / best match, see
    // jobs-search-polish.spec.ts's TC-JOBS-SORT-001/002). "The old Match mode
    // is gone: 'Rank by fit' is no longer a [dropdown option]" per page.tsx's
    // own comment — with no query, "best match" IS the résumé-rank action
    // (`chooseBestMatch` → `handleRankByFit`), which for an anonymous session
    // with no résumé on hand falls through to the résumé importer
    // (`confirmLabel="Rank my jobs"` is that same flow's own continuation).
    /**
     * "Best match" with no query needs a résumé to rank against, so it starts
     * the résumé-rank journey. For a signed-out visitor that journey begins at
     * the AUTH gate, not the import dialog — `handleUploadClick` queues the
     * upload intent and calls `openAuth()` when there is no user (page.tsx),
     * and only replays it once they are in.
     *
     * This test asserted the import dialog directly, which is the state AFTER
     * authentication; anonymously it could only ever see the auth popover.
     * Measured: clicking it here opens a dialog reading "Authentication / Log
     * In / Sign Up". Asserting the gate keeps the real contract under test —
     * the click starts the journey rather than doing nothing.
     */
    test("best match with no query starts the résumé-rank journey (auth gate first)", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await page.getByRole("button", { name: "best match" }).click();
        const gate = page.getByRole("dialog");
        await expect(gate).toBeVisible();
        await expect(gate).toContainText(/Log ?In|Sign ?Up|Authentication/i);
    });

    // Task 6/7 + the Jul 24 incident fix (fd42534): the fresh-visit default
    // filter is `posted=30d`, kept OFF the URL and out of the "All filters"
    // pill's count (`activeFilterEntries` treats the default as a resting
    // state, not a user override — FilterPanel.tsx) so it doesn't read as an
    // active choice. The one place it must still be visible is the sheet's
    // own Date Posted presets, where "Last 30 days" should show as selected.
    test("All filters sheet reflects the 30d posted-date default when supported", async ({ page }) => {
        // A query, not `posted=any`: the posted-date default is exactly what
        // this test measures, so stating intent with a posted filter would
        // overwrite its subject. A query reaches the ledger without touching it.
        await page.goto('/jobs?q=engineer');
        await expect(page).not.toHaveURL(/posted=/);
        await expect(page.getByTestId("filters-toggle")).toBeVisible();

        await page.getByTestId("filters-toggle").click();
        const filters = page.getByTestId("filters-panel");
        await expect(filters).toBeVisible();

        const last30 = filters.getByRole("radio", { name: "Past month" });
        if ((await last30.count()) === 0) {
            test.skip(true, "Corpus carries no posted_ts — age buckets hidden (isPostedDateFilterSupported)");
            return;
        }
        await expect(last30).toHaveAttribute("aria-pressed", "true");
    });

    /**
     * TASK 7 — Filter rail history: promotion, More group, ghost toggle.
     * Portal redesign rewrite: the always-visible lg+ rail this test used to
     * pin at 1100px is gone at EVERY width now — filters live only behind
     * the pills row's "All filters" sheet (FilterChipsRow, the old rail
     * component, is dead code — not rendered anywhere in page.tsx; see
     * jobs-search-polish.spec.ts's TC-JOBS-LAYOUT-002). This now proves the
     * inverse: no filters region without a click, then the ghost toggle
     * inside the sheet once opened.
     */
    test("desktop 1100px: filters live behind the All filters sheet, ghost toggle included", async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 800 });
        await page.goto('/jobs?posted=any');

        await expect(page.getByTestId("filters-panel")).toHaveCount(0);
        const trigger = page.getByTestId("filters-toggle");
        await expect(trigger).toBeVisible();
        await trigger.click();

        const filters = page.getByTestId("filters-panel");
        await expect(filters).toBeVisible();
        await expect(filters.getByRole("checkbox", { name: /Hide likely-ghost/i })).toBeVisible();
    });

    /**
     * TASK 8 — Row badges + résumé upsell card. Anonymous session, no
     * résumé on hand, so the card is expected on first paint (gate =
     * NOT dismissed AND NOT resumeIsUsable(local resume state)).
     */
    test("upsell card shows once and dismissal survives reload", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        // "upload résumé" is the ResumeUpsellCard's own distinctive CTA text
        // (editorial-pass restyle: "upload résumé →", verified unique on this
        // page) — not tied to the exact "match against N roles" / "match
        // roles" wording, which varies depending on whether the honest
        // corpus count has resolved yet.
        const card = page.getByText(/upload résumé/i);
        await expect(card).toBeVisible();
        await page.getByRole("button", { name: /dismiss|✕/i }).first().click();
        await expect(card).not.toBeVisible();
        await page.reload();
        await expect(page.getByText(/upload résumé/i)).not.toBeVisible();
    });

    // Editorial-pass rewrite: the row badge is now the ledger's compact
    // VERDICT CELL (page.tsx `verdictFor`/`shortAge`) — "LIVE · 2H" / "CHECKED
    // · 3D" / "LIVE"/"CHECKED" with no age at all — not the portal pass's
    // prose "✓ live 2h ago"/"checked 2h ago". `shortAge` mirrors
    // `formatRelativeAge`'s own bucketing (freshness.ts) in a dense uppercase
    // form: "NOW", "{n}M" (minutes), "{n}H", "{n}D" — no unit suffix.
    //
    // Staleness fix: `verdictFor` only renders "LIVE" when a row's
    // `updated_at` is within `STALE_THRESHOLD_MS` of now (freshness.ts) —
    // past that it renders the neutral "CHECKED" instead, so it makes
    // no liveness claim data this old can't back. Which prefix renders here
    // depends on how fresh the live jobs index actually is at test time, so
    // this assertion accepts either prefix — it still proves a `clear` row
    // renders a real age-bearing verdict, just not which side of the
    // threshold today's data happens to fall on.
    test("clear rows carry an age-bearing freshness badge", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await expect(
            page.getByText(/(LIVE|CHECKED) · (NOW|\d+M|\d+H|\d+D)/).first(),
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
        await page.goto('/jobs?posted=any');
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
        await page.goto('/jobs?posted=any');
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
        await page.goto("/jobs?posted=any&job=nonexistent-id-12345");
        // Real rows load (proves the page didn't just stall) …
        await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 10_000 });
        // … but the detail sheet never claims a specific job for this id —
        // its accessible name (the sr-only `SheetTitle`) stays the generic
        // "Job details" (see the `detailJob ? \`${title} at ${company}\` :
        // "Job details"` text at page.tsx), never naming an unrelated job the
        // way the original bug did. Detail now opens exclusively via the
        // bottom Sheet (role="dialog", Radix wires aria-labelledby to
        // SheetTitle) at every breakpoint — no more inline "region". This
        // holds whether the existence check lands on "not_found" (the
        // tombstone) or "unknown"/"checking" (`DeadJobUnresolved`) — neither
        // branch ever sets `detailJob`.
        await expect(page.getByRole("dialog", { name: "Job details", exact: true })).toBeVisible();
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
     * Search field chrome: nothing drawn inside the field may sit on top of
     * where its text starts.
     *
     * `SearchAutocomplete` reserves room for anything it paints over the field
     * with left padding on the `<input>` itself. Padding is a shared Tailwind
     * axis, so a caller that restyles the field at all — the editorial pass
     * flattened it to a bare ruled line with `px-0` — silently wins the
     * `tailwind-merge` conflict and deletes that reservation, leaving the glyph
     * stacked on the first word of the placeholder. Nothing failed; the class
     * list just quietly lost `pl-12`.
     *
     * So this asserts the INVARIANT rather than the absence of one particular
     * glyph: measure where the input's text actually begins (its own computed
     * padding) and require every glyph the field paints over itself to end
     * before that. Re-adding a leading icon is fine — re-adding one whose space
     * isn't reserved, by any route (px-0, a smaller pl-*, a bigger icon), fails
     * here. Dropdown glyphs are excluded by construction: the filter keeps only
     * boxes that overlap the input's own line vertically.
     */
    test("no glyph painted over the search field overlaps where its text starts", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const box = page.getByPlaceholder(/What kind of work/i);
        await expect(box).toBeVisible();

        const collisions = await box.evaluate((el) => {
            const input = el as HTMLInputElement;
            const field = input.getBoundingClientRect();
            const textStartsAt = field.left + parseFloat(getComputedStyle(input).paddingLeft);
            const container = input.parentElement;
            if (!container) return [];
            return [...container.querySelectorAll("svg")]
                .map((glyph) => ({ glyph, rect: glyph.getBoundingClientRect() }))
                .filter(({ rect }) => rect.width > 0 && rect.height > 0)
                // On the field's own line, not the dropdown stacked below it.
                .filter(({ rect }) => rect.top < field.bottom && rect.bottom > field.top)
                .filter(({ rect }) => rect.right > textStartsAt && rect.left < field.right)
                .map(({ rect }) => `glyph ends at x=${Math.round(rect.right)}, text starts at x=${Math.round(textStartsAt)}`);
        });

        expect(collisions).toEqual([]);
    });
});

/**
 * TASK 10 — Mobile: filter sheet trigger, sheet live count, detail sticky bar.
 *
 * Below-lg viewport (390x844). Portal redesign superseded Task 10's own
 * mobile-only chips row ("All (n)") — FilterChipsRow is dead code, not
 * rendered anywhere in page.tsx. The pills row's "All filters" pill is now
 * the ONE filter-sheet trigger at every breakpoint, mobile included; it
 * still opens the same bottom Sheet with a live, debounced result count.
 */
test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("filters toggle is visible and opens the panel", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const toggle = page.getByTestId("filters-toggle");
        await expect(toggle).toBeVisible();
        await expect(page.getByTestId("jobs-toolbar")).toBeVisible();
        await toggle.click();
        await expect(page.getByTestId("filters-panel")).toBeVisible();
    });

    test("filters panel applies a salary filter immediately", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await page.getByTestId("filters-toggle").click();

        const panel = page.getByTestId("filters-panel");
        await expect(panel).toBeVisible();

        await panel.getByText("$200k+").click();
        await expect(page).toHaveURL(/salary=/, { timeout: 10_000 });
    });

    test("search query and location inputs do not overlap on mobile", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const queryBox = page.getByPlaceholder(/What kind of work/i);
        const locationBox = page.getByTestId("location-input");
        await expect(queryBox).toBeVisible();
        await expect(locationBox).toBeVisible();

        const queryRect = await queryBox.boundingBox();
        const locationRect = await locationBox.boundingBox();
        expect(queryRect).toBeTruthy();
        expect(locationRect).toBeTruthy();
        expect(locationRect!.y).toBeGreaterThanOrEqual(queryRect!.y + queryRect!.height - 2);
    });

    // Resolution #5: exact scroll restoration is flaky under the list's
    // virtualization/infinite-scroll, so this asserts a <200px tolerance
    // rather than pixel-exact equality.
    test("system back closes detail and preserves scroll", async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await page.mouse.wheel(0, 1500);
        const y = await page.evaluate(() => window.scrollY);
        await page.getByTestId("job-row").nth(5).click();
        await page.goBack();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(200);
    });
});
