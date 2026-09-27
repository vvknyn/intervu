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

        test("Step 1 hides site chrome, fits viewport height, hero shares poster root fill", async ({ page }) => {
            const layout = await page.evaluate(() => {
                const parseRgb = (raw: string) => {
                    const m = raw.match(/rgba?\(([^)]+)\)/);
                    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
                    const parts = m[1].split(",").map((p) => p.trim());
                    return {
                        r: Number(parts[0]),
                        g: Number(parts[1]),
                        b: Number(parts[2]),
                        a: parts.length > 3 ? Number(parts[3]) : 1,
                    };
                };

                const chromeTestIds = ["topbar", "mobile-tabbar", "site-footer"] as const;
                const chrome = chromeTestIds.map((id) => {
                    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
                    const style = el ? getComputedStyle(el) : null;
                    return {
                        id,
                        display: style?.display ?? null,
                        height: el?.getBoundingClientRect().height ?? 0,
                    };
                });

                const root = document.querySelector('[data-testid="concept-a-landing"]') as HTMLElement | null;
                const h1 = root?.querySelector("h1") as HTMLElement | null;
                if (!root || !h1) return { error: "landing or hero missing" as const };

                const heroCol = h1.parentElement as HTMLElement | null;
                const heroColBg = heroCol ? parseRgb(getComputedStyle(heroCol).backgroundColor) : null;
                const rootBg = parseRgb(getComputedStyle(root).backgroundColor);

                const opaqueBackgroundAt = (el: HTMLElement) => {
                    let node: HTMLElement | null = el;
                    while (node && root.contains(node)) {
                        const bg = parseRgb(getComputedStyle(node).backgroundColor);
                        if (bg.a >= 0.95) return bg;
                        node = node.parentElement;
                    }
                    return rootBg;
                };

                const innerHeight = window.innerHeight;
                const innerWidth = window.innerWidth;
                const rootStyle = getComputedStyle(root);
                const rootRect = root.getBoundingClientRect();
                const spacer = document.querySelector(
                    '[data-testid="landing-onboarding-step-1-spacer"]',
                ) as HTMLElement | null;
                const spacerHeight = spacer?.getBoundingClientRect().height ?? 0;

                return {
                    bodyClassActive: document.body.classList.contains("concept-a-landing-active"),
                    chrome,
                    docScrollHeight: document.documentElement.scrollHeight,
                    bodyScrollHeight: document.body.scrollHeight,
                    innerHeight,
                    innerWidth,
                    rootPosition: rootStyle.position,
                    rootRect: {
                        left: rootRect.left,
                        top: rootRect.top,
                        width: rootRect.width,
                        height: rootRect.height,
                    },
                    spacerHeight,
                    heroColAlpha: heroColBg?.a ?? 1,
                    rootBg,
                    heroOpaqueBg: opaqueBackgroundAt(h1),
                };
            });

            if ("error" in layout) {
                throw new Error(layout.error);
            }

            expect(layout.bodyClassActive).toBe(true);
            expect(layout.rootPosition).toBe("fixed");
            expect(layout.rootRect.left).toBeLessThanOrEqual(1);
            expect(layout.rootRect.top).toBeLessThanOrEqual(1);
            expect(layout.rootRect.width).toBeGreaterThanOrEqual(layout.innerWidth - 2);
            expect(layout.rootRect.height).toBeGreaterThanOrEqual(layout.innerHeight - 2);
            expect(layout.spacerHeight).toBeLessThanOrEqual(1);
            for (const row of layout.chrome) {
                expect(row.display, `${row.id} display`).toBe("none");
                expect(row.height, `${row.id} layout height`).toBe(0);
            }
            expect(layout.docScrollHeight).toBeLessThanOrEqual(layout.innerHeight + 4);
            expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.innerHeight + 4);
            expect(layout.heroColAlpha).toBeLessThan(0.05);
            expect(layout.heroOpaqueBg).toEqual(layout.rootBg);
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
