import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

/**
 * AUDIT ONLY — throwaway spec, not part of the suite. Drives the real /jobs
 * UI (production server on :3000) exactly as a job seeker would: type a
 * query, wait for the debounced search, read what actually rendered. Writes
 * results to audit-ui-results.json for the audit report. Never asserts —
 * this measures, it does not gate CI.
 */

interface RowSnap {
  title: string;
  company: string;
}

async function readTopRows(page: Page, n = 5): Promise<RowSnap[]> {
  const rows = page.locator('[data-testid="job-row"]');
  const count = await rows.count();
  const out: RowSnap[] = [];
  for (let i = 0; i < Math.min(count, n); i++) {
    const row = rows.nth(i);
    const title = (await row.locator('[data-testid="job-title"]').first().textContent().catch(() => "")) ?? "";
    const text = (await row.textContent().catch(() => "")) ?? "";
    out.push({ title: title.trim(), company: text.trim().slice(0, 160) });
  }
  return out;
}

async function resultCount(page: Page): Promise<string> {
  const el = page.locator('[data-testid="result-line"]').first();
  return (await el.textContent().catch(() => "")) ?? "";
}

const QUERIES = [
  "stripe",
  "walmart",
  "cleveland clinic",
  "home depot",
  "nurse",
  "registered nurse",
  "rn",
  "software engineer",
  "swe",
  "accountant",
  "acountant",
  "remote customer service jobs",
  "part time evening jobs",
  "warehouse jobs in dallas",
  "entry level marketing jobs",
  "jobs near me",
  "stripe software engineer",
  "nurse at cleveland clinic",
  "jobs paying $25 an hour",
];

test("audit: query battery through real UI", async ({ page }) => {
  test.setTimeout(300_000);
  const results: Record<string, unknown>[] = [];

  for (const q of QUERIES) {
    await page.goto(`http://localhost:3000/jobs?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
    // wait for the debounced search (250ms) + network + render
    await page.waitForTimeout(1800);
    const url = new URL(page.url());
    const rows = await readTopRows(page, 5);
    const count = await resultCount(page);
    const defaultLocationChip = await page.locator('[data-testid="default-location-chip"]').count();
    results.push({
      q,
      urlParams: Object.fromEntries(url.searchParams.entries()),
      defaultLocationChipShown: defaultLocationChip > 0,
      resultLine: count,
      top5: rows,
    });
    console.log(`Q="${q}" -> ${count} | top1: ${rows[0]?.title ?? "(none)"}`);
  }

  writeFileSync("audit-ui-results.json", JSON.stringify(results, null, 2));
});

test("audit: sticky-sort — click Newest after typing a company query", async ({ page }) => {
  await page.goto("http://localhost:3000/jobs?q=stripe", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const before = await readTopRows(page, 5);

  // Desktop sort control lives in the toolbar's `lg:flex` group (always
  // mounted, just hidden below `lg`); a separate `lg:hidden` copy exists for
  // mobile. `:visible` picks whichever one the current viewport shows.
  const freshestBtn = page.locator('button:visible', { hasText: /^freshest$/i }).first();
  const clicked = await freshestBtn
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  const afterUrl = new URL(page.url());
  const after = await readTopRows(page, 5);

  const out = {
    clickedFreshest: clicked,
    beforeSortClick: { top5: before },
    afterSortClick: { urlParams: Object.fromEntries(afterUrl.searchParams.entries()), top5: after },
  };
  writeFileSync("audit-sticky-sort.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
});

test("audit: type a NEW company query while Newest is already active (sticky-sort leak check)", async ({ page }) => {
  await page.goto("http://localhost:3000/jobs?q=software+engineer&sort=newest", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const urlAfterLoad = new URL(page.url());

  const box = page.locator('[data-search-line] input').first();
  await box.click();
  await box.fill("");
  await box.type("stripe", { delay: 40 });
  await page.waitForTimeout(1800);
  const urlAfterType = new URL(page.url());
  const rows = await readTopRows(page, 5);

  const out = {
    urlOnLoad: Object.fromEntries(urlAfterLoad.searchParams.entries()),
    urlAfterTypingNewQuery: Object.fromEntries(urlAfterType.searchParams.entries()),
    sortStillNewestAfterNewQuery: urlAfterType.searchParams.get("sort") === "newest",
    top5: rows,
  };
  writeFileSync("audit-sticky-sort-leak.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
});
