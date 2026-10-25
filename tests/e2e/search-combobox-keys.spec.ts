import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import { join } from "node:path";

/**
 * The search box against the WAI-ARIA APG editable-combobox keyboard model.
 * Mounts the real SearchAutocomplete on a bare page (no server, no search
 * index): the suggestions come from a stub, the "search" is a log line.
 */

const ROOT = join(__dirname, "..", "..");
let bundle = "";

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
});

const log = (page: Page) => page.evaluate(() => window.__log);

async function open(page: Page) {
    // A real origin (not about:blank, which denies localStorage, which the component reads).
    await page.route("http://harness.test/", (route) =>
        route.fulfill({ contentType: "text/html", body: `<!doctype html><div id="root"></div><script>${bundle.replace(/<\/script/g, "<\\/script")}</script>` }),
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
