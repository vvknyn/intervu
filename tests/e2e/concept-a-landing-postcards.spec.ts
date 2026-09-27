import { test, expect } from "@playwright/test";
import { POSTCARDS } from "@/components/onboarding/ConceptALanding";
import { contrastRatioFromCss, WCAG_AA_NORMAL_TEXT } from "./helpers/wcag-contrast";

const VIEWPORTS = [
    { label: "desktop", width: 1440, height: 900 },
    { label: "mobile", width: 390, height: 844 },
] as const;

const POSTCARD_COUNT = POSTCARDS.length;
const FRONT_TEXT_SLOTS = ["title", "meta", "live"] as const;

type Box = { left: number; top: number; right: number; bottom: number };

for (const viewport of VIEWPORTS) {
    test.describe(`Concept A landing postcards — ${viewport.label} ${viewport.width}×${viewport.height}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.goto("/jobs");
            await expect(page.getByTestId("concept-a-landing")).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId("concept-a-postcard-stack")).toBeVisible();
        });

        test("renders all five postcard roots", async ({ page }) => {
            for (let index = 0; index < POSTCARD_COUNT; index++) {
                await expect(page.getByTestId(`concept-a-postcard-${index}`)).toBeVisible();
            }
        });

        test("no postcard body is clipped by the viewport edge", async ({ page }) => {
            const clipped = await page.evaluate(({ postcardCount }) => {
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const hits: { index: number; edge: string }[] = [];
                for (let index = 0; index < postcardCount; index++) {
                    const el = document.querySelector(
                        `[data-testid="concept-a-postcard-${index}"]`,
                    ) as HTMLElement | null;
                    if (!el) return { error: `missing card ${index}` as const };
                    const r = el.getBoundingClientRect();
                    if (r.left < 0) hits.push({ index, edge: "left" });
                    if (r.top < 0) hits.push({ index, edge: "top" });
                    if (r.right > vw) hits.push({ index, edge: "right" });
                    if (r.bottom > vh) hits.push({ index, edge: "bottom" });
                }
                return { hits, vw, vh };
            }, { postcardCount: POSTCARD_COUNT });

            if ("error" in clipped) {
                throw new Error(clipped.error);
            }
            expect(clipped.hits, JSON.stringify(clipped, null, 2)).toEqual([]);
        });

        test("front card title/meta/Live stay inside viewport and card; Live meets AA contrast", async ({
            page,
        }) => {
            const layout = await page.evaluate(({ postcardCount, textSlots }) => {
                function boxFullyInside(inner: Box, outer: Box, epsilon = 1): boolean {
                    return (
                        inner.left >= outer.left - epsilon &&
                        inner.top >= outer.top - epsilon &&
                        inner.right <= outer.right + epsilon &&
                        inner.bottom <= outer.bottom + epsilon
                    );
                }

                type CardBox = { index: number; zIndex: number; cardBox: Box; texts: Record<string, Box> };
                const cards: CardBox[] = [];
                for (let index = 0; index < postcardCount; index++) {
                    const root = document.querySelector(
                        `[data-testid="concept-a-postcard-${index}"]`,
                    ) as HTMLElement | null;
                    if (!root) return { error: `missing card ${index}` as const };
                    const zIndex = Number(getComputedStyle(root).zIndex) || 0;
                    const cardRect = root.getBoundingClientRect();
                    const cardBox: Box = {
                        left: cardRect.left,
                        top: cardRect.top,
                        right: cardRect.right,
                        bottom: cardRect.bottom,
                    };
                    const texts: Record<string, Box> = {};
                    for (const slot of textSlots) {
                        const el = root.querySelector(
                            `[data-testid="concept-a-postcard-${index}-${slot}"]`,
                        ) as HTMLElement | null;
                        if (!el) return { error: `missing ${index}-${slot}` as const };
                        const r = el.getBoundingClientRect();
                        texts[slot] = {
                            left: r.left,
                            top: r.top,
                            right: r.right,
                            bottom: r.bottom,
                        };
                    }
                    cards.push({ index, zIndex, cardBox, texts });
                }
                const front = cards.reduce((best, c) => (c.zIndex > best.zIndex ? c : best), cards[0]!);
                const viewport: Box = {
                    left: 0,
                    top: 0,
                    right: window.innerWidth,
                    bottom: window.innerHeight,
                };
                const containment: { slot: string; inViewport: boolean; inCard: boolean }[] = [];
                for (const slot of textSlots) {
                    const box = front.texts[slot]!;
                    containment.push({
                        slot,
                        inViewport: boxFullyInside(box, viewport),
                        inCard: boxFullyInside(box, front.cardBox),
                    });
                }
                return { frontIndex: front.index, containment };
            }, { postcardCount: POSTCARD_COUNT, textSlots: FRONT_TEXT_SLOTS });

            if ("error" in layout) {
                throw new Error(layout.error);
            }

            for (const row of layout.containment) {
                expect(row.inViewport, `front card ${layout.frontIndex} ${row.slot} in viewport`).toBe(true);
                expect(row.inCard, `front card ${layout.frontIndex} ${row.slot} in card`).toBe(true);
            }

            const colors = await page.evaluate((idx) => {
                const live = document.querySelector(
                    `[data-testid="concept-a-postcard-${idx}-live"]`,
                ) as HTMLElement | null;
                const card = document.querySelector(
                    `[data-testid="concept-a-postcard-${idx}"]`,
                ) as HTMLElement | null;
                if (!live || !card) return null;
                return {
                    fg: getComputedStyle(live).color,
                    bg: getComputedStyle(card).backgroundColor,
                };
            }, layout.frontIndex);

            expect(colors).not.toBeNull();
            const ratio = contrastRatioFromCss(colors!.fg, colors!.bg);
            expect(ratio, `front card ${layout.frontIndex} Live (${colors!.fg} on ${colors!.bg})`).not.toBeNull();
            expect(ratio!).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
        });
    });
}
