import { expect, test } from "./fixtures";

/**
 * Journey for the header avatar's privacy rule — see tests/journeys/CATALOG.md (J-NAV-43).
 * Read-only. Dev-server only: the signed-in mock (__INTERVU_E2E_AUTH__) is ignored by production builds.
 *
 * A sign-in provider's profile photo is never loaded: fetching it would hand that company's image
 * server the visitor's IP address on every page. Only a Velai-hosted picture shows; anything else
 * (including forms a regex misreads but the browser follows off-site) falls back to initials.
 */

const PHOTO_HOST = "lh3.googleusercontent.com";
const EVIL_HOST = "evil.example";

const cases = [
    { name: "a remote https photo", pictureUrl: `https://${PHOTO_HOST}/a/photo.png`, host: PHOTO_HOST },
    { name: "a tab-split site path that the browser reads as another host", pictureUrl: `/\t/${EVIL_HOST}/p.png`, host: EVIL_HOST },
    { name: "a protocol-relative address", pictureUrl: `//${EVIL_HOST}/p.png`, host: EVIL_HOST },
];

async function signInAs(page: import("@playwright/test").Page, pictureUrl: string) {
    await page.addInitScript((url) => {
        (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
            uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", pictureUrl: url,
        };
    }, pictureUrl);
}

function localOnly(baseURL: string | undefined) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
    test.skip(!local, "the header avatar needs the dev-only __INTERVU_E2E_AUTH__ sign-in, which production builds ignore");
}

for (const { name, pictureUrl, host } of cases) {
    test(`header avatar with ${name}: initials, no <img>, no request to ${host}`, { tag: ["@J-NAV-43"] }, async ({ page, baseURL }) => {
        localOnly(baseURL);
        const requested: string[] = [];
        page.on("request", (r) => requested.push(r.url()));
        await signInAs(page, pictureUrl);
        await page.goto("/privacy");
        const avatar = page.getByTestId("topbar-avatar");
        await expect(avatar).toBeVisible({ timeout: 15_000 });
        await expect(avatar).toContainText("AL");
        await expect(avatar.locator("img")).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        expect(requested.filter((u) => u.includes(host))).toEqual([]);
    });
}

test("header avatar with a Velai-hosted picture: shows that <img>", { tag: ["@J-NAV-43"] }, async ({ page, baseURL }) => {
    localOnly(baseURL);
    await signInAs(page, "/velai-logo.png");
    await page.goto("/privacy");
    const avatar = page.getByTestId("topbar-avatar");
    await expect(avatar).toBeVisible({ timeout: 15_000 });
    await expect(avatar.locator("img")).toHaveAttribute("src", "/velai-logo.png");
});
