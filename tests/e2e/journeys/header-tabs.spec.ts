import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from "../helpers/wcag-contrast";
import { expect, test } from "./fixtures";

/**
 * Journeys for the header nav — see tests/journeys/CATALOG.md (J-NAV-*). Read-only.
 *
 * The header's follow-alerts and tracker chips only render for a signed-in user, and the only
 * sign-in a spec can fake is the dev-only `window.__INTERVU_E2E_AUTH__` hook,
 * which a production build ignores. So this spec runs against a local dev
 * server and skips itself against any other origin.
 */

const FOLLOW = { domain: "acme.com", slug: "acme", displayName: "Acme", createdAt: "2026-09-01T00:00:00.000Z" };
const NEW_JOBS = Array.from({ length: 12 }, (_, i) => ({ id: `j${i}`, title: `Role ${i}`, posted_ts: Date.now() - i * 1000 }));

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

async function signInWithFollowAlerts(page: Page) {
  await page.addInitScript(
    ([key]) => {
      (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
        uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
        providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
      };
      localStorage.setItem(key, "1");
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
      const body = req.postData() ?? "";
      const res = await route.fetch();
      const text = await res.text();
      let out = text;
      if (body === "[]" && text.includes("User not authenticated")) out = flight({ data: [FOLLOW] });
      else if (body.startsWith('["') && body.includes("acme.com")) out = flight({ data: [{ domain: "acme.com", displayName: "Acme", jobs: NEW_JOBS }] });
      return route.fulfill({ response: res, body: out });
    },
  );
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test.beforeEach(({ baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "signed-in header needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
});

test("header follow-alerts count chip sits fully inside the header bar", { tag: ["@J-NAV-31"] }, async ({ page }) => {
  await signInWithFollowAlerts(page);
  await page.goto("/jobs");
  const chip = page.getByTestId("topbar-follow-alerts-count");
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const [header, box] = await Promise.all([page.locator('[data-region="header"]').boundingBox(), chip.boundingBox()]);
  expect(header).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(header!.x);
  expect(box!.y).toBeGreaterThanOrEqual(header!.y);
  expect(box!.x + box!.width).toBeLessThanOrEqual(header!.x + header!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(header!.y + header!.height);
});

/**
 * In-page: the element's text colour and its effective background as opaque
 * sRGB. Chrome may report oklch()/color-mix() computed values, so each layer is
 * resolved through a canvas; translucent layers are composited down the
 * ancestor chain. Throws when no opaque layer is found (no guessed backdrop).
 */
function resolveTextAndBackdrop(el: Element): { fg: [number, number, number]; bg: [number, number, number]; fontPx: number; fontWeight: number } {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
    [0, 1, 2].map((i) => Math.round(top[i] * top[3] + under[i] * (1 - top[3]))) as [number, number, number];
  const layers: [number, number, number, number][] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const layer = rgba(getComputedStyle(node).backgroundColor);
    if (layer[3] > 0) layers.push(layer);
    if (layer[3] === 1) break;
  }
  if (layers.length === 0 || layers[layers.length - 1][3] !== 1) throw new Error("no opaque backdrop found above element");
  let bg: [number, number, number] = [layers[layers.length - 1][0], layers[layers.length - 1][1], layers[layers.length - 1][2]];
  for (let i = layers.length - 2; i >= 0; i--) bg = over(layers[i], bg);
  const style = getComputedStyle(el);
  const fgRaw = rgba(style.color);
  return { fg: over(fgRaw, bg), bg, fontPx: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) };
}

/** WCAG 2.x AA: 4.5:1 for normal text, 3:1 for large (>= 24px, or >= 18.66px bold). */
const requiredRatio = (fontPx: number, fontWeight: number) => (fontPx >= 24 || (fontPx >= 18.66 && fontWeight >= 700) ? 3 : WCAG_AA_NORMAL_TEXT);

test("header count-chip text meets WCAG AA contrast against its real backdrop", { tag: ["@J-NAV-32"] }, async ({ page }) => {
  await signInWithFollowAlerts(page);
  await page.goto("/jobs");
  // Colours are read once, so a `transition-colors` fade must not be sampled mid-way.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const header = page.locator('[data-region="header"]');
  await expect(page.getByTestId("topbar-follow-alerts-count")).toBeVisible({ timeout: 30_000 });
  // Résumé and the Tracker count are lg-only, so they are measured when the header shows them.
  // The Tracker chip renders because the mock answers every empty-body action (follows AND applications) with one row.
  const targets = [
    page.getByTestId("topbar-follow-alerts-count"),
    ...((page.viewportSize()?.width ?? 0) >= 1024 ? [header.getByTestId("topbar-resume"), header.getByTestId("topbar-tracker-badge")] : []),
  ];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const m = await target.evaluate(resolveTextAndBackdrop);
    const ratio = contrastRatio(m.fg, m.bg);
    const label = await target.evaluate((el) => el.getAttribute("data-testid") ?? el.textContent ?? el.tagName);
    console.log(`contrast ${label}: ${ratio.toFixed(2)}:1 fg=${m.fg} bg=${m.bg} ${m.fontPx}px/${m.fontWeight}`);
    expect(ratio, `${label} contrast`).toBeGreaterThanOrEqual(requiredRatio(m.fontPx, m.fontWeight));
  }
});
