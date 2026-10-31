import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { isLocalOrigin, mockSignIn } from "./signed-in";

/**
 * The page frame (docs/design-language.md §6), measured on the rendered page
 * rather than read from the source — the source check (page-scale.test.ts)
 * let a tab pick its own centred 3xl column behind an allow marker.
 *
 * - J-NAV-46: every page's content starts on the header logo's left edge and
 *   ends inside the header's right edge, at 390, 768, 1280 and 1440.
 * - J-NAV-47: every page's masthead (eyebrow or title) starts the same
 *   `--page-top` (40px) below the header.
 * - J-SETTINGS-37: Settings' title, plan card, tab bar and first card sit in
 *   the same place on every tab.
 *
 * Named layouts that are not the frame are left out by name, not by a
 * tolerance: the /jobs front door (a centred search column) and the sign-in
 * and error cards (a centred card). Read-only.
 */

const FRAME_ROUTES = [
    "/about",
    "/privacy",
    "/terms",
    "/contact",
    "/pricing",
    "/blog",
    "/connect",
    "/connect/help",
    "/research/ghost-jobs",
    "/eluta-alternative",
    "/indeed-alternative",
    "/linkedin-jobs-alternative",
    "/openclaw",
    "/yours",
    "/yours/history",
    "/resume",
    "/stories",
    "/watch/anywhere",
    "/billing/return",
];

/** The page top every masthead starts below the header (globals.css `--page-top`). */
const PAGE_TOP_PX = 40;

/** Desktop runs the three wide widths; the phone project runs 390. */
const widthsFor = (project: string) => (project === "mobile" ? [390] : [1440, 1280, 768]);

const returningVisitor = (page: Page) =>
    page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

interface Frame {
    /** The header row's content box: logo edge to avatar edge. */
    frameL: number;
    frameR: number;
    /** The union of everything painted in <main> (bare wrappers count by their content box). */
    colL: number;
    colR: number;
    /** Masthead top (the first visible element of the h1's block) minus the header's bottom. */
    mastheadGap: number | null;
    h1Left: number | null;
    overflow: number;
}

/** Measures the page against the header's frame. Runs in the page. */
const measureFrame = (page: Page) =>
    page.evaluate((): Frame => {
        const visible = (e: Element) => {
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none";
        };
        const topbar = document.querySelector("[data-testid=topbar] [data-region=header]") as HTMLElement;
        const tr = topbar.getBoundingClientRect();
        const tcs = getComputedStyle(topbar);
        const frameL = tr.left + parseFloat(tcs.paddingLeft);
        const frameR = tr.right - parseFloat(tcs.paddingRight);
        const vw = document.documentElement.clientWidth;
        const main = document.querySelector("main") ?? document.body;
        const outside = "[data-testid=topbar],[data-testid=site-footer],footer,[data-testid=mobile-tabbar],[role=dialog]";
        const fixed = (e: Element) => {
            for (let p: Element | null = e; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === "fixed") return true;
            return false;
        };
        // A child of a sideways scroller may run past the scroller's edge by design.
        const clippedBy = (e: Element, r: DOMRect) => {
            for (let p = e.parentElement; p && p !== main; p = p.parentElement) {
                const o = getComputedStyle(p).overflowX;
                if (o === "visible") continue;
                const pr = p.getBoundingClientRect();
                if (r.left < pr.left - 1 || r.right > pr.right + 1) return true;
            }
            return false;
        };
        let colL = Infinity;
        let colR = -Infinity;
        for (const e of main.querySelectorAll("*")) {
            if (e.closest(outside) || !visible(e) || fixed(e)) continue;
            const r = e.getBoundingClientRect();
            if (r.left <= 0.5 && r.width >= vw - 1) continue; // a full-bleed band or wrapper
            if (clippedBy(e, r)) continue;
            const cs = getComputedStyle(e);
            const painted =
                (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
                (cs.borderLeftStyle !== "none" && parseFloat(cs.borderLeftWidth) > 0) ||
                e.matches("img,svg,video,canvas,input,textarea,select,button");
            const l = painted ? r.left : r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
            const rr = painted ? r.right : r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
            if (rr - l < 1) continue;
            colL = Math.min(colL, l);
            colR = Math.max(colR, rr);
        }
        const h1 = [...document.querySelectorAll("h1")].find(visible) ?? null;
        let mastheadGap: number | null = null;
        if (h1?.parentElement) {
            const first = [...h1.parentElement.children].find(visible) ?? h1;
            const headerBottom = (document.querySelector("[data-testid=topbar]") as HTMLElement).getBoundingClientRect().bottom;
            mastheadGap = first.getBoundingClientRect().top - headerBottom;
        }
        return {
            frameL,
            frameR,
            colL,
            colR,
            mastheadGap,
            h1Left: h1 ? h1.getBoundingClientRect().left : null,
            overflow: document.documentElement.scrollWidth - vw,
        };
    });

const round = (f: Frame) =>
    Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === null ? null : Math.round(v)])) as Record<keyof Frame, number | null>;

async function open(page: Page, path: string) {
    await page.goto(path);
    await expect(page.getByTestId("topbar")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
}

for (const path of FRAME_ROUTES) {
    test(`${path}: the page sits in the header's frame at every width`, { tag: ["@J-NAV-46", "@J-NAV-47"] }, async ({ page, baseURL }, testInfo) => {
        await returningVisitor(page);
        // Signed in where a local dev server can do it, so the signed-in layout is the one measured.
        if (isLocalOrigin(baseURL)) await mockSignIn(page);
        for (const width of widthsFor(testInfo.project.name)) {
            await page.setViewportSize({ width, height: 900 });
            await open(page, path);
            // Polled: the header settles its auth slot, and client pages swap their loading state, after first paint.
            await expect
                .poll(async () => {
                    const f = round(await measureFrame(page));
                    return {
                        startsOnTheLogoEdge: f.colL === f.frameL,
                        endsInsideTheHeader: (f.colR ?? 0) <= (f.frameR ?? 0) + 1,
                        titleOnTheLogoEdge: f.h1Left === f.frameL,
                        mastheadGap: f.mastheadGap,
                        sidewaysScroll: (f.overflow ?? 0) > 0,
                    };
                }, { message: `${path} at ${width}px`, timeout: 15_000 })
                .toEqual({ startsOnTheLogoEdge: true, endsInsideTheHeader: true, titleOnTheLogoEdge: true, mastheadGap: PAGE_TOP_PX, sidewaysScroll: false });
        }
    });
}

test("Settings: the title, plan card, tab bar and cards hold one frame on every tab", { tag: ["@J-SETTINGS-37"] }, async ({ page, baseURL }, testInfo) => {
    // /settings is gated by the server session; /mock/settings renders the same
    // SettingsContainer behind the dev-only sign-in hook (see settings.spec.ts).
    test.skip(!isLocalOrigin(baseURL), "signed-in settings need the dev-only __INTERVU_E2E_AUTH__ hook");
    for (const width of widthsFor(testInfo.project.name)) {
        await page.setViewportSize({ width, height: 900 });
        const perTab: Record<string, unknown> = {};
        for (const tab of ["resume", "prefs", "account"]) {
            await page.goto(`/mock/settings${tab === "resume" ? "" : `?tab=${tab}`}`);
            await expect(page.getByRole("tablist")).toBeVisible({ timeout: 15_000 });
            perTab[tab] = await page.evaluate(() => {
                const box = (e: Element | null) => {
                    if (!e) return null;
                    const r = e.getBoundingClientRect();
                    return [Math.round(r.left), Math.round(r.top), Math.round(r.right)];
                };
                const probe = document.createElement("div");
                probe.className = "shell-row";
                document.body.append(probe);
                const pr = probe.getBoundingClientRect();
                const pcs = getComputedStyle(probe);
                const frame = [Math.round(pr.left + parseFloat(pcs.paddingLeft)), Math.round(pr.right - parseFloat(pcs.paddingRight))];
                probe.remove();
                const tablist = document.querySelector("[role=tablist]");
                // The first panel after the tab bar: every tab opens with one.
                const panel = [...document.querySelectorAll(".rounded-panel")].find(
                    (e) => tablist && tablist.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && e.getBoundingClientRect().width > 1,
                );
                return {
                    frame,
                    title: box(document.querySelector("h1")),
                    tabs: box(tablist?.closest("[data-slot=tabs]") ?? tablist),
                    firstPanel: panel ? [box(panel)![0], box(panel)![2]] : null,
                };
            });
        }
        const resume = perTab.resume as { frame: number[]; title: number[]; firstPanel: number[] };
        // Every tab matches the Résumé tab, and the Résumé tab's panel fills the frame.
        expect(perTab.prefs, `Preferences vs Résumé at ${width}px`).toEqual(resume);
        expect(perTab.account, `Account vs Résumé at ${width}px`).toEqual(resume);
        expect(resume.title[0], `title on the logo edge at ${width}px`).toBe(resume.frame[0]);
        expect(resume.firstPanel, `first card spans the frame at ${width}px`).toEqual(resume.frame);
    }
});
