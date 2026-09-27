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
    const visibleStatus = page.getByTestId("jobs-session-loading-status");
    await expect(visibleStatus).toBeVisible();
    await expect(visibleStatus).toHaveText("Loading your session…");
    await expect(visibleStatus.locator(".bg-live")).toBeVisible();
});

test("404 mock keeps enter-reveal panel", async ({ page }) => {
    await page.goto("/mock/empty-states?surface=404");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator(".route-status-in-flow")).toBeVisible();
});

test("unknown route 404 keeps TopBar and single main landmark", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-615");
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.locator(".route-status-in-flow")).toBeVisible();
});

test("tracker mock empty card is centered and in optical upper third", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/mock/empty-states?surface=tracker");
    const card = page.getByTestId("yours-empty");
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/concept-a-empty-max/);
    await expect(page.locator(".concept-a-empty-page-slot--after-controls")).toBeVisible();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    const cardTop = box!.y;
    const cardCenterX = box!.x + box!.width / 2;
    expect(cardTop).toBeGreaterThan(48);
    expect(cardTop).toBeLessThan(viewport.height * 0.42);
    expect(Math.abs(cardCenterX - viewport.width / 2)).toBeLessThan(64);
});

for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
] as const) {
    test(`search mock keeps clear chip testid (${viewport.name})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/mock/empty-states?surface=search");
        await expect(page.getByTestId("search-empty-results")).toBeVisible();
        await expect(page.getByRole("heading", { name: "No roles match." })).toBeVisible();
        await expect(page.getByTestId("empty-state-clear-chip")).toBeVisible();
        await expect(page.locator(".concept-a-empty-max").first()).toBeVisible();
    });
}
