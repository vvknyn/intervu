/**
 * Live audit of the For-you packs: for each golden résumé (tests/fixtures),
 * open every pack tile the hub shows that résumé on velai.app (the tiles of
 * its profession's industry, industry-tiles.ts) signed in, take the
 * roles the tile recommends, read the full posting behind each, and check it
 * (pack-audit.ts): the right country, the right level, the kind of role the
 * résumé targets, and a member of the tile. Writes audit-output/pack-audit.md
 * and .json; fails when any recommendation fails a check.
 *
 * For you needs an account, so the audit signs in: as the account in
 * E2E_STORAGE_STATE (one with no résumé on file, so the seeded résumé is the
 * one ranked), or with the dev-only hook on a local dev server
 * (journeys/signed-in.ts). Anywhere else it fails rather than skip.
 *
 * Read-only, but it runs real searches under the per-IP search limit, so it
 * paces itself between tiles. Run: `E2E_STORAGE_STATE=<file> npm run audit:packs:prod`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { HubPackId } from "../../../src/lib/jobs/for-you/hub-pack-filters";
import { PACKS_HOME_INTRO_KEY } from "../../../src/lib/jobs/for-you/packs-home-intro";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { buildMatchQuery } from "../../../src/lib/jobs/resume-match";
import type { PublicJob } from "../../../src/lib/jobs/types";
import { structureResumeText } from "../../../src/lib/resume/structure-resume-text";
import type { ResumeData } from "../../../src/types/resume";
import { auditRecommendation, failedChecks, renderAuditMarkdown, type AuditVerdict } from "./pack-audit";
import { isLocalOrigin, mockSignIn, SIGNED_IN_SKIP_REASON } from "../journeys/signed-in";

const RESUMES = [
    "vivek-pm-resume",
    "vivek-okta-resume",
    "vivek-csm-golden-resume",
    "health-rn-resume",
    "health-science-grad-resume",
    "health-physio-resume",
];
/** Rows per tile: the top of the pack, where a visitor starts. */
const ROWS_PER_TILE = Number(process.env.AUDIT_ROWS_PER_TILE ?? 3);
const TILE_PAUSE_MS = Number(process.env.AUDIT_TILE_PAUSE_MS ?? 20_000);
const RATE_LIMIT_WAIT_MS = 65_000;
const OUT_DIR = path.join(process.cwd(), "audit-output");

const loadResume = (name: string): ResumeData =>
    structureResumeText(readFileSync(path.join(process.cwd(), `tests/fixtures/${name}.txt`), "utf8").replace(/'/g, "’")) as ResumeData;

test.use({ storageState: process.env.E2E_STORAGE_STATE || undefined });

async function signIn(page: Page, baseURL: string | undefined) {
    if (process.env.E2E_STORAGE_STATE) return;
    if (!isLocalOrigin(baseURL)) throw new Error(`The pack audit needs an account (For you is signed-in only). ${SIGNED_IN_SKIP_REASON}`);
    await mockSignIn(page);
}

async function seedResume(page: Page, resume: ResumeData) {
    await page.addInitScript(
        ([resumeJson, onboardingKey, introKey]) => {
            localStorage.setItem(onboardingKey, "1");
            localStorage.setItem(introKey, "1");
            localStorage.setItem("velai.localAi.enabled", "1");
            localStorage.setItem(
                "velai.localAi.resume",
                JSON.stringify({ data: JSON.parse(resumeJson), updatedAt: new Date().toISOString(), sourceLabel: "pack-audit" }),
            );
        },
        [JSON.stringify(resume), ONBOARDING_COMPLETED_STORAGE_KEY, PACKS_HOME_INTRO_KEY] as const,
    );
}

/**
 * The tiles the hub shows this résumé once every count is in: tiles with too
 * few roles, or nearly all of them, drop out as the counts arrive.
 */
async function shownTiles(page: Page): Promise<HubPackId[]> {
    const cards = page.locator('[data-testid="hub-pack-chips"] [data-testid^="hub-pack-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
        const counts = await page.locator('[data-testid^="hub-pack-count-"]').evaluateAll((els) =>
            els.map((el) => ({ text: (el.textContent ?? "").trim(), matching: el.hasAttribute("data-matching") })),
        );
        expect(counts.some((c) => c.text === "…" || c.matching)).toBe(false);
        // The browse set (with its apply tile) shows until the résumé's own tiles replace it.
        await expect(page.getByTestId("hub-pack-card-apply")).toHaveCount(0);
    }).toPass({ timeout: 120_000 });
    const ids = await cards.evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace(/^hub-pack-card-/, "")));
    return ids.filter(Boolean) as HubPackId[];
}

/** The rows a tile shows once its own search has ranked them; [] for an empty tile. */
async function openTile(page: Page, tile: HubPackId): Promise<{ id: string; band: string | null }[]> {
    const card = page.getByTestId(`hub-pack-card-${tile}`);
    const back = page.getByTestId("jobs-back-to-packs");
    await expect(card).toBeVisible({ timeout: 60_000 });
    // A click that lands before the hub hydrates does nothing, and the first reveal can put sort=fit
    // in the URL on its own, so the deck opening is the signal that the tile was opened.
    await expect(async () => {
        if (!(await back.isVisible())) await card.click({ timeout: 5_000 });
        await expect(back).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page).toHaveURL(/[?&]sort=fit/, { timeout: 60_000 });
    const settled = page.locator(
        '[data-testid="for-you-deck"] [data-testid="role-stack-card"], [data-testid="for-you-empty"], [data-testid="for-you-no-roles-there"], [data-testid="for-you-load-failed"]',
    );
    await expect(settled.first()).toBeVisible({ timeout: 60_000 });
    if (await page.getByTestId("for-you-load-failed").isVisible()) {
        await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
        await page.getByTestId("for-you-load-failed-retry").click();
        await expect(page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"], [data-testid="for-you-empty"], [data-testid="for-you-no-roles-there"]').first()).toBeVisible({ timeout: 60_000 });
    }
    await expect(page.getByTestId("for-you-loading")).toHaveCount(0, { timeout: 60_000 });
    // The pack is a stack of role cards: read the open role, then step with Next.
    const front = page.locator('[data-testid="for-you-deck"] [data-testid="role-stack-card"][data-stack-pose="front"]');
    const out: { id: string; band: string | null }[] = [];
    if ((await front.count()) === 0) return out;
    const next = page.getByTestId("for-you-next");
    for (let i = 0; i < ROWS_PER_TILE; i++) {
        const id = (await front.getAttribute("data-job-id")) ?? "";
        const chip = front.locator('[aria-label$=" match"]');
        const label = (await chip.count()) > 0 ? await chip.first().getAttribute("aria-label") : null;
        out.push({ id, band: label?.replace(/ match$/, "") ?? null });
        if (!(await next.isEnabled())) break;
        await next.click();
        await expect(front).not.toHaveAttribute("data-job-id", id);
    }
    return out.filter((r) => r.id);
}

/** The full posting behind a row, from the same id lookup the job page uses. */
async function fetchPosting(page: Page, id: string): Promise<PublicJob | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await page.request.get(`/api/jobs/${encodeURIComponent(id)}/description`);
        if (res.status() === 429) {
            await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
            continue;
        }
        if (!res.ok()) return null;
        const body = (await res.json()) as { hits?: PublicJob[] };
        return body.hits?.[0] ?? null;
    }
    return null;
}

type ReportSection = { name: string; searched: string[]; verdicts: AuditVerdict[]; empty: HubPackId[] };

/**
 * Each résumé is its own test, and a résumé with findings must not stop the
 * others (serial mode skipped them). A failed test also restarts the worker,
 * so the report is merged on disk: this résumé's section replaces its last one.
 */
function writeReport(section: ReportSection) {
    mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, "pack-audit.json");
    let previous: ReportSection[] = [];
    try {
        previous = JSON.parse(readFileSync(jsonPath, "utf8")) as ReportSection[];
    } catch {
        previous = [];
    }
    const sections = [...previous.filter((s) => s.name !== section.name && RESUMES.includes(s.name)), section].sort(
        (a, b) => RESUMES.indexOf(a.name) - RESUMES.indexOf(b.name),
    );
    writeFileSync(path.join(OUT_DIR, "pack-audit.md"), renderAuditMarkdown(sections));
    writeFileSync(jsonPath, JSON.stringify(sections, null, 2));
}

for (const name of RESUMES) {
    test(`pack audit: ${name}`, async ({ page, baseURL }) => {
        test.setTimeout(30 * 60_000);
        const resume = loadResume(name);
        await signIn(page, baseURL);
        await seedResume(page, resume);
        await page.goto("/jobs?view=for-you");

        const verdicts: AuditVerdict[] = [];
        const empty: HubPackId[] = [];
        const postings = new Map<string, PublicJob | null>();
        for (const tile of await shownTiles(page)) {
            const rows = await openTile(page, tile);
            if (rows.length === 0) empty.push(tile);
            for (const [index, row] of rows.entries()) {
                if (!postings.has(row.id)) postings.set(row.id, await fetchPosting(page, row.id));
                const job = postings.get(row.id);
                if (!job) continue;
                verdicts.push(auditRecommendation({ resume, tile, position: index + 1, job, shownBand: row.band, nowMs: Date.now() }));
            }
            await page.getByTestId("jobs-back-to-packs").click();
            await page.waitForTimeout(TILE_PAUSE_MS);
        }

        writeReport({ name, searched: buildMatchQuery(resume).phrases, verdicts, empty });

        const failures = verdicts.filter((v) => failedChecks(v).length > 0).map((v) => `${v.tile} #${v.position} ${v.title} (${failedChecks(v).join(", ")})`);
        expect.soft(failures, `recommendations failing a check for ${name}`).toEqual([]);
        expect.soft(verdicts.length, `no recommendations were checked for ${name}`).toBeGreaterThan(0);
    });
}
