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

const log = (page: Page) => page.evaluate(() => window.__log);

async function open(page: Page) {
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
        await expect(page.getByRole("option").first()).toHaveText("Accountant");
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
        await input.tap(); // and a second tap on the trigger reopens it
        await expect(layer(page)).toBeVisible();
    });

    test("the back button closes the layer and focus is on the trigger", async ({ page }) => {
        const input = await open(page);
        await input.tap();
        const back = page.getByRole("button", { name: "Close search" });
        expect(Math.round((await back.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        await back.tap();
        await expect(layer(page)).toHaveCount(0);
        await expect(input).toBeFocused();
        expect(await log(page)).toEqual([]);
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
