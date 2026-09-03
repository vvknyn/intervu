import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * TEST GROUP: JOBS-RULEBOOK - /jobs SERP design-token acceptance gate
 *
 * This is the acceptance gate for the /jobs redesign (PLAN.md Phase 0): it
 * measures the LIVE page against the design rulebook (docs/design "Ledger"
 * palette + Carbon-style spacing/radius scale) and prints per-check
 * violation counts, the same six checks the mockup's own acceptance script
 * (canvas2/preview.cjs) ran against a static board, ported here to the real
 * DOM. It is a GATE, not a fix: run before the redesign lands, it is
 * expected to report violations on almost every check (the untouched page
 * still uses the old glass/shadow surfaces, the old spacing scale, icons in
 * row meta, etc.) — that baseline is the point, so later phases have a
 * number to drive toward instead of an eyeballed "looks close enough."
 *
 * Regions are marked with `data-region` on the four region roots (header,
 * band, list, detail — see JOBS-PAGE-MAP.md) rather than inferred from
 * selectors, so a check can be scoped to "everything actually inside this
 * region" without hand-maintaining a list of components per region. Anything
 * carrying `data-rulebook-exempt` (the wordmark's allowed 700-weight
 * lockup type, a company-logo tile's documented raw-hex fill, or the
 * report-listing tooltip's local-env-only "not configured" bubble — see
 * ReportListingButton.tsx) is skipped by every check, the same
 * whole-subtree skip preview.cjs's `[data-exempt]` used.
 *
 * One page load, computed once in `beforeAll` and cached — 20 region×check
 * assertions below all read the same snapshot rather than each re-rendering
 * the page, and a `test` only fails the checks it actually names (so the
 * HTML/list reporter shows exactly which of the 20 combinations regressed).
 */

const VIEWPORT = { width: 1440, height: 900 };
const SEARCH_URL = '/jobs?q=product+manager';

// ---- Rulebook constants (ONE block; every check below reads these, no
// per-element special-casing beyond the [data-rulebook-exempt] attribute). ----
const ALLOWED_SIZES = new Set([12, 14, 16, 20]);
const ALLOWED_WEIGHTS = new Set([400, 600]);
const FIXED_PALETTE_HEX = ['#0A0A0A', '#525252', '#002FA7', '#8D8D8D', '#B45309', '#DA1E28', '#FFFFFF'];
const SPACING_SCALE = new Set([0, 2, 4, 8, 12, 16, 24, 32, 40, 48]);
const SPACING_PROPS = [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'rowGap', 'columnGap',
] as const;
const FILLED_BUTTON_COLOR = 'rgb(0, 47, 167)'; // #002FA7
const REGIONS = ['header', 'band', 'list', 'detail'] as const;
type Region = (typeof REGIONS)[number];
// Region -> required count of the one filled #002FA7 button (rulebook: one
// in header, one in detail, zero in band and list).
const EXPECTED_FILLED_BUTTONS: Record<Region, number> = { header: 0, band: 0, list: 0, detail: 1 };

function hexToRgbString(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

type Offender = { tag: string; className: string; detail: string };
type TypeResult = { violations: number; offenders: Offender[] };
type DepthResult = { violations: number; offenders: Offender[] };
type SpacingResult = { violations: number; offenders: Offender[] };
type RegionReport = {
    type: TypeResult;
    depth: DepthResult;
    spacing: SpacingResult;
    filledButtons: number;
    geometryHeight: number | null;
};
type Report = {
    regions: Record<Region, RegionReport>;
    svgInList: number;
    firstRowHeight: number | null;
};

// Runs entirely inside the page — one evaluate call computes every region's
// type/depth/spacing/button numbers plus the two page-level measurements
// (list svg count, first row height), so the 20 assertions below are all
// reading one consistent snapshot of one render.
async function measure(page: Page, allowedColors: string[]): Promise<Report> {
    return page.evaluate(
        ({ regions, allowedSizes, allowedWeights, allowedColors, spacingScale, spacingProps, filledColor, viewport }) => {
            const vw = viewport.width;
            const vh = viewport.height;

            function isVisible(el: Element): boolean {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return false;
                // in-viewport: intersects the 1440x900 frame the checks are scoped to.
                return r.left < vw && r.right > 0 && r.top < vh && r.bottom > 0;
            }
            function isExempt(el: Element): boolean {
                return !!el.closest('[data-rulebook-exempt]');
            }
            function hasDirectText(el: Element): boolean {
                for (const n of Array.from(el.childNodes)) {
                    if (n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0) return true;
                }
                return false;
            }
            function alphaOf(colorStr: string): number {
                if (colorStr === 'transparent') return 0;
                const m = colorStr.match(/rgba?\(([^)]+)\)/);
                if (!m) return 1;
                const parts = m[1].split(',').map((s) => s.trim());
                return parts.length === 4 ? parseFloat(parts[3]) : 1;
            }
            function offender(el: Element, detail: string) {
                return { tag: el.tagName.toLowerCase(), className: String((el as HTMLElement).className || ''), detail };
            }

            const regionsInView = (name: string) =>
                Array.from(document.querySelectorAll(`[data-region="${name}"]`)).filter(isVisible);

            const regionOut: Record<string, unknown> = {};

            for (const name of regions) {
                const roots = regionsInView(name);
                const all: Element[] = [];
                for (const root of roots) {
                    all.push(root, ...Array.from(root.querySelectorAll('*')));
                }
                const scoped = all.filter((el) => isVisible(el) && !isExempt(el));

                // Check 1 — type: leaf text font-size/weight/color.
                const typeOffenders: ReturnType<typeof offender>[] = [];
                for (const el of scoped) {
                    if (!hasDirectText(el)) continue;
                    const cs = getComputedStyle(el);
                    const size = Math.round(parseFloat(cs.fontSize));
                    const weight = Math.round(parseFloat(cs.fontWeight));
                    if (!allowedSizes.includes(size)) typeOffenders.push(offender(el, `font-size=${size}px`));
                    if (!allowedWeights.includes(weight)) typeOffenders.push(offender(el, `font-weight=${weight}`));
                    if (!allowedColors.includes(cs.color)) typeOffenders.push(offender(el, `color=${cs.color}`));
                }

                // Check 2 — depth: shadow/blur/radius/surface-alpha.
                const depthOffenders: ReturnType<typeof offender>[] = [];
                for (const el of scoped) {
                    const cs = getComputedStyle(el);
                    if (cs.boxShadow !== 'none') depthOffenders.push(offender(el, `box-shadow=${cs.boxShadow}`));
                    if (cs.backdropFilter && cs.backdropFilter !== 'none') {
                        depthOffenders.push(offender(el, `backdrop-filter=${cs.backdropFilter}`));
                    }
                    const rect = el.getBoundingClientRect();
                    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
                    const isStatusDot = rect.width <= 8 && rect.height <= 8 && radii.every((r) => parseFloat(r) > 0);
                    if (!isStatusDot && radii.some((r) => parseFloat(r) > 0)) {
                        depthOffenders.push(offender(el, `border-radius=${radii.join(',')}`));
                    }
                    const alpha = alphaOf(cs.backgroundColor);
                    if (alpha !== 0 && alpha !== 1) depthOffenders.push(offender(el, `background-alpha=${alpha}`));
                }

                // Check 3 — spacing scale (negative margins fall through, correctly
                // counted: no negative value is ever in spacingScale).
                const spacingOffenders: ReturnType<typeof offender>[] = [];
                for (const el of scoped) {
                    const cs = getComputedStyle(el);
                    for (const prop of spacingProps) {
                        const raw = (cs as unknown as Record<string, string>)[prop];
                        if (!raw || raw === 'normal') continue;
                        const val = Math.round(parseFloat(raw));
                        if (Number.isNaN(val)) continue;
                        if (!spacingScale.includes(val)) spacingOffenders.push(offender(el, `${prop}=${val}px`));
                    }
                }

                // Check 4 — filled #002FA7 button count in this region.
                const isFilled = (el: Element) => getComputedStyle(el).backgroundColor === filledColor;
                const filledButtons = scoped.filter(
                    (el) => (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && isFilled(el),
                ).length;

                // Check 6 — geometry: this region root's own rendered height.
                const geometryHeight = roots.length ? Math.round(roots[0].getBoundingClientRect().height) : null;

                regionOut[name] = {
                    type: { violations: typeOffenders.length, offenders: typeOffenders.slice(0, 3) },
                    depth: { violations: depthOffenders.length, offenders: depthOffenders.slice(0, 3) },
                    spacing: { violations: spacingOffenders.length, offenders: spacingOffenders.slice(0, 3) },
                    filledButtons,
                    geometryHeight,
                };
            }

            // Check 5 — svg icon count inside the list region (rows must carry none).
            const listRoot = document.querySelector('[data-region="list"]');
            const svgInList = listRoot
                ? Array.from(listRoot.querySelectorAll('svg')).filter((s) => isVisible(s) && !isExempt(s)).length
                : 0;

            // Check 6 (row) — first result row's rendered height.
            const firstRow = listRoot?.querySelector('[data-testid="job-row"]') ?? null;
            const firstRowHeight = firstRow ? Math.round(firstRow.getBoundingClientRect().height) : null;

            return { regions: regionOut, svgInList, firstRowHeight };
        },
        {
            regions: REGIONS,
            allowedSizes: [...ALLOWED_SIZES],
            allowedWeights: [...ALLOWED_WEIGHTS],
            allowedColors,
            spacingScale: [...SPACING_SCALE],
            spacingProps: SPACING_PROPS,
            filledColor: FILLED_BUTTON_COLOR,
            viewport: VIEWPORT,
        },
    ) as Promise<Report>;
}

function logViolations(label: string, count: number, offenders: Offender[]) {
    console.log(`${label}: ${count} violations`);
    for (const o of offenders.slice(0, 3)) {
        console.log(`  ${o.tag}.${o.className || '(no class)'}: ${o.detail}`);
    }
}

let page: Page;
let report: Report;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: VIEWPORT });
    // First search after a fresh dev-server start can take up to ~20s
    // (Turbopack cold compile + first Meilisearch round trip) — see the same
    // note in jobs-first-screen.spec.ts.
    await page.goto(SEARCH_URL);
    await page.waitForSelector('#jobs-results-list a[href*="/jobs/"]', { timeout: 60_000 });
    await page.waitForTimeout(1500); // let web fonts settle before measuring type

    // The `--live` token resolves differently light/dark and is themeable —
    // read what the page actually computed rather than hardcoding both of
    // its known values, so a future palette tweak can't silently desync the
    // gate from the token it is supposed to be checking.
    const liveRgb = await page.evaluate(() => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--live').trim();
        const [r, g, b] = raw.split(/\s+/).map(Number);
        return `rgb(${r}, ${g}, ${b})`;
    });
    const allowedColors = [...FIXED_PALETTE_HEX.map(hexToRgbString), liveRgb];

    report = await measure(page, allowedColors);

    const outDir = path.join(process.cwd(), 'test-results');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'rulebook-report.json'), JSON.stringify(report, null, 2));
});

test.afterAll(async () => {
    await page.close();
});

for (const region of REGIONS) {
    test(`${region} / type: font-size, font-weight, color`, () => {
        const r = report.regions[region].type;
        logViolations(`${region}/type`, r.violations, r.offenders);
        expect(r.violations, `${region}/type violations`).toBe(0);
    });

    test(`${region} / depth: shadow, blur, radius, surface alpha`, () => {
        const r = report.regions[region].depth;
        logViolations(`${region}/depth`, r.violations, r.offenders);
        expect(r.violations, `${region}/depth violations`).toBe(0);
    });

    test(`${region} / spacing: padding, margin, gap on the Carbon scale`, () => {
        const r = report.regions[region].spacing;
        logViolations(`${region}/spacing`, r.violations, r.offenders);
        expect(r.violations, `${region}/spacing violations`).toBe(0);
    });

    test(`${region} / filled #002FA7 buttons`, () => {
        const got = report.regions[region].filledButtons;
        const want = EXPECTED_FILLED_BUTTONS[region];
        console.log(`${region}/buttons: expected ${want}, got ${got}`);
        expect(got, `${region} filled-button count`).toBe(want);
    });
}

test('list / svg icon count (rows must carry no icons)', () => {
    console.log(`list/svg: ${report.svgInList} violations`);
    expect(report.svgInList, 'list svg count').toBe(0);
});

test('header / geometry: 48px', () => {
    console.log(`header/geometry: height=${report.regions.header.geometryHeight}px (want 48)`);
    expect(report.regions.header.geometryHeight).toBe(48);
});

test('band / geometry: 40px', () => {
    console.log(`band/geometry: height=${report.regions.band.geometryHeight}px (want 40)`);
    expect(report.regions.band.geometryHeight).toBe(40);
});

test('list / geometry: first row height between 96 and 112', () => {
    console.log(`list/geometry: firstRowHeight=${report.firstRowHeight}px (want 96-112)`);
    expect(report.firstRowHeight).not.toBeNull();
    expect(report.firstRowHeight as number).toBeGreaterThanOrEqual(96);
    expect(report.firstRowHeight as number).toBeLessThanOrEqual(112);
});
