import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

/**
 * The search box against the WAI-ARIA APG editable-combobox keyboard model.
 * Mounts the real SearchAutocomplete on a bare page (no server, no search
 * index): the suggestions come from a stub, the "search" is a log line.
 */

const ROOT = join(__dirname, "..", "..");
let bundle = "";
let css = "";

test.beforeAll(async () => {
    const out = await build({
        entryPoints: [join(__dirname, "helpers", "search-autocomplete-harness.tsx")],
        tsconfig: join(ROOT, "tsconfig.json"),
        bundle: true,
        write: false,
        format: "iife",
        jsx: "automatic",
        define: { "process.env.NODE_ENV": '"development"' },
        logLevel: "error",
    });
    bundle = out.outputFiles[0].text;
    // The app's real stylesheet, so sizes and positions are measured, not assumed.
    const from = join(ROOT, "src", "app", "globals.css");
    css = (await postcss([tailwind()]).process(readFileSync(from, "utf8"), { from })).css;
});

declare global { interface Window { __seen?: string[] } }
const log = (page: Page) => page.evaluate(() => window.__log);

async function open(page: Page, suggest?: "zero" | "error" | "slow") {
    if (suggest) await page.addInitScript((mode) => { window.__suggest = mode; }, suggest);
    // A real origin (not about:blank, which denies localStorage, which the component reads).
    await page.route("http://harness.test/", (route) =>
        route.fulfill({ contentType: "text/html", body: `<!doctype html><style>${css}</style><div id="root"></div><script>${bundle.replace(/<\/script/g, "<\\/script")}</script>` }),
    );
    await page.goto("http://harness.test/");
    return page.getByRole("combobox", { name: "Search jobs" });
}

const expanded = (input: Locator) => expect(input).toHaveAttribute("aria-expanded", "true");
const collapsed = (input: Locator) => expect(input).toHaveAttribute("aria-expanded", "false");

test.describe("search combobox keyboard model (APG)", () => {
    test("focus lists the seeds; ArrowDown moves, ArrowUp moves back", async ({ page }) => {
        const input = await open(page);
        await input.focus();
        await expanded(input);
        const options = page.getByRole("option");
        await expect(options).toHaveText(["Nurse", "Engineer"]);
        await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();

        await input.press("ArrowDown");
        await expect(input).toHaveAttribute("aria-activedescendant", (await options.nth(0).getAttribute("id"))!);
        await input.press("ArrowDown");
        await expect(input).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id"))!);
        await input.press("ArrowUp");
        await expect(input).toHaveAttribute("aria-activedescendant", (await options.nth(0).getAttribute("id"))!);
        expect(await log(page)).toEqual([]);
    });

    test("Enter searches the typed words when no row is highlighted, and never submits the form", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await expect(page.getByRole("option").first()).toBeVisible();
        await input.press("Enter");
        await collapsed(input);
        expect(await log(page)).toEqual(["search:account"]);
    });

    test("Enter runs the row picked with the arrow keys, once", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await expect(page.getByRole("option").nth(1)).toHaveText("Accountant");
        await input.press("ArrowDown");
        await input.press("ArrowDown");
        await input.press("ArrowDown");
        await input.press("Enter");
        await expect(input).toHaveValue("Account Manager");
        await collapsed(input);
        await expect.poll(() => log(page)).toEqual(["search:Account Manager"]);
    });

    test("a click picks a row, and picking the same row again still searches", async ({ page }) => {
        const input = await open(page);
        for (const run of [1, 2]) {
            await input.fill("account");
            await page.getByRole("option", { name: "Senior Accountant" }).click();
            await expect(input).toHaveValue("Senior Accountant");
            await expect.poll(async () => (await log(page)).length).toBe(run);
        }
        expect(await log(page)).toEqual(["search:Senior Accountant", "search:Senior Accountant"]);
    });

    test("Escape closes the list and keeps the words", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await expanded(input);
        await expect(page.getByRole("option").first()).toBeVisible();
        await input.press("Escape");
        await collapsed(input);
        await expect(page.getByRole("listbox")).toHaveCount(0);
        await expect(input).toHaveValue("account");
        expect(await log(page)).toEqual([]);
    });

    test("Tab leaves the field and closes the list", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await expect(page.getByRole("option").first()).toBeVisible();
        await input.press("Tab");
        await collapsed(input);
        await expect(input).not.toBeFocused();
        expect(await log(page)).toEqual([]);
    });

    test("the clear button empties the field without closing the focus; the handle closes the list", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await page.getByTestId("search-input-clear").click();
        await expect(input).toHaveValue("");
        await expect(input).toBeFocused();
        expect(await log(page)).toEqual(["clear"]);

        await input.fill("acc");
        await expanded(input);
        await page.evaluate(() => window.__close());
        await collapsed(input);
    });

    test("the field carries its form name, so a form submits it before the page's code runs", async ({ page }) => {
        const input = await open(page);
        await expect(input).toHaveAttribute("name", "q");
    });
});

// Compact widths (below lg, 1024px — the width the filters Sheet uses): focusing the
// field turns it into the standard full-screen search view, built on the SAME input.
test.describe("search combobox on a phone: full-screen search view", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const layer = (page: Page) => page.locator("[data-search-layer]");

    test("tap opens a layer covering the viewport, input focused, suggestions inline", async ({ page }) => {
        const input = await open(page);
        await expect(layer(page)).toHaveCount(0);
        await input.tap();
        await expect(layer(page)).toBeVisible();
        // Settled (the layer fades in): it spans the whole viewport.
        await expect.poll(async () => {
            const b = (await layer(page).boundingBox())!;
            return [b.x, b.y, b.width, Math.round(b.height)];
        }).toEqual([0, 0, 390, 844]);
        await expect(input).toBeFocused();
        await expect(page.getByRole("option")).toHaveText(["Nurse", "Engineer"]);
        // The list is inside the layer, not a floating popover.
        await expect(layer(page).getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
        await expect(page.locator("[data-slot=combobox-popover]")).toHaveCount(0);
        const row = await page.getByRole("option").first().boundingBox();
        expect(Math.round(row!.height)).toBeGreaterThanOrEqual(44);
        expect(row!.width).toBeGreaterThanOrEqual(380);
        expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
        await expect(input).toHaveAttribute("enterkeyhint", "search");
        expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    });

    test("Escape closes the layer and focus stays on the trigger", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await expect(layer(page)).toBeVisible();
        await input.press("Escape");
        await expect(layer(page)).toHaveCount(0);
        await expect(input).toBeFocused();
        expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
        await input.click(); // and a second press on the trigger reopens it (a click: see the already-focused tests below)
        await expect(layer(page)).toBeVisible();
    });

    test("the back button closes the layer and blurs the field, so the keyboard drops", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        const back = page.getByRole("button", { name: "Close search" });
        expect(Math.round((await back.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        await back.tap();
        await expect(layer(page)).toHaveCount(0);
        await expect(input).not.toBeFocused();
        expect(await log(page)).toEqual([]);
    });

    test("the layer follows the visible viewport when the keyboard shrinks it", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await expect(layer(page)).toBeVisible();
        // iOS: the keyboard shrinks only the VISUAL viewport; dvh does not follow.
        await page.evaluate(() => {
            Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 150 });
            window.visualViewport!.dispatchEvent(new Event("resize"));
        });
        await expect.poll(async () => Math.round((await layer(page).boundingBox())!.height)).toBe(150);
        // The last row can be scrolled fully into the part that is still visible.
        const last = page.getByRole("option").last();
        await last.scrollIntoViewIfNeeded();
        const row = (await last.boundingBox())!;
        expect(row.y + row.height).toBeLessThanOrEqual(150 + 0.5);
    });

    test("picking a suggestion submits and closes the layer", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await page.getByRole("option", { name: "Engineer" }).tap();
        await expect(input).toHaveValue("Engineer");
        await expect(layer(page)).toHaveCount(0);
        await expect.poll(() => log(page)).toEqual(["search:Engineer"]);
    });

    test("Enter on typed words submits and closes the layer", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await input.fill("nurse");
        await input.press("Enter");
        await expect(layer(page)).toHaveCount(0);
        expect(await log(page)).toEqual(["search:nurse"]);
    });

    test("Enter on typed words drops the keyboard: the field is blurred", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await input.fill("nurse");
        await input.press("Enter");
        await expect(layer(page)).toHaveCount(0);
        await expect(input).not.toBeFocused();
    });

    // The layer moves the field. Moved while a finger is still down on it, WebKit drops the focus
    // (no keyboard, and a second tap needed), so a press on a focused field opens at the END of the press.
    for (const [state, reach] of [
        ["after Escape", async (page: Page, input: Locator) => { await input.tap(); await input.press("Escape"); }],
        ["after a tapped suggestion, focus returned", async (page: Page, input: Locator) => {
            await input.tap();
            await page.getByRole("option", { name: "Engineer" }).tap();
            await expect(layer(page)).toHaveCount(0);
            await input.focus();
        }],
    ] as const) {
        test(`a tap on the already-focused field ${state} opens the layer only once the press ends, keeping focus`, async ({ page }) => {
            const input = await open(page);
            await reach(page, input);
            await expect(layer(page)).toHaveCount(0);
            await expect(input).toBeFocused();
            await page.evaluate(() => {
                window.__seen = [];
                for (const t of ["pointerdown", "pointerup", "click"]) {
                    document.addEventListener(t, () => window.__seen!.push(`${t}:${document.querySelector("[data-search-layer]") ? "open" : "closed"}`), true);
                }
            });
            // A mouse press, not `tap()`: Playwright's synthetic touch tap does not always get its click
            // delivered (with the runner's video recording on it never does), and this test is about the click.
            await input.click();
            await expect(layer(page)).toBeVisible();
            await expect(input).toBeFocused();
            expect(await page.evaluate(() => window.__seen)).toEqual(["pointerdown:closed", "pointerup:closed", "click:closed"]);
        });
    }

    test("a click that no press on the focused field began (the late click of the tap that took focus, a pick's click) opens nothing", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await input.press("Escape");
        await expect(layer(page)).toHaveCount(0);
        await input.dispatchEvent("click");
        await page.waitForTimeout(300);
        await expect(layer(page)).toHaveCount(0);
        await expect(input).toBeFocused();
    });

    test("an unfocused tap still opens the layer with focus", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        await expect(layer(page)).toBeVisible();
        await expect(input).toBeFocused();
    });

    test("typed with a slow answer: the Search row and a loading row, no stale seeds", async ({ page }) => {
        const input = await open(page, "slow");
        await input.tap();
        await expect(page.getByRole("option")).toHaveText(["Nurse", "Engineer"]);
        await input.fill("nurse");
        await expect(page.getByText("Loading suggestions")).toBeVisible();
        await expect(page.getByRole("option")).toHaveText(['Search “nurse”']);
    });
});

test.describe("search combobox: what a typed query lists", () => {
    test("the first row searches the raw text, same as Enter; suggestions follow", async ({ page }) => {
        const input = await open(page);
        await input.fill("account");
        await expect(page.getByRole("option")).toHaveText(['Search “account”', "Accountant", "Account Manager", "Senior Accountant", "account Inc"]);
        await page.getByRole("option").first().click();
        await expect(input).toHaveValue("account");
        await expect.poll(() => log(page)).toEqual(["search:account"]);
    });

    test("no match: only the Search row, and no unavailable line", async ({ page }) => {
        const input = await open(page, "zero");
        await input.fill("zzz");
        await expect(page.getByRole("option")).toHaveText(['Search “zzz”']);
        await expect(page.getByText("Suggestions are unavailable")).toHaveCount(0);
    });

    test("an error: the Search row plus one muted line saying suggestions are unavailable", async ({ page }) => {
        const input = await open(page, "error");
        await input.fill("zzz");
        await expect(page.getByText("Suggestions are unavailable right now.")).toBeVisible();
        await expect(page.getByRole("option")).toHaveText(['Search “zzz”']);
    });

    test("the empty query lists the seeds and no Search row", async ({ page }) => {
        const input = await open(page);
        await input.focus();
        await expect(page.getByRole("option")).toHaveText(["Nurse", "Engineer"]);
    });
});

test.describe("search combobox on desktop keeps the popover", () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test("focus opens the floating popover, no layer", async ({ page }) => {
        const input = await open(page);
        await input.focus();
        await expect(page.locator("[data-slot=combobox-popover]")).toBeVisible();
        await expect(page.locator("[data-search-layer]")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Close search" })).toHaveCount(0);
    });
});
