import type { Locator, Page } from "@playwright/test";
import { APPLY_SIGNED_OUT_LABEL } from "../../../src/components/jobs/job-detail-facts";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the control-height scale (globals.css `--control-h-sm|md|lg`):
 * controls that share a row share one step, at every width. The 44px touch
 * target is an invisible hit area, so the visual height is the same on a phone.
 * A button's type rides on the same step (globals.css `--control-text-*`,
 * painted by `.ctl-button`): 24px → 12px, 32px → 14px, 44px → 16px, all at 500.
 * See tests/journeys/CATALOG.md (J-NAV-07, J-NAV-33, J-NAV-34, J-NAV-38, J-JOBS-29, J-JOBS-30). Read-only.
 */

const MD = 32;
const LG = 44;

const CONTROLS = 'button, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, [role="tab"]';

/** Rendered heights of the row's visible controls matching `selector`, whole px. */
const controlHeights = (row: Locator, selector = CONTROLS) =>
    row
        .locator(selector)
        .evaluateAll((els) =>
            els
                .map((el) => el.getBoundingClientRect())
                .filter((r) => r.width > 0 && r.height > 0)
                .map((r) => Math.round(r.height)),
        );

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

for (const path of ["/jobs", "/trends", "/about"]) {
    test(`signed-out header on ${path}: one Sign in and no Create account button, on the md step`, { tag: ["@J-NAV-07", "@J-NAV-33"] }, async ({ page }) => {
        await page.goto(path);
        const signIn = page.getByTestId("topbar-signin");
        await expect(signIn).toHaveCount(1);
        await expect(page.getByTestId("topbar-create-account")).toHaveCount(0);
        await expect(signIn).toBeVisible({ timeout: 15_000 });
        expect(Math.round((await signIn.boundingBox())!.height)).toBe(MD);
    });
}

test("desktop header with a query: the docked search and Sign in share the md step", { tag: ["@J-NAV-33"] }, async ({ page, isMobile }) => {
    test.skip(isMobile, "the search docks into the header at lg and up only");
    await returningVisitor(page);
    await page.goto("/jobs?q=data+analyst");
    const row = ["topbar-docked-search", "topbar-signin"].map((id) => page.getByTestId(id));
    for (const l of row) await expect(l).toBeVisible({ timeout: 15_000 });
    const heights = await Promise.all(row.map(async (l) => Math.round((await l.boundingBox())!.height)));
    expect(heights).toEqual([MD, MD]);
});

test("/jobs search row: query, location and Search share the lg step", { tag: ["@J-JOBS-29"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs");
    const row = page.locator("[data-search-line]");
    await expect(row.getByTestId("search-submit")).toBeVisible({ timeout: 15_000 });
    // The inline clear glyphs sit inside the fields on the sm step; every other control is the row.
    await expect.poll(() => controlHeights(row, `:is(${CONTROLS}):not([data-testid$="-clear"])`)).toEqual([LG, LG, LG]);
});

test("/jobs toolbar: every control in the row takes the md step", { tag: ["@J-JOBS-30"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs");
    const row = page.getByTestId("jobs-toolbar-scroller");
    await expect(row.getByTestId("filters-toggle")).toBeVisible({ timeout: 15_000 });
    const heights = await controlHeights(row);
    expect(heights.length).toBeGreaterThanOrEqual(2);
    expect(new Set(heights)).toEqual(new Set([MD]));
});

/**
 * Class-wide: every flex row on the page, not just the named ones. Controls are
 * grouped by their nearest flex-row ancestor; a group with more than one height
 * is a row that mixes steps. The one structural exception is a sm-step glyph in
 * a row that holds a text field (the field's own clear/dismiss affordance).
 */
const mixedRows = (page: Page) =>
    page.evaluate((sel) => {
        const SM = 24;
        const groups = new Map<Element, Element[]>();
        for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            let row = el.parentElement;
            while (row && !(getComputedStyle(row).display.includes("flex") && getComputedStyle(row).flexDirection === "row")) row = row.parentElement;
            if (row) groups.set(row, [...(groups.get(row) ?? []), el]);
        }
        return [...groups.values()]
            .map((els) => {
                const hasField = els.some((e) => e.tagName === "INPUT");
                return els
                    .map((e) => ({ e, h: Math.round(e.getBoundingClientRect().height) }))
                    .filter(({ h }) => !(hasField && h === SM))
                    .map(({ e, h }) => `${(e as HTMLElement).dataset.testid ?? e.getAttribute("aria-label") ?? e.tagName}=${h}`);
            })
            .filter((row) => new Set(row.map((c) => c.split("=").pop())).size > 1);
    }, CONTROLS);

for (const path of ["/jobs", "/jobs?q=data+analyst", "/trends", "/about"]) {
    test(`no row on ${path} mixes control steps`, { tag: ["@J-NAV-34"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
        expect(await mixedRows(page)).toEqual([]);
    });
}

test("no row in an open job mixes control steps: the /jobs detail (split pane at 1440, sheet at 390) and /jobs/[slug]", { tag: ["@J-NAV-34"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs?q=data+analyst");
    const row = page.getByTestId("job-row").first();
    const listed = await row.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
    );
    test.skip(!listed, "this server lists no jobs (no search backend), so there is no job to open");
    const href = await row.getByTestId("job-title").getAttribute("href");
    const apply = page.getByRole("button", { name: APPLY_SIGNED_OUT_LABEL }).filter({ visible: true }).first();
    // The job actions sit on the md step (the 44px touch target is the hit area, not the visual) and no row mixes steps.
    const actionsOnOneMdStep = async () => {
        await expect(apply).toBeVisible({ timeout: 15_000 });
        expect(Math.round((await apply.boundingBox())!.height)).toBe(MD);
        expect(await mixedRows(page)).toEqual([]);
    };

    await row.click();
    await actionsOnOneMdStep();
    await page.goto(href!);
    await actionsOnOneMdStep();
});

/**
 * J-NAV-38: every visible button face takes its type from its step. A face is
 * a button (or role=button, or link) that paints `.ctl-button` (every Button
 * does) or sits on a `.ctl-*` step itself; other roles (tab, switch, menu
 * item), tab items and an element that says it is a field or a row
 * (`data-control`) keep their own recipe. The step is the element's own or,
 * for a face with none, its nearest stepped ancestor's (the header's docked
 * Search fills its 32px bar); a face with neither is an inline text link and
 * takes the text around it. A face with no text shows no type, so only its
 * corner is read. The corner is the control corner unless the element names
 * its own (a chip's pill), which the unit gate makes it justify.
 */
const buttonFaceFindings = (page: Page) =>
    page.evaluate(() => {
        const STEPS: Record<string, number> = { "ctl-sm": 24, "ctl-md": 32, "ctl-lg": 44 };
        const TYPE: Record<number, number> = { 24: 12, 32: 14, 44: 16 };
        const stepOf = (el: Element) => Object.keys(STEPS).find((c) => el.classList.contains(c));
        const probe = document.createElement("div");
        probe.style.borderRadius = "var(--radius-ctl)";
        document.body.appendChild(probe);
        const ctlRadius = getComputedStyle(probe).borderTopLeftRadius;
        probe.remove();

        const findings: string[] = [];
        let measured = 0;
        for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"], a')) {
            const face = el.classList.contains("ctl-button");
            if (!face && !stepOf(el)) continue;
            if (el.matches('[role]:not([role="button"]), [data-slot="tab-item"], [data-control]')) continue;
            const cs = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0 || cs.visibility === "hidden") continue;
            const stepEl = stepOf(el) ? el : el.parentElement?.closest(".ctl-sm, .ctl-md, .ctl-lg");
            if (!stepEl) continue; // a stepless text-link button: the text around it sets its type
            measured++;
            const name = el.dataset.testid ?? el.getAttribute("aria-label") ?? (el.innerText.trim().slice(0, 30) || el.tagName);
            const height = stepEl.classList.contains("ctl-grow") ? STEPS[stepOf(stepEl)!] : Math.round(stepEl.getBoundingClientRect().height);
            const size = TYPE[height];
            if (size === undefined) findings.push(`${name}: its step renders ${height}px, off the 24/32/44 scale`);
            else if (el.innerText.trim()) {
                if (parseFloat(cs.fontSize) !== size) findings.push(`${name}: ${cs.fontSize} text on the ${height}px step (want ${size}px)`);
                if (cs.fontWeight !== "500") findings.push(`${name}: weight ${cs.fontWeight} (want 500)`);
            }
            const ownCorner = [...el.classList].some((c) => /(?:^|:)rounded(?:-|$)/.test(c));
            if (face && !ownCorner) {
                const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
                if (corners.some((c) => c !== ctlRadius)) findings.push(`${name}: corners ${corners.join(" ")} (want the control corner, ${ctlRadius})`);
            }
        }
        return { measured, findings };
    });

for (const path of ["/jobs", "/jobs?q=data+analyst", "/trends", "/about"]) {
    test(`every button face on ${path} takes its type from its step: 12/14/16px at 500`, { tag: ["@J-NAV-38"] }, async ({ page }) => {
        await returningVisitor(page);
        await page.goto(path);
        await expect(page.getByTestId("topbar-signin")).toBeVisible({ timeout: 15_000 });
        // Polled so a read mid re-render (auth resolving, a sheet settling) is retried, not reported.
        await expect
            .poll(async () => {
                const { measured, findings } = await buttonFaceFindings(page);
                // Sign in and Create account at the least; fewer means the scan found nothing to check.
                return measured >= 2 ? findings : [`only ${measured} button faces found`];
            })
            .toEqual([]);
    });
}

test("header Sign in: 32px tall, 14px text at weight 500, on the loaded 500 cut", { tag: ["@J-NAV-38"] }, async ({ page }) => {
    await returningVisitor(page);
    for (const path of ["/jobs", "/trends", "/about"]) {
        await page.goto(path);
        for (const id of ["topbar-signin"]) {
            const button = page.getByTestId(id);
            await expect(button).toBeVisible({ timeout: 15_000 });
            // Polled: the header re-renders once auth resolves, so a first read can land on a node on its way out.
            const type = () =>
                button.evaluate((el) => {
                    const cs = getComputedStyle(el);
                    return { height: Math.round(el.getBoundingClientRect().height), size: cs.fontSize, weight: cs.fontWeight };
                });
            await expect.poll(type, { message: `${id} on ${path}` }).toEqual({ height: MD, size: "14px", weight: "500" });
        }
        // The 500 is its own cut, not the 400 face drawn heavier: a 500 face of the page's sans has loaded.
        const loaded500 = await page.evaluate(async () => {
            await document.fonts.ready;
            const family = getComputedStyle(document.body).fontFamily.split(",")[0].trim().replace(/["']/g, "");
            return [...document.fonts].some((f) => f.family.replace(/["']/g, "") === family && f.weight === "500" && f.status === "loaded");
        });
        expect(loaded500, `the 500 cut of the page's sans on ${path}`).toBe(true);
    }
});

test("an open job's actions take their type from their step: the /jobs detail and /jobs/[slug]", { tag: ["@J-NAV-38"] }, async ({ page }) => {
    await returningVisitor(page);
    await page.goto("/jobs?q=data+analyst");
    const row = page.getByTestId("job-row").first();
    const listed = await row.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
    );
    test.skip(!listed, "this server lists no jobs (no search backend), so there is no job to open");
    const href = await row.getByTestId("job-title").getAttribute("href");
    const apply = page.getByRole("button", { name: APPLY_SIGNED_OUT_LABEL }).filter({ visible: true }).first();
    const facesTakeTheirStep = async () => {
        await expect(apply).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => apply.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(["14px", "500"]);
        await expect.poll(async () => (await buttonFaceFindings(page)).findings).toEqual([]);
    };

    await row.click();
    await facesTakeTheirStep();
    await page.goto(href!);
    await facesTakeTheirStep();
});
