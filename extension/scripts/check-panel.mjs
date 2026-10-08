#!/usr/bin/env node
/**
 * Loads the built extension in Chromium and drives the side panel through
 * each state against a stubbed velai.app, printing what the panel says and
 * failing on any script error or a state that never finishes loading. It also
 * saves the panel screenshots the store listing is made from.
 *
 *   node extension/build.mjs && node extension/scripts/check-panel.mjs
 *
 * The job page and résumé are made up (fixtures/). Set CHROMIUM_PATH to use a
 * Chromium other than Playwright's own (in the cloud: /opt/pw-browsers/chromium).
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const unpacked = path.resolve(here, "../dist/unpacked");
const out = path.resolve(here, "../dist/check");
mkdirSync(out, { recursive: true });

const JOB_URL = "https://careers.cedarbrook.example/jobs/registered-nurse-icu";
const resumeText = readFileSync(path.join(here, "fixtures/resume.txt"), "utf8");
const jobHtml = readFileSync(path.join(here, "fixtures/job.html"), "utf8");
// The same function background.ts injects on a click, as a page script.
const reader = await build({
    entryPoints: [path.resolve(here, "../src/page-reader.ts")],
    bundle: true,
    format: "iife",
    globalName: "VelaiPageReader",
    write: false,
    alias: { "@": path.resolve(here, "../../src") },
    logLevel: "warning",
});
const readerJs = reader.outputFiles[0].text;

const now = Date.now();
const DAY = 86_400_000;
const ago = (ms) => new Date(now - ms).toISOString();
const base = { company_domain: null, location_state: null, work_type: "onsite", employment_type: "full_time", experience_level: "mid", visa_sponsorship: null, tags: [], source: "company_site", vacancy_status: "open", updated_at: ago(DAY / 2) };
const velaiCopy = {
    ...base, id: "job-cedar-rn-icu", title: "Registered Nurse - ICU", company: "Cedarbrook Health", company_domain: "cedarbrook.example",
    location: "Toronto, ON, Canada", location_city: "Toronto", location_state: "ON", location_country: "CA",
    description: "Join our 24-bed Intensive Care Unit and provide direct patient care to critically ill adults. Patient assessment, ventilator management and IV therapy. Medication administration and charting in Epic. Work with physicians, respiratory therapists and families. Requirements: Registered nurse licence with CNO, BLS and ACLS, 2+ years acute care experience.",
    salary_min: 41, salary_max: 58, salary_currency: "CAD", salary_period: "hour",
    apply_url: JOB_URL, posted_at: "2026-10-04T00:00:00Z", first_seen_at: "2026-10-04T06:00:00Z",
    ghost_badge: "clear", ghost_checked_at: ago(DAY / 3), last_observed_alive_at: ago(DAY / 4),
};
const similar = [
    { ...base, id: "s1", title: "Registered Nurse - Critical Care", company: "Riverside Health", location: "Mississauga, ON, Canada", location_city: "Mississauga", location_country: "CA", description: "Critical care nursing.", salary_min: null, salary_max: null, salary_currency: null, salary_period: null, apply_url: "https://jobs.riverside.example/rn-cc", posted_at: ago(2 * DAY), first_seen_at: ago(2 * DAY), ghost_badge: "clear", ghost_checked_at: ago(DAY / 2) },
    { ...base, id: "s2", title: "ICU Registered Nurse", company: "Lakeshore Hospital", location: "Toronto, ON, Canada", location_city: "Toronto", location_country: "CA", description: "ICU nursing.", salary_min: 40, salary_max: 55, salary_currency: "CAD", salary_period: "hour", apply_url: "https://careers.lakeshore.example/icu-rn", posted_at: ago(9 * DAY), first_seen_at: ago(9 * DAY), ghost_badge: "caution", ghost_checked_at: ago(DAY) },
    { ...base, id: "s3", title: "Registered Nurse, Emergency", company: "Harbourfront Clinic", location: "Toronto, ON, Canada", location_city: "Toronto", location_country: "CA", description: "Emergency nursing.", salary_min: null, salary_max: null, salary_currency: null, salary_period: null, apply_url: "https://harbourfront.example/careers/er", posted_at: ago(40 * DAY), first_seen_at: ago(40 * DAY), ghost_badge: "unscored", ghost_checked_at: null },
];
const signedIn = { signedIn: true, resume: { data: null, text: resumeText, updatedAt: "2026-10-07T15:00:00Z" }, preferences: null };
const PAGES = {
    job: { url: JOB_URL, html: jobHtml },
    board: { url: "https://jobs.board.example/view/48213", html: "<!doctype html><title>Registered Nurse - ICU | Cedarbrook Health | JobBoard</title><main><h1>Registered Nurse - ICU</h1><p>Cedarbrook Health, Toronto, ON</p><p>Patient care in the ICU: IV therapy, Epic charting, triage of critically ill patients. BLS and ACLS required.</p></main>" },
    blog: { url: "https://trails.example/blog/best-hikes", html: "<!doctype html><title>Best fall hikes near Toronto | Trail Notes</title><main><h1>Best fall hikes near Toronto</h1><p>Ten trails with great colours this October.</p></main>" },
};

/** Each state: what velai.app answers, the page clicked on, and what the panel must say. */
const STATES = {
    found: { me: signedIn, hits: [velaiCopy, ...similar], expect: ["Strong", "Actively posted", "lines that use this job's words now come first", "Download PDF"], pdf: true },
    "not-on-velai": { me: signedIn, hits: similar, expect: ["Not on Velai yet", "The page says apply by", "Similar roles on Velai"] },
    "signed-out": { me: { signedIn: false }, hits: [velaiCopy], expect: ["Sign in to Velai", "Actively posted"] },
    "no-resume": { me: { signedIn: true, resume: { data: null, text: null, updatedAt: null }, preferences: null }, hits: [velaiCopy], expect: ["Add your résumé"] },
    "velai-down": { me: 500, hits: 500, expect: ["Velai didn't answer", "Velai's search didn't answer"] },
    "board-match": { page: "board", me: signedIn, hits: [...similar, velaiCopy], expect: ["Velai's copy of the role it names", "Strong"] },
    "board-no-match": { page: "board", me: signedIn, hits: similar, expect: ["doesn't publish its job details", "Read this page as the job"], click: "Read this page as the job", expectAfter: ["as you asked", "Your résumé for this role"] },
    "not-a-job": { page: "blog", me: signedIn, hits: [], expect: ["Read this page as the job"], refuse: ["Your fit"] },
    selection: { search: "Registered Nurse - ICU", me: { signedIn: false }, hits: [velaiCopy, ...similar], expect: ["4 roles on Velai match"] },
};

const profile = mkdtempSync(path.join(tmpdir(), "velai-ext-"));
const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: process.env.CHROMIUM_PATH ? undefined : "chromium",
    executablePath: process.env.CHROMIUM_PATH || undefined,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
});
const failures = [];
try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const extensionId = new URL(worker.url()).host;
    let state = STATES.found;
    for (const page of Object.values(PAGES)) await context.route(page.url, (r) => r.fulfill({ contentType: "text/html", body: page.html }));
    const answer = (route, body) => (typeof body === "number" ? route.fulfill({ status: body, body: "" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
    await context.route("https://velai.app/api/extension/me", (r) => answer(r, state.me));
    await context.route("https://velai.app/api/jobs/search", (r) =>
        answer(r, typeof state.hits === "number" ? state.hits : { hits: state.hits, total: state.hits.length, backend: "meilisearch", configured: true }),
    );

    const tab = await context.newPage();
    await tab.setViewportSize({ width: 879, height: 800 });
    const reads = {};
    for (const [key, page] of Object.entries(PAGES)) {
        await tab.goto(page.url);
        await tab.addScriptTag({ content: readerJs });
        reads[key] = await tab.evaluate(() => globalThis.VelaiPageReader.readJobPage());
    }
    await tab.goto(JOB_URL);
    await tab.screenshot({ path: path.join(out, "job-page.png") });
    await tab.evaluate(() => getSelection().selectAllChildren(document.querySelector("h1")));
    await tab.screenshot({ path: path.join(out, "job-page-selected.png") });

    for (const [name, s] of Object.entries(STATES)) {
        state = s;
        const read = reads[s.page ?? "job"];
        const handOff = s.search
            ? { kind: "search", q: s.search, site: new URL(JOB_URL).hostname, at: Date.now() }
            : { kind: "page", read, site: new URL(read.url).hostname, at: Date.now() };
        await worker.evaluate((value) => chrome.storage.session.set({ pageQuery: value }), handOff);
        const panel = await context.newPage();
        const errors = [];
        panel.on("pageerror", (e) => errors.push(e.message));
        await panel.setViewportSize({ width: 400, height: 800 });
        await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        const settled = () => panel.waitForFunction(() => !document.querySelector(".status"), null, { timeout: 15_000 });
        await settled().catch(() => errors.push("still loading after 15 s"));
        let text = await panel.evaluate(() => document.body.innerText);
        const missing = s.expect.filter((t) => !text.includes(t));
        const unwanted = (s.refuse ?? []).filter((t) => text.includes(t));
        if (s.click) {
            await panel.click(`text=${s.click}`);
            await settled();
            text = await panel.evaluate(() => document.body.innerText);
            missing.push(...s.expectAfter.filter((t) => !text.includes(t)));
        }
        await panel.screenshot({ path: path.join(out, `${name}.png`) });
        if (s.pdf) {
            await panel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await panel.screenshot({ path: path.join(out, `${name}-bottom.png`) });
            const [download] = await Promise.all([panel.waitForEvent("download", { timeout: 15_000 }), panel.click("text=Download PDF")]);
            const file = path.join(out, download.suggestedFilename());
            await download.saveAs(file);
            if (statSync(file).size < 1000) errors.push(`PDF is only ${statSync(file).size} bytes`);
        }
        const ok = !errors.length && !missing.length && !unwanted.length;
        console.log(`${ok ? "ok  " : "FAIL"} ${name}${missing.length ? ` — missing: ${missing.join(" | ")}` : ""}${unwanted.length ? ` — shouldn't say: ${unwanted.join(" | ")}` : ""}${errors.length ? ` — ${errors.join("; ")}` : ""}`);
        if (!ok) failures.push(name);
        await panel.close();
    }
} finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
}
console.log(`Screenshots in ${path.relative(process.cwd(), out)}`);
if (failures.length) process.exit(1);
