import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journey for the page shell staying put once it paints — see
 * tests/journeys/CATALOG.md (J-NAV-39). Read-only.
 *
 * The auth and analytics providers load after the page does. They used to
 * wrap the page when they arrived, which made React throw the page away and
 * rebuild it: every route went blank for about 300ms right after first paint,
 * then repainted and re-ran its mount fetches. Here a sampler notes, on every
 * animation frame from first paint, whether the <main> landmark is there and
 * whether it is still the same element.
 */

const WATCH_MS = 5_000;

for (const path of ["/pricing", "/jobs"]) {
  test(`${path} stays on screen after it paints: the page is never blanked or rebuilt as the deferred providers load`, { tag: ["@J-NAV-39"] }, async ({ page, diagnostics }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
    await page.addInitScript((watchMs) => {
      const log: string[] = [];
      (window as unknown as { __shellLog: string[] }).__shellLog = log;
      const t0 = performance.now();
      let seen: Element | null = null;
      let current: Element | null = null;
      const tick = () => {
        const main = document.querySelector("main");
        if (main !== current) {
          const at = Math.round(performance.now() - t0);
          if (!main && seen) log.push(`blank at ${at}ms`);
          else if (main && seen && main !== seen) log.push(`rebuilt at ${at}ms`);
          current = main;
          if (main) seen = main;
        }
        if (performance.now() - t0 < watchMs) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, WATCH_MS);

    await page.goto(path);
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
    // Past the window the providers mount in (after load, then idle).
    await page.waitForTimeout(WATCH_MS + 500);

    const log = await page.evaluate(() => (window as unknown as { __shellLog: string[] }).__shellLog);
    expect(log).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
  });
}
