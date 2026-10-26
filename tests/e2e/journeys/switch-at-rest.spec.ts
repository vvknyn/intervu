import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journey for the switch at rest — see tests/journeys/CATALOG.md (J-NAV-44). Read-only.
 * A switch shows its state by where the knob is and what colour the track is, never by an
 * outline: the knob reads against the track at 3:1 or better (WCAG 1.4.11), and the edge is
 * never brighter against the track than the knob is. Checked on two call sites of the one
 * primitive: the /jobs "Job alert" switch and a bare Switch as Settings uses it, both on the
 * /mock/switch fixture (the real results line and Settings need the backend). A local dev server only.
 */

type Rgba = [number, number, number, number];

const paint = (sw: Locator) =>
    sw.evaluate((el) => {
        const rgba = (c: string): Rgba => {
            const m = c.match(/[\d.]+/g)!.map(Number);
            return [m[0], m[1], m[2], m[3] ?? 1];
        };
        const cs = getComputedStyle(el);
        return { track: rgba(cs.backgroundColor), edge: rgba(cs.borderTopColor), knob: rgba(getComputedStyle(el.firstElementChild!).backgroundColor) };
    });

const luminance = ([r, g, b]: Rgba) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/** The knob-vs-track contrast, and the edge-vs-track contrast (1 when the edge is transparent). */
async function readRest(sw: Locator) {
    await sw.page().waitForTimeout(400); // the track and knob colour transitions
    const { track, edge, knob } = await paint(sw);
    return { knob: contrast(knob, track), edge: edge[3] === 0 ? 1 : contrast([edge[0], edge[1], edge[2], 1], track) };
}

async function expectStateAtRest(sw: Locator) {
    for (const state of ["false", "true"] as const) {
        if ((await sw.getAttribute("aria-checked")) !== state) await sw.click();
        await expect(sw).toHaveAttribute("aria-checked", state);
        const { knob, edge } = await readRest(sw);
        expect(knob, `aria-checked=${state}: knob vs track`).toBeGreaterThanOrEqual(3);
        expect(edge, `aria-checked=${state}: the edge never outshines the knob`).toBeLessThanOrEqual(knob);
    }
}

test.beforeEach(({ baseURL }) => {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
    test.skip(!local, "/mock fixtures are not served by a production build");
});

for (const [site, name] of [
    ["the /jobs Job alert switch", /job alert/i],
    ["a bare Switch, as Settings uses it", /remote only/i],
] as const) {
    test(`${site} shows its state by its knob and track, off and on`, { tag: ["@J-NAV-44"] }, async ({ page }) => {
        await page.goto("/mock/switch");
        const sw = page.getByRole("switch", { name });
        await expect(sw).toBeVisible({ timeout: 30_000 });
        await expectStateAtRest(sw);
    });
}
