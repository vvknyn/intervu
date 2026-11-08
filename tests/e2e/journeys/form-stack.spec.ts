import type { Page } from "@playwright/test";
import { auditWrapping } from "../helpers/wrap-audit";
import { expect, test } from "./fixtures";
import { isLocalOrigin } from "./signed-in";

/**
 * Journey for the email capture forms (see tests/journeys/CATALOG.md, J-ALERTS-49): the signed-out "Job alert" form
 * under the results line's switch and under an empty search, and the account's "Add an email for job alerts" prompt.
 * Each is one column at every width: the field takes the form's width, the security check (Turnstile's 300x65 box,
 * which cannot shrink) is on a line of its own, and the buttons are a row under it. They were a `flex flex-wrap`
 * form: the "Email me new jobs" button beside the widget, "Not now" alone under them and the field a capped box above
 * (founder screenshot of /jobs at 1180px, 2026-11-08).
 *
 * Read-only: Cloudflare's api.js is answered in the browser with a stub that draws a box of the real widget's size, so
 * nothing reaches Cloudflare and nothing is submitted. A build with no Turnstile site key draws no widget, and the
 * widget assertions skip with that reason; the field and the buttons are still measured.
 */

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** A widget the size Cloudflare draws (300x65), answered as soon as it renders. */
const WIDGET_STUB = `window.turnstile = { render: function (el, o) {
  var f = document.createElement("iframe"); f.title = "stub"; f.style.cssText = "width:300px;height:65px;border:1px solid #888;display:block"; el.appendChild(f);
  setTimeout(function () { o.callback("stub-token"); }, 0); return "w1"; }, reset: function () {}, remove: function () {} };`;

async function stubTurnstile(page: Page) {
  await page.route(TURNSTILE_API, (route) => route.fulfill({ contentType: "application/javascript", body: WIDGET_STUB }));
}

type Box = { x: number; y: number; width: number; height: number };

/** Where each part of one form is, measured in the page: the form's content box, its fields, the widget, and the buttons. */
async function layout(page: Page, formSelector: string) {
  return page.locator(formSelector).first().evaluate((form) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const cs = getComputedStyle(form);
    const r = form.getBoundingClientRect();
    return {
      form: { x: r.x + parseFloat(cs.paddingLeft), y: r.y, width: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), height: r.height },
      field: box(form.querySelector("input")!),
      widget: form.querySelector("[data-testid='turnstile-slot'] iframe") ? box(form.querySelector("[data-testid='turnstile-slot'] iframe")!) : null,
      buttons: Array.from(form.querySelectorAll("button")).map(box),
      viewport: window.innerWidth,
    };
  });
}

/** The same question for every form: field the form's width, widget alone on its line, buttons together under it. */
function expectOneColumn(l: Awaited<ReturnType<typeof layout>>) {
  expect(Math.abs(l.field.width - l.form.width), "the field takes the form's width").toBeLessThanOrEqual(2);
  const above = [l.field, ...(l.widget ? [l.widget] : [])];
  for (let i = 1; i < above.length; i++) expect(above[i].y, "each part starts below the one before").toBeGreaterThanOrEqual(above[i - 1].y + above[i - 1].height - 1);
  const buttonsTop = Math.min(...l.buttons.map((b) => b.y));
  const last = above[above.length - 1];
  expect(buttonsTop, "the buttons are under the field and the widget").toBeGreaterThanOrEqual(last.y + last.height - 1);
  // The buttons are an .action-row: below sm each line of them runs edge to edge (one button per line at 320px), from sm up they are one line of natural-width buttons from the form's left edge.
  const lines: Box[][] = [];
  for (const b of [...l.buttons].sort((a, c) => a.y - c.y)) {
    const line = lines.find((cells) => Math.abs(cells[0].y - b.y) <= 4);
    if (line) line.push(b);
    else lines.push([b]);
  }
  const edge = l.form.x + l.form.width;
  if (l.viewport < 640) {
    for (const line of lines) {
      expect(Math.abs(Math.min(...line.map((b) => b.x)) - l.form.x), "a line of buttons starts at the form's left edge").toBeLessThanOrEqual(2);
      expect(Math.abs(Math.max(...line.map((b) => b.x + b.width)) - edge), "a line of buttons runs to the form's right edge").toBeLessThanOrEqual(2);
    }
  } else {
    expect(lines.length, "the buttons share one line").toBe(1);
    expect(Math.abs(Math.min(...l.buttons.map((b) => b.x)) - l.form.x), "the buttons start at the form's left edge").toBeLessThanOrEqual(2);
  }
}

const formRows = (page: Page) => page.evaluate(auditWrapping).then((findings) => findings.filter((f) => f.kind === "form-row"));

test("a guest's Job alert form on /jobs is one column at 1180px: field full width, security check on its own line, buttons under it", { tag: ["@J-ALERTS-49"] }, async ({ page, baseURL, diagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own width; one project is enough");
  await page.setViewportSize({ width: 1180, height: 900 });
  await stubTurnstile(page);
  await page.route("**/api/search-alerts", (route) => route.fulfill({ status: 200, json: { ok: true } }));
  await page.goto("/jobs?q=engineer");
  const rows = page.getByTestId("job-row").first();
  // A local server in the cloud cannot reach the search index, so it draws no rows (and no Job alert switch): the fixture below measures the form there.
  if (isLocalOrigin(baseURL)) test.skip(!(await rows.waitFor({ timeout: 20_000 }).then(() => true, () => false)), "this server has no job index to search");
  await expect(rows).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("search-alert-switch").getByRole("switch", { name: /job alert/i }).click();
  const form = page.getByTestId("search-alert-capture");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("search-alert-submit")).toBeVisible();
  // Where the build has a site key the widget draws; where it has none the form is a field and its buttons.
  const widget = form.getByTestId("turnstile-slot").locator("iframe");
  await widget.waitFor({ timeout: 8_000 }).catch(() => {});
  expectOneColumn(await layout(page, "[data-testid='search-alert-capture'] form"));
  await expect.poll(() => formRows(page)).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const width of [1180, 768, 390, 320]) {
  test(`at ${width}px the Job alert form (both places it opens) and the account email prompt are one column`, { tag: ["@J-ALERTS-49"] }, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sets its own widths; one project is enough");
    test.skip(!isLocalOrigin(baseURL), "fixture pages exist only on a local server");
    await page.setViewportSize({ width, height: 900 });
    await stubTurnstile(page);
    const alert = await page.goto("/mock/search-alert");
    test.skip(alert?.status() === 404, "this server has no fixture pages");
    await expect(page.getByTestId("search-alert-case-results")).toBeVisible();
    await expect(page.getByTestId("search-alert-case-empty")).toBeVisible();
    for (const id of ["search-alert-case-results", "search-alert-case-empty"]) {
      const sel = `[data-testid='${id}'] form`;
      await page.locator(`${sel} [data-testid='turnstile-slot'] iframe`).waitFor({ timeout: 8_000 }).catch(() => {});
      expectOneColumn(await layout(page, sel));
    }
    await expect.poll(() => formRows(page)).toEqual([]);

    await page.goto("/mock/email-nudge");
    await expect(page.getByTestId("email-nudge-mock")).toBeVisible();
    for (let i = 0; i < 3; i++) expectOneColumn(await layout(page, `[data-testid='email-nudge-mock'] section:nth-of-type(${i + 1}) form`));
    await expect.poll(() => formRows(page)).toEqual([]);
  });
}
