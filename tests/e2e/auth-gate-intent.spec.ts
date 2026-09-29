import { test, expect, type Page } from "@playwright/test";
import { test as authedTest, expect as authedExpect } from "./helpers/auth-gate";
import { PENDING_ACTION_STORAGE_KEY } from "../../src/lib/jobs/pending-actions";

/**
 * Logged-out coverage for the one auth gate (`useAuthGate`, see
 * src/components/auth/use-auth-gate.ts): a signed-out visitor who triggers a
 * gated action (Apply, Report) must have that intent survive both return
 * paths — the in-place login case is covered by the unit tests in
 * tests/unit/pending-actions.test.ts, so this spec exercises the one thing
 * only a real browser can prove: the hard-nav WorkOS AuthKit round trip.
 *
 * No account creation, no real login — every test here intercepts the
 * navigation to /auth/start before it leaves the page, and asserts against
 * what the gate persisted to sessionStorage and what it put in the `next`
 * param, never against a real WorkOS session.
 */

async function openFirstJobWithApplyButton(page: Page) {
    const rows = page.getByTestId("job-row");
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
        await rows.nth(i).click();
        const applyButton = page.getByRole("button", { name: /sign in to apply|^apply$/i }).first();
        if (await applyButton.isVisible().catch(() => false)) {
            return applyButton;
        }
    }
    throw new Error("no job row in the first 10 exposed an Apply control — board may be empty");
}

/** Reads `pathname + search + hash` straight from the browser so the
 *  assertion never has to know /jobs's own query-param names (`q`, `job`,
 *  ...) — see `buildReturnTo` in pending-actions.ts, which this mirrors. */
async function currentReturnTo(page: Page): Promise<string> {
    return page.evaluate(() => window.location.pathname + window.location.search + window.location.hash);
}

async function readPersistedPendingAction(page: Page) {
    const raw = await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_ACTION_STORAGE_KEY);
    expect(raw, "gate() should have persisted a pending action to sessionStorage before opening the auth modal").toBeTruthy();
    return JSON.parse(raw as string) as { action: { kind: string }; returnTo: string; createdAt: number };
}

/** Intercepts the hard navigation `startAuthKit` fires (`window.location.href
 *  = "/auth/start?..."`) so the test never actually leaves the page or talks
 *  to WorkOS — the request URL is all we need to assert the `next` param. */
async function interceptAuthStart(page: Page): Promise<() => string | null> {
    let intercepted: string | null = null;
    await page.route("**/auth/start**", async (route) => {
        intercepted = route.request().url();
        await route.abort();
    });
    return () => intercepted;
}

test.describe("AUTH-GATE - pending action survives a hard-nav OAuth round trip", () => {
    test("signed-out Apply persists the action and the /auth/start next param matches the current page", async ({ page }) => {
        await page.goto("/jobs?q=engineer");
        await page.waitForLoadState("networkidle");

        const applyButton = await openFirstJobWithApplyButton(page);
        const expectedReturnTo = await currentReturnTo(page);
        expect(expectedReturnTo).toContain("q=engineer");

        const getIntercepted = await interceptAuthStart(page);
        await applyButton.click();

        const googleButton = page.getByRole("button", { name: /continue with google/i });
        await expect(googleButton).toBeVisible();

        const persisted = await readPersistedPendingAction(page);
        expect(persisted.action.kind).toBe("apply");
        expect(persisted.returnTo).toBe(expectedReturnTo);

        await googleButton.click();
        await expect.poll(getIntercepted, { message: "expected a request to /auth/start" }).not.toBeNull();

        const nextParam = new URL(getIntercepted() as string).searchParams.get("next");
        expect(nextParam).toBeTruthy();
        expect(nextParam).toBe(expectedReturnTo);
    });
});

/** A minimal signed-in `ServerUser` for `window.__INTERVU_E2E_AUTH__` — see
 *  the "Set by Playwright addInitScript in e2e" comment on that global in
 *  `lib/firebase/client-auth.ts`. Only `uid` is load-bearing here: it's
 *  enough for `getCurrentUser()`/`onAuthChange` to answer "signed in"
 *  synchronously, with no real WorkOS session or `/api/auth/session` call. */
const E2E_MOCK_USER = { uid: "e2e-auth-gate-intent-user" };

test.describe("AUTH-GATE - a persisted pending action replays on load (mocked sign-in, no real login)", () => {
    test("a persisted record with an unknown action kind opens nothing and logs no console error", async ({ page }) => {
        await page.goto("/jobs?q=engineer");
        await page.waitForLoadState("networkidle");

        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
            if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        page.on("pageerror", (err) => consoleErrors.push(err.message));

        // "explore" — a kind this file's own docstring says was removed
        // 2026-08-02 — is exactly the deploy-shape-drift a stale persisted
        // record can carry; `takePersistedPendingAction`'s validation must
        // drop it rather than handing an unrecognized kind to `runHandler`.
        const record = {
            action: { kind: "explore", payload: { id: "does-not-matter" } },
            returnTo: "/jobs",
            scrollY: 0,
            createdAt: Date.now(),
        };
        await page.addInitScript(
            ([key, rec, user]) => {
                window.sessionStorage.setItem(key as string, JSON.stringify(rec));
                (window as unknown as { __INTERVU_E2E_AUTH__: unknown }).__INTERVU_E2E_AUTH__ = user;
            },
            [PENDING_ACTION_STORAGE_KEY, record, E2E_MOCK_USER] as const,
        );

        await page.goto("/jobs");
        await page.waitForLoadState("networkidle");

        await expect(page.getByTestId("report-job-dialog")).toHaveCount(0);
        expect(page.url()).not.toContain("job=does-not-matter");
        expect(consoleErrors, `unexpected console error(s): ${consoleErrors.join(" | ")}`).toHaveLength(0);

        const raw = await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_ACTION_STORAGE_KEY);
        expect(raw, "a malformed record must still be cleared, not left to be retried").toBeNull();
    });
});

/**
 * The complementary, signed-in branch of the exact same decision
 * (`gate()` in use-auth-gate.ts: signed in -> run the handler immediately,
 * never persist, never open the modal). Needs a REAL WorkOS session, so it
 * only runs when one is supplied out-of-band — see helpers/auth-gate.ts.
 * Without E2E_STORAGE_STATE this whole block is skipped with that reason,
 * never faked with a synthetic cookie/session.
 */
authedTest.describe("AUTH-GATE - signed-in Apply never opens the gate", () => {
    authedTest("a real signed-in session performs Apply directly, with no auth modal and nothing persisted", async ({ page, context }) => {
        const popups: Page[] = [];
        context.on("page", (p) => popups.push(p));

        await page.goto("/jobs?q=engineer");
        await page.waitForLoadState("networkidle");

        const applyButton = page.getByRole("button", { name: /^apply$/i }).first();
        const rows = page.getByTestId("job-row");
        const count = await rows.count();
        let found = false;
        for (let i = 0; i < Math.min(count, 10) && !found; i++) {
            await rows.nth(i).click();
            found = await applyButton.isVisible().catch(() => false);
        }
        authedExpect(found, "no job exposed a signed-in Apply control in the first 10 rows").toBe(true);

        await applyButton.click();

        const googleButton = page.getByRole("button", { name: /continue with google/i });
        await authedExpect(googleButton).not.toBeVisible();

        const raw = await page.evaluate((key) => window.sessionStorage.getItem(key), PENDING_ACTION_STORAGE_KEY);
        authedExpect(raw, "a signed-in Apply must never persist a pending action").toBeNull();

        for (const popup of popups) await popup.close().catch(() => {});
    });
});
