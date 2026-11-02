import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Interaction §9 (docs/design-language.md): every kind of interaction behaves one way, the way Claude's apps keep one
 * language on phone and desktop — see tests/journeys/CATALOG.md (J-HIG-11..13). Read-only: the search answer is
 * replaced in the browser, so no backend is needed.
 *
 * Measured before (2026-11-02, 390px): the sign-in, Filters and job drawers opened in 150ms, 500ms and 150ms, with
 * three header layouts (a 28px page title under a lone ×, a 16px bar title, a hand-built bar), three different ×s.
 */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Constructed postings (no real company). */
const posting = (n: number, company: string) => ({
  id: `66666666-0000-4000-8000-00000000000${n}`,
  title: ["Senior Product Manager, Platform", "Technical Product Owner", "Product Manager, Payments"][n - 1],
  company,
  company_domain: null,
  location: "Toronto, ON",
  work_type: "hybrid",
  employment_type: "full_time",
  experience_level: "senior",
  tags: [],
  apply_url: "https://example.com/apply",
  source: "journey",
  posted_at: new Date(Date.now() - 86_400_000 * n).toISOString(),
  vacancy_status: "open",
  ghost_badge: "unscored",
});

async function stubbedList(page: Page) {
  await returningVisitor(page);
  const hits = [posting(1, "Maple Relay"), posting(2, "Prairie Stack"), posting(3, "Birch Cloud")];
  await page.route("**/api/jobs/search", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-interaction" }) }),
  );
  await page.goto("/jobs?q=product+manager");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
}

type Drawer = { enterMs: number; radius: string; left: number; bottomGap: number; titleLeft: number; titleType: string; closeTop: number; closeRight: number; closeSize: string };

/** Clicks `trigger`, reads the motion as the overlay starts, then its header once it has settled. */
async function openAndRead(page: Page, trigger: Locator): Promise<{ drawer: Drawer; dialog: Locator }> {
  await trigger.click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The open surface's animation-duration: what its entrance runs on, readable after the entrance has finished.
  const enterMs = await dialog.evaluate((el) => Math.round(parseFloat(getComputedStyle(el).animationDuration) * 1000));
  await page.waitForTimeout(600);
  const drawer = await dialog.evaluate((el, enter) => {
    const s = el.getBoundingClientRect();
    const close = [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Close" && b.getBoundingClientRect().width > 0)!;
    const c = close.getBoundingClientRect();
    // The header title: the first visible semibold text left of the × on the ×'s row.
    // Measured on the text itself (a Range), not the element's box, which may run under the ×.
    const textRect = (t: Element) => { const range = document.createRange(); range.selectNodeContents(t); return range.getBoundingClientRect(); };
    const title = [...el.querySelectorAll("p, h1, h2, h3, [data-slot$=title]")].find((t) => {
      const r = textRect(t);
      const cs = getComputedStyle(t);
      return r.width > 0 && r.height > 0 && (t.textContent ?? "").trim() !== "" && cs.fontWeight === "600" && r.top < c.bottom && r.bottom > c.top && r.right <= c.left;
    });
    const tcs = title ? getComputedStyle(title) : null;
    return {
      enterMs: enter,
      radius: getComputedStyle(el).borderTopLeftRadius,
      left: Math.round(s.left),
      bottomGap: Math.round(innerHeight - s.bottom),
      titleLeft: title ? Math.round(textRect(title).left - s.left) : -1,
      titleType: tcs ? `${tcs.fontSize}/${tcs.fontWeight}` : "none",
      closeTop: Math.round(c.top - s.top),
      closeRight: Math.round(s.right - c.right),
      closeSize: `${Math.round(c.width)}x${Math.round(c.height)}`,
    };
  }, enterMs);
  return { drawer, dialog };
}

test("on a phone every drawer is one drawer: same motion, inset, corner, header row and × (sign-in, Filters, job)", { tag: ["@J-HIG-11"] }, async ({ page, diagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the phone drawer");
  await stubbedList(page);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const read: Record<string, Drawer> = {};

  const signIn = await openAndRead(page, page.getByTestId("topbar-signin").first());
  read.signIn = signIn.drawer;
  await page.keyboard.press("Escape");
  await expect(signIn.dialog).toBeHidden();

  const filters = await openAndRead(page, page.getByTestId("filters-toggle").first());
  read.filters = filters.drawer;
  await page.keyboard.press("Escape");
  await expect(filters.dialog).toBeHidden();

  const job = await openAndRead(page, page.getByTestId("job-row").nth(1).getByTestId("job-title"));
  read.job = job.drawer;

  const values = Object.values(read);
  const first = values[0];
  for (const [name, d] of Object.entries(read)) {
    expect(d.enterMs, `${name} opens on the modal motion (280ms): ${JSON.stringify(read)}`).toBe(280);
    expect(d.titleType, `${name}'s header title`).toBe("16px/600");
    expect(d.left, `${name} floats 8px off the side`).toBe(8);
    expect(d.bottomGap, `${name} floats 8px off the bottom`).toBe(8);
    expect(d.radius, `${name}'s corner`).toBe(first.radius);
    expect(Math.abs(d.titleLeft - first.titleLeft), `${name}'s title edge: ${JSON.stringify(read)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(d.closeTop - first.closeTop), `${name}'s × from the top: ${JSON.stringify(read)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(d.closeRight - first.closeRight), `${name}'s × from the side: ${JSON.stringify(read)}`).toBeLessThanOrEqual(1);
    expect(d.closeSize, `${name}'s × size`).toBe(first.closeSize);
  }
  expect(diagnostics.pageErrors).toEqual([]);
});

test("every menu opens and closes on the popover motion, and a laptop dialog opens on the modal motion with the drawer's header", { tag: ["@J-HIG-12"] }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "laptop width");
  await stubbedList(page);
  for (const name of [/^Sort/, /Browse by field/]) {
    await page.getByRole("button", { name }).first().click();
    const menu = page.getByRole("menu").last();
    await expect(menu).toBeVisible();
    const enter = await menu.evaluate((el) => Math.round(parseFloat(getComputedStyle(el).animationDuration) * 1000));
    expect(enter, `${name} opens in 150ms`).toBe(150);
    // The way out: the same element marked closed runs the popover exit timing.
    const exit = await menu.evaluate((el) => {
      const probe = el.cloneNode(false) as HTMLElement;
      probe.setAttribute("data-state", "closed");
      probe.style.position = "fixed";
      document.body.append(probe);
      const ms = Math.round(parseFloat(getComputedStyle(probe).animationDuration) * 1000);
      probe.remove();
      return ms;
    });
    expect(exit, `${name} closes in 100ms`).toBe(100);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
  const { drawer } = await openAndRead(page, page.getByTestId("topbar-signin").first());
  expect(drawer.enterMs).toBe(280);
  expect(drawer.titleType).toBe("16px/600");
  expect(Math.abs(drawer.closeTop - 20)).toBeLessThanOrEqual(1);
  expect(Math.abs(drawer.closeRight - 16)).toBeLessThanOrEqual(1);
});

test("a list row and a tab-bar item answer a press with a fill; an inline action is underlined on a touch screen", { tag: ["@J-HIG-13"] }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "a touch screen");
  await stubbedList(page);
  // Headless Chromium never enters :active under an emulated touch (checked 2026-11-02 on a bare page: a held
  // touchStart leaves `div:active` unmatched), so a finger cannot be simulated here. Instead the journey asks the
  // page's own stylesheets which :active rule a press on the element would match, and that it paints a fill.
  const pressFills = (target: Locator) =>
    target.evaluate((el) => {
      const hits: string[] = [];
      const walk = (rules: CSSRuleList, parent: string) => {
        for (const r of Array.from(rules)) {
          if (r instanceof CSSStyleRule) {
            const sel = parent ? r.selectorText.replace(/&/g, parent) : r.selectorText;
            const fill = r.style.backgroundColor;
            if (sel.includes(":active") && fill && fill !== "transparent") {
              for (const part of sel.split(",")) {
                const rest = part.replace(/:active/g, "").trim();
                try {
                  if (rest && el.matches(rest)) hits.push(part.trim());
                } catch {
                  /* a selector this engine cannot match */
                }
              }
            }
            if (r.cssRules?.length) walk(r.cssRules, sel);
          } else if (r instanceof CSSMediaRule) {
            if (matchMedia(r.conditionText).matches) walk(r.cssRules, parent);
          } else if ("cssRules" in r && (r as CSSGroupingRule).cssRules) {
            walk((r as CSSGroupingRule).cssRules, parent);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules, "");
        } catch {
          /* a cross-origin sheet */
        }
      }
      return hits;
    });
  expect(await pressFills(page.getByTestId("job-row").nth(1)), "a pressed list row lights").not.toEqual([]);
  expect(await pressFills(page.locator("[data-mobile-tabbar] a").first()), "a pressed tab-bar item lights").not.toEqual([]);
  // An inline action carries an underline where there is no hover to find it.
  const action = page.locator(".text-action:visible").first();
  if (await action.count()) {
    expect(await action.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
  }
});
