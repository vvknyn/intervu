import { test, expect } from "@playwright/test";

const MOCK_SURFACES = [
    "tracker",
    "history",
    "for-you",
    "search",
    "session-loading",
    "offline",
] as const;

for (const surface of MOCK_SURFACES) {
    test(`mock empty surface: ${surface}`, async ({ page }) => {
        await page.goto(`/mock/empty-states?surface=${surface}`);
        await expect(page.getByTestId(`mock-empty-${surface}`)).toBeVisible();
    });
}

test("session mock shares jobs-session-frame min-height shell", async ({ page }) => {
    await page.goto("/mock/empty-states?surface=session-loading");
    await expect(page.locator(".jobs-session-frame")).toBeVisible();
    await expect(page.getByTestId("jobs-session-loading")).toBeVisible();
});

test("mock empty surfaces respect reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/mock/empty-states?surface=session-loading");
    await expect(page.getByTestId("jobs-session-loading")).toBeVisible();
    await expect(page.getByText("Loading your session…")).toBeVisible();
});

test("404 keeps enter-reveal panel", async ({ page }) => {
    await page.goto("/mock/empty-states?surface=404");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
] as const) {
    test(`search mock keeps clear chip testid (${viewport.name})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/mock/empty-states?surface=search");
        await expect(page.getByTestId("empty-state-clear-chip")).toBeVisible();
    });
}
