#!/usr/bin/env node
/**
 * Loads the built extension in Chromium and drives the side panel through
 * each state against a stubbed velai.app, printing what the panel says and
 * failing on any script error or a state that never finishes loading. Then
 * the on-page card: it shows on its own on a listed job site with sourced
 * lines, stays away from a page that isn't a job, signs in through a small
 * window that closes itself and re-checks, opens the panel, saves "I
 * applied" and "Save". It also saves the screenshots the store listing is made from.
 *
 *   node extension/build.mjs && node extension/scripts/check-panel.mjs
 *
 * The job page and résumé are made up (fixtures/). Set CHROMIUM_PATH to use a
 * Chromium other than Playwright's own (in the cloud: /opt/pw-browsers/chromium).
 */
import { build } from "esbuild";
import { chromium } from "playwright";

// Lets context.route() answer the service worker's own velai.app calls (the card's lookups).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
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
/** Signed in without a paid month: /api/extension/me gives no résumé. */
const unpaid = { signedIn: true, paid: false, resume: null, preferences: null };
// The résumé velai.app keeps in this browser, structured the way the site stores it (velai.localAi.resume).
const parser = await build({
    stdin: { contents: 'export { storedResumeData } from "@/lib/resume/stored-resume-data";', resolveDir: path.resolve(here, "../../src"), loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    alias: { "@": path.resolve(here, "../../src") },
    logLevel: "warning",
});
const { storedResumeData } = await import(`data:text/javascript;base64,${Buffer.from(parser.outputFiles[0].text).toString("base64")}`);
const SITE_RESUME_KEY = "velai.localAi.resume";
const siteResume = { data: storedResumeData(undefined, resumeText), updatedAt: "2026-10-20T10:00:00.000Z", sourceLabel: "resume.pdf" };
/** The extension's copy of it (device-resume.ts), as the service worker keeps it. */
const deviceResume = { data: siteResume.data, updatedAt: siteResume.updatedAt };
/** A velai.app page, where velai-bridge.ts runs. */
const BRIDGE_URL = "https://velai.app/jobs";
/** A listed job site (job-sites.json), where the card shows on its own. */
const BOARD_JOB_URL = "https://boards.greenhouse.io/cedarbrook/jobs/4821";
const BOARD_LIST_URL = "https://boards.greenhouse.io/cedarbrook";
/** A careers page that publishes no JobPosting and writes its place as a country code (as some large employers' sites do). */
const CODED_TITLE = "Registered Nurse - ICU - Toronto, CAN , Critical Care";
const codedHtml = `<!doctype html><title>${CODED_TITLE} - Job ID: 7781 | Harbourline Careers</title><main><h1>${CODED_TITLE}</h1><p>Job ID: 7781 | Harbourline Health</p><button>Apply now</button><h2>Description</h2><p>Provide direct patient care to critically ill adults in our ICU: patient assessment, IV therapy, Epic charting.</p><h2>Basic qualifications</h2><p>Registered nurse licence, BLS and ACLS.</p><h2>Job details</h2><p>CAN, ON, Toronto</p></main>`;
const CODED_URL = "https://careers.harbourline.example/en/jobs/7781/registered-nurse-icu";
/** The same kind of page on a listed job site, where the card shows on its own. */
const BOARD_CODED_URL = "https://boards.greenhouse.io/harbourline/jobs/7781";
/** A one-page application form under the job, on a listed job site; sending it opens a thank-you page. */
const FORM_JOB_URL = "https://job-boards.greenhouse.io/cedarbrook/jobs/4821";
const FORM_CONFIRM_URL = "https://job-boards.greenhouse.io/cedarbrook/jobs/4821/confirmation";
const formHtml = jobHtml.replace(
    "</main>",
    `<form id="application-form" action="/cedarbrook/jobs/4821/confirmation" method="get">
<h2>Apply for this job</h2>
<p><label for="first_name">First Name *</label><br><input id="first_name" name="first_name" autocomplete="given-name"></p>
<p><label for="last_name">Last Name *</label><br><input id="last_name" name="last_name" autocomplete="family-name"></p>
<p><label for="email">Email *</label><br><input id="email" name="email"></p>
<p><label for="phone">Phone</label><br><input id="phone" name="phone" type="tel"></p>
<p><label for="question_9001">LinkedIn Profile</label><br><input id="question_9001" name="question_9001"></p>
<p><label for="question_9002">Who referred you? (name)</label><br><input id="question_9002" name="question_9002"></p>
<p><label for="candidate-location">Location (City)</label><br><input id="candidate-location" role="combobox" aria-autocomplete="list"></p>
<div><div id="upload-label-resume">Resume/CV *</div><button type="button">Attach</button><input type="file" id="resume" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" aria-labelledby="upload-label-resume"></div>
<div><div id="upload-label-cover_letter">Cover Letter</div><button type="button">Attach</button><input type="file" id="cover_letter" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" aria-labelledby="upload-label-cover_letter"></div>
<p><label for="auth">Are you legally authorized to work in Canada? *</label><br><select id="auth"><option></option><option>Yes</option><option>No</option></select></p>
<button type="submit" id="submit-app">Submit application</button>
</form></main>`,
);
/** The same job with an application form whose free-text questions the card drafts answers to on a tap. */
const QUESTIONS_URL = "https://job-boards.greenhouse.io/cedarbrook/jobs/4822";
const questionsHtml = jobHtml.replace(
    "</main>",
    `<form id="application-form" action="/cedarbrook/jobs/4822/confirmation" method="get">
<h2>Apply for this job</h2>
<p><label for="first_name">First Name *</label><br><input id="first_name" name="first_name" autocomplete="given-name"></p>
<p><label for="last_name">Last Name *</label><br><input id="last_name" name="last_name" autocomplete="family-name"></p>
<p><label for="email">Email *</label><br><input id="email" name="email"></p>
<p><label for="current_company">Current company</label><br><input id="current_company" name="current_company"></p>
<p><label for="q_why">Why are you interested in this role? *</label><br><textarea id="q_why" name="q_why"></textarea></p>
<p><label for="q_iv">Describe your experience with IV therapy.</label><br><textarea id="q_iv" name="q_iv"></textarea></p>
<p><label for="q_strength">What is your biggest strength?</label><br><textarea id="q_strength" name="q_strength">I already wrote this one.</textarea></p>
<p><label for="q_pay">What are your salary expectations?</label><br><textarea id="q_pay" name="q_pay"></textarea></p>
<p><label for="q_cover">Cover letter</label><br><textarea id="q_cover" name="q_cover"></textarea></p>
<p><label for="q_hear">How did you hear about this job?</label><br><input id="q_hear" name="q_hear"></p>
<div class="application-label">Describe your experience with Kubernetes clusters.</div><div><textarea id="q_kube" name="cards[kube]"></textarea></div>
<p><label for="auth">Are you legally authorized to work in Canada? *</label><br><select id="auth"><option></option><option>Yes</option><option>No</option></select></p>
<button type="submit" id="submit-app">Submit application</button>
</form>
<script>window.__events = []; for (const t of ["input", "change"]) document.addEventListener(t, (e) => __events.push(t + ":" + e.target.id), true);</script></main>`,
);
const confirmHtml = "<!doctype html><title>Thank you | Cedarbrook Health</title><main><h1>Thank you for applying to Cedarbrook Health!</h1><p>We received your application for Registered Nurse - ICU.</p></main>";
/** A job page and its application form on a page of its own, which confirms in place (as single-page forms do). */
const SPLIT_JOB_URL = "https://jobs.lever.co/harbourline/7781";
const SPLIT_APPLY_URL = "https://jobs.lever.co/harbourline/7781/apply";
const splitJobHtml = jobHtml.replaceAll("Cedarbrook Health", "Harbourline Health").replace('href="#apply"', 'href="/harbourline/7781/apply"');
const applyHtml = readFileSync(path.join(here, "fixtures/apply.html"), "utf8");
const PAGES = {
    job: { url: JOB_URL, html: jobHtml },
    coded: { url: CODED_URL, html: codedHtml },
    board: { url: "https://jobs.board.example/view/48213", html: "<!doctype html><title>Registered Nurse - ICU | Cedarbrook Health | JobBoard</title><main><h1>Registered Nurse - ICU</h1><p>Cedarbrook Health, Toronto, ON</p><p>Patient care in the ICU: IV therapy, Epic charting, triage of critically ill patients. BLS and ACLS required.</p></main>" },
    blog: { url: "https://trails.example/blog/best-hikes", html: "<!doctype html><title>Best fall hikes near Toronto | Trail Notes</title><main><h1>Best fall hikes near Toronto</h1><p>Ten trails with great colours this October.</p></main>" },
};

/** Each state: what velai.app answers, the page clicked on, and what the panel must say. */
const STATES = {
    found: { me: signedIn, hits: [velaiCopy, ...similar], expect: ["Strong", "Actively posted", "Lines that use the posting's words now come first.", "0 of 3 accepted", "Accept all", "Your résumé", "Proposed", "Core skills include IV therapy, Medication administration and Epic.", "Download PDF"], order: ["Your fit", "Velai's checks"], pdf: true },
    "not-on-velai": { me: signedIn, hits: similar, expect: ["Not on Velai yet", "The page says apply by", "Similar roles on Velai", "✓ Registered", "✗ ICU"], has: [".rows .row-fit"] },
    // No résumé anywhere: add one on velai.app (free, kept in this browser), or sign in to an account that has one.
    "signed-out": {
        me: { signedIn: false },
        hits: [velaiCopy],
        expect: ["Add your résumé", "Free, and no account needed", "Your résumé is on your Velai account?", "Actively posted"],
        order: ["Velai's checks", "Your fit"],
    },
    "no-resume": { me: { signedIn: true, paid: true, resume: { data: null, text: null, updatedAt: null }, preferences: null }, hits: [velaiCopy], expect: ["Add your résumé"], refuse: ["no account needed"], order: ["Velai's checks", "Your fit"] },
    // Signed in without a paid month and nothing in this browser yet: the same free offer, never "couldn't load your résumé".
    unpaid: { me: unpaid, hits: [velaiCopy], expect: ["Add your résumé", "Free, and no account needed"], refuse: ["couldn't load", "Your résumé is on your Velai account?"], order: ["Velai's checks", "Your fit"] },
    "velai-down": { me: 500, hits: 500, expect: ["Velai didn't answer", "Velai's search didn't answer"] },
    // The résumé velai.app keeps in this browser: fit, proposed changes and the PDF with no account; the tracker needs one.
    "browser-resume": {
        me: { signedIn: false },
        device: true,
        hits: [velaiCopy, ...similar],
        expect: ["Strong", "Against the résumé velai.app keeps in this browser", "Your résumé for this role", "Download PDF"],
        refuse: ["I applied", "Add your résumé"],
        order: ["Your fit", "Velai's checks"],
        pdf: true,
    },
    "unpaid-browser-resume": { me: unpaid, device: true, hits: [velaiCopy], expect: ["Strong", "Against the résumé velai.app keeps in this browser", "I applied"], order: ["Your fit", "Velai's checks"] },
    "velai-down-browser-resume": { me: 500, hits: 500, device: true, expect: ["Your fit", "Against the résumé velai.app keeps in this browser", "Velai's search didn't answer"], refuse: ["your fit can't be shown"] },
    // A paid month's account résumé comes first; this browser's copy doesn't replace it.
    "account-over-browser": { me: signedIn, device: true, hits: [velaiCopy], expect: ["Strong", "against your résumé of oct 7"], refuse: ["keeps in this browser"] },
    "board-match": { page: "board", me: signedIn, hits: [...similar, velaiCopy], expect: ["Velai's copy of the role it names", "Strong"] },
    "board-no-match": { page: "board", me: signedIn, hits: similar, expect: ["doesn't publish its job details", "Read this page as the job"], click: "Read this page as the job", expectAfter: ["as you asked", "Your résumé for this role"] },
    "not-a-job": { page: "blog", me: signedIn, hits: [], expect: ["Read this page as the job"], refuse: ["Your fit"] },
    "careers-no-details": {
        page: "coded",
        me: signedIn,
        hits: similar,
        expect: ["Read from the heading and text", "same country"],
        refuse: ["Read this page as the job", "Country unclear"],
    },
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
    /** Sets (or, with null, removes) the extension's copy of the browser résumé, as the service worker keeps it. */
    const setDevice = (value) => worker.evaluate((v) => (v ? chrome.storage.local.set({ velaiDeviceResume: v }) : chrome.storage.local.remove("velaiDeviceResume")), value);
    let state = STATES.found;
    for (const page of Object.values(PAGES)) await context.route(page.url, (r) => r.fulfill({ contentType: "text/html", body: page.html }));
    const answer = (route, body) => (typeof body === "number" ? route.fulfill({ status: body, body: "" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
    await context.route("https://velai.app/api/extension/me", (r) => answer(r, state.me));
    const searchBodies = [];
    await context.route("https://velai.app/api/jobs/search", (r) => {
        searchBodies.push(JSON.parse(r.request().postData() ?? "{}"));
        return answer(r, typeof state.hits === "number" ? state.hits : { hits: state.hits, total: state.hits.length, backend: "meilisearch", configured: true });
    });
    const tracked = [];
    /** What the tracker route answers a "Save": the role's status after it, or an HTTP status for a failure. */
    let saveReply = { ok: true, id: "app-1", status: "interested" };
    await context.route("https://velai.app/api/extension/track", (r) => {
        const body = JSON.parse(r.request().postData() ?? "{}");
        tracked.push({ type: r.request().headers()["content-type"], body });
        return answer(r, body.stage === "saved" ? saveReply : { ok: true, id: "app-1" });
    });
    await context.route(/^https:\/\/velai\.app\/(login|yours|resume)/, (r) =>
        r.fulfill({ contentType: "text/html", body: `<!doctype html><title>Velai</title><h1>${new URL(r.request().url()).pathname}</h1>` }),
    );
    await context.route(BRIDGE_URL, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Velai</title><h1>Jobs</h1>" }));
    await context.route(BOARD_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: jobHtml }));
    await context.route(BOARD_CODED_URL, (r) => r.fulfill({ contentType: "text/html", body: codedHtml }));
    await context.route(BOARD_LIST_URL, (r) => r.fulfill({ contentType: "text/html", body: PAGES.blog.html }));
    await context.route(FORM_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: formHtml }));
    await context.route(QUESTIONS_URL, (r) => r.fulfill({ contentType: "text/html", body: questionsHtml }));
    await context.route(`${FORM_CONFIRM_URL}**`, (r) => r.fulfill({ contentType: "text/html", body: confirmHtml }));
    await context.route(SPLIT_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: splitJobHtml }));
    await context.route(SPLIT_APPLY_URL, (r) => r.fulfill({ contentType: "text/html", body: applyHtml }));

    // First install opens the welcome page, which offers to add a résumé (free, kept in this browser) or sign in right there.
    state = { me: { signedIn: false } };
    let welcome = context.pages().find((p) => p.url().endsWith("/welcome.html")) ?? (await context.waitForEvent("page", { timeout: 5_000 }).catch(() => null));
    if (!welcome?.url().endsWith("/welcome.html")) {
        // Chrome can open it before this script is listening; the page's content is still checked below.
        console.log("     (welcome page opened on install wasn't seen; opening it by hand)");
        welcome = await context.newPage();
        await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
    }
    {
        await welcome.setViewportSize({ width: 1280, height: 800 });
        await welcome.reload();
        await welcome.waitForFunction(() => document.body.innerText.includes("Sign in to Velai"), null, { timeout: 10_000 }).catch(() => {});
        let text = await welcome.evaluate(() => document.body.innerText);
        // No account or payment needed, said before the ask to add a résumé, which comes before signing in.
        const at = (t) => text.indexOf(t);
        const problems = [];
        for (const t of ["None of that needs an account or a payment", "Add your résumé", "Sign in to Velai", "How it works", "Free, and no account needed"]) if (at(t) < 0) problems.push(`missing "${t}"`);
        if (!(at("None of that needs an account") < at("Add your résumé") && at("Add your résumé") < at("Sign in to Velai"))) problems.push("order");
        await welcome.screenshot({ path: path.join(out, "welcome.png") });
        // With the résumé velai.app keeps in this browser, it says Velai has it.
        await setDevice(deviceResume);
        await welcome.reload();
        await welcome.waitForFunction(() => document.body.innerText.includes("Velai has your résumé in this browser"), null, { timeout: 10_000 }).catch(() => problems.push("doesn't say it has the browser's résumé"));
        text = await welcome.evaluate(() => document.body.innerText);
        if (text.includes("Add your résumé")) problems.push("still asks for a résumé");
        await setDevice(null);
        console.log(`${problems.length ? "FAIL" : "ok  "} welcome${problems.length ? ` — ${problems.join(" | ")}` : ""}`);
        if (problems.length) failures.push("welcome");
        await welcome.close();
    }

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
        await setDevice(s.device ? deviceResume : null);
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
        for (const selector of s.has ?? []) if (!(await panel.$(selector))) missing.push(selector);
        const unwanted = (s.refuse ?? []).filter((t) => text.includes(t));
        // What the panel can already say comes first: the fit with a résumé, else the posting checks.
        for (let i = 1; i < (s.order ?? []).length; i++) {
            if (!(text.indexOf(s.order[i - 1]) >= 0 && text.indexOf(s.order[i - 1]) < text.indexOf(s.order[i]))) missing.push(`"${s.order[i - 1]}" before "${s.order[i]}"`);
        }
        // Low vision: no text in the panel under 14px.
        const smallest = await panel.evaluate(() => {
            let min = Infinity;
            for (const node of document.querySelectorAll("body *")) {
                const hasText = [...node.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
                if (hasText && node.getClientRects().length) min = Math.min(min, parseFloat(getComputedStyle(node).fontSize));
            }
            return min;
        });
        if (smallest < 14) errors.push(`text at ${smallest}px`);
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
    await setDevice(null);

    // ── The on-page card ──────────────────────────────────────────────────
    /** The card's text and button boxes, read through Chrome's DevTools (the card is in a closed shadow root). */
    async function readCard(page) {
        const cdp = await context.newCDPSession(page);
        try {
            const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
            const find = (n) => {
                if (n.attributes?.includes("velai-card-host")) return n;
                for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) {
                    const f = find(c);
                    if (f) return f;
                }
                return null;
            };
            const host = find(root);
            if (!host) return null;
            const texts = [];
            const buttons = [];
            const walk = (n) => {
                if (n.nodeName === "STYLE") return;
                if (n.nodeType === 3) texts.push(n.nodeValue);
                if (n.nodeName === "BUTTON") buttons.push({ nodeId: n.nodeId, text: (n.children ?? []).filter((c) => c.nodeType === 3).map((c) => c.nodeValue).join("") });
                for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c);
            };
            walk(host);
            for (const b of buttons) {
                // A button the card just replaced has no box any more.
                const box = await cdp.send("DOM.getBoxModel", { nodeId: b.nodeId }).catch(() => null);
                if (!box) continue;
                const q = box.model.content;
                b.x = (q[0] + q[4]) / 2;
                b.y = (q[1] + q[5]) / 2;
            }
            return { text: texts.join(" ").replace(/\s+/g, " "), buttons };
        } finally {
            await cdp.detach();
        }
    }
    async function waitForCard(page, want, timeout = 10_000) {
        const until = Date.now() + timeout;
        let card = null;
        while (Date.now() < until) {
            card = await readCard(page);
            if (card && want.every((t) => card.text.includes(t))) return card;
            await page.waitForTimeout(250);
        }
        return card;
    }
    async function clickCard(page, label, index = 0) {
        const card = await readCard(page);
        const b = card?.buttons.filter((x) => x.text.startsWith(label) && x.x != null)[index];
        if (!b) throw new Error(`no "${label}" button (${index}) on the card`);
        await page.mouse.click(b.x, b.y);
    }
    /** The text of the résumé PDF the card attached to the form's "resume" upload (its streams are deflated; the text is plain `(…) Tj` strings inside). */
    async function attachedPdfText(page) {
        const bytes = await page.evaluate(async () => {
            const f = document.getElementById("resume").files[0];
            return f ? Array.from(new Uint8Array(await f.arrayBuffer())) : null;
        });
        if (!bytes) return null;
        const pdf = Buffer.from(bytes).toString("latin1");
        const content = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
            .map((m) => {
                const raw = Buffer.from(m[1], "latin1");
                try {
                    return inflateSync(raw).toString("latin1");
                } catch {
                    return raw.toString("latin1");
                }
            })
            .join("\n");
        return [...content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1")).join(" ").replace(/\s+/g, " ");
    }
    function report(name, problems) {
        console.log(`${problems.length ? "FAIL" : "ok  "} card: ${name}${problems.length ? ` — ${problems.join(" | ")}` : ""}`);
        if (problems.length) failures.push(`card: ${name}`);
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // Signed in, Velai has the posting: fit and sourced lines, without a click.
    state = STATES.found;
    searchBodies.length = 0;
    await page.goto(BOARD_JOB_URL);
    let card = await waitForCard(page, ["Strong", "against your résumé"]);
    {
        const want = ["Registered Nurse - ICU · Cedarbrook Health", "Strong", "✓ Registered", "✓ Nurse", "✗ ICU", "Actively posted · Velai, checked", "Posted", "· the page", "Apply by", "Your résumé for this job", "I applied"];
        const problems = want.filter((t) => !card?.text.includes(t)).map((t) => `missing "${t}"`);
        if (!searchBodies.some((b) => b.automatic === true)) problems.push("lookup not marked automatic");
        report("shows on its own on a job site", problems);
        await page.screenshot({ path: path.join(out, "card-found.png") });
    }

    // A job page with no JobPosting that Velai doesn't have still gets a card, with the country its heading names.
    state = { ...STATES.found, hits: similar };
    await page.goto(BOARD_CODED_URL);
    {
        const coded = await waitForCard(page, ["against your résumé"]);
        const problems = [];
        if (!coded) problems.push("no card");
        else if (coded.text.includes("Country unclear")) problems.push("Country unclear");
        report("job page without job data", problems);
    }
    state = STATES.found;
    await page.goto(BOARD_JOB_URL);
    card = await waitForCard(page, ["Strong", "against your résumé"]);

    // "I applied" saves to the tracker with Velai's job id.
    tracked.length = 0;
    await clickCard(page, "I applied");
    card = await waitForCard(page, ["Added to your Velai tracker"]);
    {
        const problems = [];
        if (!card?.text.includes("Added to your Velai tracker as Applied")) problems.push("no confirmation");
        await page.screenshot({ path: path.join(out, "card-applied.png") });
        const sent = tracked[0];
        if (!sent) problems.push("nothing sent");
        else {
            if (sent.type !== "application/json") problems.push(`content-type ${sent.type}`);
            if (sent.body.jobId !== velaiCopy.id || sent.body.company !== "Cedarbrook Health") problems.push(`sent ${JSON.stringify(sent.body)}`);
        }
        report("I applied", problems);
    }

    // "Save" puts the job in the tracker's Saved column and doesn't say the person applied; "I applied" stays.
    tracked.length = 0;
    await page.reload();
    card = await waitForCard(page, ["Your résumé for this job", "I applied"]);
    {
        const problems = [];
        if (!card?.buttons.some((b) => b.text === "Save")) problems.push("no Save button");
        else {
            await clickCard(page, "Save");
            card = await waitForCard(page, ["Saved to your Velai tracker"]);
            if (!card?.text.includes("Saved to your Velai tracker")) problems.push(`card says: ${card?.text}`);
            if (card?.text.includes("as Applied")) problems.push("said Applied");
            if (!card?.buttons.some((b) => b.text === "I applied")) problems.push("I applied went away after saving");
            await page.screenshot({ path: path.join(out, "card-saved.png") });
            const sent = tracked[0];
            if (tracked.length !== 1) problems.push(`tracked ${tracked.length} times`);
            else {
                if (sent.type !== "application/json") problems.push(`content-type ${sent.type}`);
                if (sent.body.stage !== "saved" || sent.body.jobId !== velaiCopy.id || sent.body.company !== "Cedarbrook Health" || sent.body.title !== "Registered Nurse - ICU") problems.push(`sent ${JSON.stringify(sent.body)}`);
            }
        }
        report("Save puts the job in the tracker as Saved, without applying", problems);
    }
    // A role already further along keeps its status, and the card says so instead of "Saved".
    saveReply = { ok: true, id: "app-1", status: "applied" };
    await page.reload();
    card = await waitForCard(page, ["Your résumé for this job", "I applied"]);
    {
        const problems = [];
        await clickCard(page, "Save");
        card = await waitForCard(page, ["Already in your Velai tracker"]);
        if (!card?.text.includes("Already in your Velai tracker as Applied")) problems.push(`card says: ${card?.text}`);
        if (card?.text.includes("Saved to your Velai tracker")) problems.push("said Saved for a role that is applied");
        report("Save on a role already applied says so", problems);
    }
    // Velai not answering: the card says so and Save can be tried again.
    saveReply = 500;
    await page.reload();
    card = await waitForCard(page, ["Your résumé for this job", "I applied"]);
    {
        const problems = [];
        await clickCard(page, "Save");
        card = await waitForCard(page, ["Try again"]);
        if (!card?.text.includes("Velai didn't answer. Try again")) problems.push(`card says: ${card?.text}`);
        saveReply = { ok: true, id: "app-1", status: "interested" };
        await clickCard(page, "Velai didn't answer.");
        card = await waitForCard(page, ["Saved to your Velai tracker"]);
        if (!card?.text.includes("Saved to your Velai tracker")) problems.push(`after retry, card says: ${card?.text}`);
        report("Save that fails says so and works on a second try", problems);
    }

    // The card's button opens the panel on this job.
    {
        const before = new Set(context.pages());
        await page.reload();
        await waitForCard(page, ["Your résumé for this job"]);
        await clickCard(page, "Your résumé for this job");
        await page.waitForTimeout(1_500);
        const panel = context.pages().find((p) => !before.has(p) && p.url().endsWith("/sidepanel.html"));
        const how = panel ? "a window (Chrome didn't carry the click to the side panel here)" : "the side panel";
        const problems = [];
        if (panel) {
            await panel.waitForFunction(() => document.body.innerText.includes("Your fit"), null, { timeout: 15_000 }).catch(() => problems.push("panel window never showed the fit"));
            await panel.close();
        } else {
            // A real side panel isn't a page Playwright lists; check the hand-off it reads.
            const handed = await worker.evaluate(() => chrome.storage.session.get("pageQuery"));
            if (handed.pageQuery?.read?.url !== BOARD_JOB_URL) problems.push("panel wasn't handed this job");
        }
        console.log(`     panel opened in ${how}`);
        report("opens the panel", problems);
    }

    // A single-page site moving to a page that isn't a job (LinkedIn does this): the card goes.
    await page.evaluate(() => {
        document.querySelector('script[type="application/ld+json"]')?.remove();
        document.title = "All jobs at Cedarbrook Health";
        document.querySelector("main").innerHTML = "<h1>All jobs</h1>";
        history.pushState(null, "", "/cedarbrook");
    });
    await page.waitForTimeout(5_000);
    report("leaves when a single-page site moves off the job", (await readCard(page)) ? ["the old card stayed"] : []);

    // Not a job: no card.
    await page.goto(BOARD_LIST_URL);
    await page.waitForTimeout(4_000);
    report("no card on a page that isn't a job", (await readCard(page)) ? ["a card showed"] : []);

    // Signed out: sign in through a small window that closes itself, then the card re-checks on its own.
    state = { ...STATES.found, me: { signedIn: false } };
    const accountChanged = () => worker.evaluate(() => chrome.storage.local.set({ velaiAccountChangedAt: Date.now() }));
    await accountChanged();
    await page.goto(BOARD_JOB_URL);
    card = await waitForCard(page, ["Add your résumé to see your fit"]);
    {
        const problems = [];
        // Leads with the posting's facts; then the free ask (add a résumé), then signing in.
        const at = (t) => card?.text.indexOf(t) ?? -1;
        if (!(at("Actively posted") >= 0 && at("Actively posted") < at("Add your résumé to see your fit"))) problems.push("facts don't come before the résumé button");
        if (!card?.buttons.some((b) => b.text === "Sign in")) problems.push("no Sign in button");
        if (card?.text.includes("I applied")) problems.push("offers I applied while signed out");
        if (card?.buttons.some((b) => b.text === "Save")) problems.push("offers Save while signed out");
        await page.screenshot({ path: path.join(out, "card-signed-out.png") });
        const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 10_000 }), clickCard(page, "Sign in")]);
        await popup.waitForLoadState().catch(() => {});
        // What Chrome opened, as the extension sees it (a window an extension opens can load before Playwright routes it).
        const opened = await worker.evaluate(async () => {
            const { velaiWindow } = await chrome.storage.session.get("velaiWindow");
            const [tab] = await chrome.tabs.query({ windowId: velaiWindow.windowId });
            return tab.pendingUrl ?? tab.url;
        });
        if (opened !== "https://velai.app/login?next=%2Fyours") problems.push(`window opened ${opened}`);
        state = STATES.found;
        const closed = popup.waitForEvent("close", { timeout: 10_000 }).then(() => true, () => false);
        await popup.goto("https://velai.app/yours").catch(() => {});
        if (!(await closed)) problems.push("sign-in window didn't close itself");
        card = await waitForCard(page, ["Strong"]);
        if (!card?.text.includes("Strong")) problems.push("card didn't re-check after sign-in");
        report("sign-in window closes and the card re-checks", problems);
    }

    // The panel's own sign-in does the same.
    state = { ...STATES.found, me: { signedIn: false } };
    {
        const read = reads.job;
        await worker.evaluate((value) => chrome.storage.session.set({ pageQuery: value }), { kind: "page", read, site: new URL(read.url).hostname, at: Date.now(), tabId: 1 });
        const panel = await context.newPage();
        await panel.setViewportSize({ width: 400, height: 800 });
        await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        const problems = [];
        await panel.waitForFunction(() => document.body.innerText.includes("Your résumé is on your Velai account?"), null, { timeout: 15_000 }).catch(() => problems.push("no sign-in offer"));
        const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 10_000 }), panel.click('button.inline:has-text("Sign in")')]);
        await popup.waitForLoadState().catch(() => {});
        state = STATES.found;
        const closed = popup.waitForEvent("close", { timeout: 10_000 }).then(() => true, () => false);
        await popup.goto("https://velai.app/yours").catch(() => {});
        if (!(await closed)) problems.push("sign-in window didn't close itself");
        await panel.waitForFunction(() => document.body.innerText.includes("Strong"), null, { timeout: 15_000 }).catch(() => problems.push("panel didn't re-check after sign-in"));
        const text = await panel.evaluate(() => document.body.innerText);
        for (const t of ["Edit your résumé on Velai", "I applied", "Show the Velai card on every careers site", "only on careers.cedarbrook.example"]) if (!text.includes(t)) problems.push(`missing "${t}"`);
        await panel.screenshot({ path: path.join(out, "panel-after-sign-in.png"), fullPage: true });
        report("panel sign-in re-checks; edit, applied and card offer show", problems);
        await panel.close();
    }
    // The panel's own Save, beside "I applied".
    state = STATES.found;
    tracked.length = 0;
    saveReply = { ok: true, id: "app-1", status: "interested" };
    {
        const read = reads.job;
        await worker.evaluate((value) => chrome.storage.session.set({ pageQuery: value }), { kind: "page", read, site: new URL(read.url).hostname, at: Date.now(), tabId: 1 });
        const panel = await context.newPage();
        await panel.setViewportSize({ width: 400, height: 800 });
        await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        const problems = [];
        await panel.waitForSelector('button:has-text("Save")', { timeout: 15_000 }).catch(() => problems.push("no Save button in the panel"));
        if (!problems.length) {
            await panel.click('button:has-text("Save")');
            await panel.waitForFunction(() => document.body.innerText.includes("Saved to your Velai tracker"), null, { timeout: 10_000 }).catch(() => problems.push("panel never said it saved"));
            const sent = tracked[0];
            if (tracked.length !== 1 || sent.body.stage !== "saved" || sent.body.jobId !== velaiCopy.id) problems.push(`sent ${JSON.stringify(tracked.map((t) => t.body))}`);
            const text = await panel.evaluate(() => document.body.innerText);
            if (!text.includes("I applied")) problems.push("I applied went away after saving");
            await panel.screenshot({ path: path.join(out, "panel-saved.png"), fullPage: true });
        }
        report("panel Save puts the job in the tracker as Saved", problems);
        await panel.close();
    }

    // No account: the résumé velai.app keeps in this browser reaches the extension from a velai.app page (velai-bridge.ts),
    // the card scores the job with it, and it leaves when velai.app's copy does. Only velai.app's pages can set it.
    {
        const problems = [];
        state = { ...STATES.found, me: { signedIn: false } };
        await setDevice(null);
        const stored = () => worker.evaluate(() => chrome.storage.local.get("velaiDeviceResume").then((s) => s.velaiDeviceResume ?? null));
        const until = async (want, ms = 8_000) => {
            const end = Date.now() + ms;
            let value = await stored();
            while (Date.now() < end && Boolean(value) !== want) {
                await page.waitForTimeout(250);
                value = await stored();
            }
            return value;
        };
        // Another sender (here, the extension's own panel page) can't set it.
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        const refused = await panel.evaluate((raw) => chrome.runtime.sendMessage({ type: "deviceResume", raw }), JSON.stringify(siteResume));
        if (refused !== false || (await stored())) problems.push("a page other than velai.app set the browser résumé");
        await panel.close();

        const site = await context.newPage();
        await site.goto(BRIDGE_URL);
        await site.evaluate(([key, value]) => localStorage.setItem(key, value), [SITE_RESUME_KEY, JSON.stringify(siteResume)]);
        const copy = await until(true);
        if (!copy) problems.push("velai.app's résumé never reached the extension");
        else {
            // Chrome's storage hands objects back with their keys sorted, so compare key order aside.
            const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
            if (canonical(copy.data) !== canonical(siteResume.data) || copy.updatedAt !== siteResume.updatedAt) problems.push("the copy differs from velai.app's");
            if ("sourceLabel" in copy) problems.push("kept more than the résumé and its date");
        }
        await accountChanged();
        await page.goto(BOARD_JOB_URL);
        card = await waitForCard(page, ["Strong"]);
        if (!card?.text.includes("Strong")) problems.push(`card didn't score with it: ${card?.text.slice(0, 200)}`);
        if (card?.text.includes("I applied") || card?.buttons.some((b) => b.text === "Save")) problems.push("offers the tracker without an account");
        await page.screenshot({ path: path.join(out, "card-browser-resume.png") });
        // Removed on velai.app: removed here, and the card asks for a résumé again.
        await site.evaluate((key) => localStorage.removeItem(key), SITE_RESUME_KEY);
        if (await until(false)) problems.push("the copy stayed after velai.app removed its résumé");
        card = await waitForCard(page, ["Add your résumé to see your fit"]);
        if (!card?.text.includes("Add your résumé to see your fit")) problems.push("card didn't re-check after the résumé was removed");
        await site.close();
        report("velai.app's browser résumé reaches the extension, scores the card, and leaves with velai.app's", problems);
    }

    // An application form under the job: filled from the résumé on a click, never sent; the thank-you page tracks it.
    state = STATES.found;
    tracked.length = 0;
    await accountChanged();
    await page.goto(FORM_JOB_URL);
    card = await waitForCard(page, ["Fill from your résumé"]);
    {
        const problems = [];
        if (!card?.text.includes("Fill from your résumé")) problems.push("no fill button");
        else {
            await clickCard(page, "Fill from your résumé");
            card = await waitForCard(page, ["Filled"], 20_000);
            if (!card?.text.includes("Filled name, email, phone and résumé PDF")) problems.push(`card says: ${card?.text}`);
            // Nothing was accepted in the panel, so the résumé goes in as written and the card says changes are waiting.
            if (!card?.text.includes("Your résumé went in as you wrote it; 3 proposed changes are waiting for your OK in the panel.")) problems.push(`card didn't say the résumé went in as written: ${card?.text}`);
            const asWritten = await attachedPdfText(page);
            if (!asWritten?.includes("Jordan Lee") || !asWritten.includes("Patient assessment, IV therapy, Epic")) problems.push(`the attached PDF isn't the résumé as written: ${asWritten?.slice(0, 200)}`);
            if (asWritten?.includes("Core skills include")) problems.push("the attached PDF has a proposal nobody accepted");
            const form = await page.evaluate(() => {
                const v = (id) => document.getElementById(id).value;
                const file = (id) => [...document.getElementById(id).files].map((f) => ({ name: f.name, size: f.size, type: f.type }));
                return { first: v("first_name"), last: v("last_name"), email: v("email"), phone: v("phone"), linkedin: v("question_9001"), referrer: v("question_9002"), city: v("candidate-location"), auth: v("auth"), resume: file("resume"), cover: file("cover_letter"), url: location.href };
            });
            const want = { first: "Jordan", last: "Lee", email: "jordan.lee@example.com", phone: "416-555-0100", linkedin: "", referrer: "", city: "", auth: "" };
            for (const [k, v] of Object.entries(want)) if (form[k] !== v) problems.push(`${k} = "${form[k]}"`);
            if (form.resume.length !== 1 || !form.resume[0].name.endsWith(".pdf") || form.resume[0].type !== "application/pdf" || form.resume[0].size < 1000) problems.push(`résumé upload ${JSON.stringify(form.resume)}`);
            if (form.cover.length) problems.push("cover letter upload was filled");
            if (form.url !== FORM_JOB_URL) problems.push("the form was sent");
            if (tracked.length) problems.push("tracked before the form was sent");
        }
        report("fills an application form from the résumé and doesn't send it", problems);
    }
    {
        const problems = [];
        await page.click("#submit-app");
        card = await waitForCard(page, ["Added to your Velai tracker as Applied"], 15_000);
        if (!card?.text.includes("Added to your Velai tracker as Applied")) problems.push(`card says: ${card?.text ?? "nothing"}`);
        const sent = tracked[0];
        if (tracked.length !== 1) problems.push(`tracked ${tracked.length} times`);
        else if (sent.body.jobId !== velaiCopy.id || sent.body.company !== "Cedarbrook Health" || sent.body.title !== "Registered Nurse - ICU") problems.push(`sent ${JSON.stringify(sent.body)}`);
        report("the site's thank-you page puts it in the tracker", problems);
    }

    // Approving the proposed changes one at a time: the person's text beside each proposal, nothing applied until accepted,
    // the copied text and the card's PDF carry only what was accepted, and the choices are remembered as ids only.
    {
        state = STATES.found;
        await worker.evaluate(() => chrome.storage.local.remove("velaiTailorChoices"));
        const read = reads.job;
        await worker.evaluate((value) => chrome.storage.session.set({ pageQuery: value }), { kind: "page", read, site: new URL(read.url).hostname, at: Date.now(), tabId: 1 });
        const panel = await context.newPage();
        const errors = [];
        panel.on("pageerror", (e) => errors.push(e.message));
        await panel.setViewportSize({ width: 400, height: 800 });
        const open = async () => {
            await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
            await panel.waitForSelector(".change", { timeout: 15_000 });
            // Copy text goes to this variable instead of the system clipboard, so the check can read it.
            await panel.evaluate(() => {
                navigator.clipboard.writeText = async (text) => {
                    window.__copied = text;
                };
            });
        };
        const copied = async () => {
            await panel.click("text=Copy text");
            await panel.waitForFunction(() => document.body.innerText.includes("Copied."), null, { timeout: 5_000 });
            return panel.evaluate(() => window.__copied);
        };
        const count = () => panel.evaluate(() => document.querySelector(".review-count")?.textContent ?? "");
        const states = () => panel.evaluate(() => [...document.querySelectorAll(".change")].map((c) => `${c.dataset.kind}:${c.dataset.state}`));
        const problems = [];
        await open().catch(() => problems.push("no changes listed"));
        if (!problems.length) {
            const text = await panel.evaluate(() => document.body.innerText);
            // The experience section is headed by the role as the résumé parser reads it (role · employer).
            for (const t of ["Velai proposes these 3 changes", "Nothing changes until you accept it", "Summary", "Skills", "Registered Nurse ·"]) if (!text.includes(t)) problems.push(`missing "${t}"`);
            // Each change shows the person's own text, the proposal and the reason.
            const first = await panel.evaluate(() => [...document.querySelector(".change").children].map((c) => `${c.className}: ${c.textContent}`));
            const wants = ["tag: Your résumé", "text text-before: Registered nurse with 6 years", "tag: Proposed", "Core skills include IV therapy", "why: Names skills from your résumé that the posting asks for."];
            for (const w of wants) if (!first.some((f) => f.includes(w))) problems.push(`first change lacks "${w}": ${first.join(" | ")}`);
            if ((await states()).join() !== "summary:pending,order:pending,skills:pending") problems.push(`not all undecided at first: ${await states()}`);
            // Nothing accepted: the copy is the résumé as it is.
            const asWritten = await copied();
            if (asWritten.includes("Core skills include") || asWritten.includes("Patient assessment, Medication administration")) problems.push("copied a proposal nobody accepted");
            if (!asWritten.includes("Triage and assess 30+ patients per shift") || !asWritten.includes("Patient assessment, IV therapy, Epic")) problems.push("the copy isn't the résumé as written");
            await panel.screenshot({ path: path.join(out, "panel-changes.png"), fullPage: true });

            // Accept the summary and the skills, reject the line order.
            await panel.click('button[aria-label="Accept Summary: summary"]');
            await panel.click('.change[data-kind="order"] button.choice-reject');
            await panel.click('button[aria-label="Accept Skills: skills order"]');
            if ((await states()).join() !== "summary:accepted,order:rejected,skills:accepted") problems.push(`states after deciding: ${await states()}`);
            if (!(await count()).startsWith("2 of 3 accepted")) problems.push(`count says: ${await count()}`);
            const mixed = await copied();
            if (!mixed.includes("Core skills include IV therapy, Medication administration and Epic.")) problems.push("the accepted summary isn't in the copy");
            if (!mixed.includes("Patient assessment, Medication administration, IV therapy, Epic, BLS, ACLS, Triage")) problems.push("the accepted skills order isn't in the copy");
            const lines = mixed.split("\n").map((l) => l.replace(/^[-•*\s]+/, ""));
            const triage = lines.indexOf("Triage and assess 30+ patients per shift in a level 1 trauma centre");
            const coordinate = lines.indexOf("Coordinate with physicians and respiratory therapists on critically ill patients");
            if (triage < 0 || coordinate < 0 || triage > coordinate) problems.push(`the rejected line order was applied (lines at ${triage}, ${coordinate})`);
            await panel.screenshot({ path: path.join(out, "panel-changes-decided.png"), fullPage: true });
            // What the store listing shows: the changes, from the section's heading down, two accepted and one rejected.
            await panel.evaluate(() => [...document.querySelectorAll("h2.card-title")].find((h) => h.textContent === "Your résumé for this role")?.scrollIntoView({ block: "start" }));
            await panel.screenshot({ path: path.join(out, "panel-approve.png") });

            // Pressing a chosen button again undoes the choice.
            await panel.click('button[aria-label="Accept Summary: summary"]');
            if ((await states())[0] !== "summary:pending") problems.push("pressing Accept again didn't undo it");
            await panel.click('button[aria-label="Accept Summary: summary"]');

            // Remembered as ids and hashes only: no résumé text in Chrome's storage.
            const stored = await worker.evaluate(() => chrome.storage.local.get("velaiTailorChoices"));
            const json = JSON.stringify(stored);
            const entries = Object.values(stored.velaiTailorChoices ?? {});
            if (entries.length !== 1) problems.push(`stored ${entries.length} jobs`);
            for (const word of ["Registered nurse", "Triage", "Jordan", "jordan.lee", "416-555", "Epic", "Core skills"]) if (json.includes(word)) problems.push(`storage holds résumé text "${word}"`);
            if (!/"accepted":\["summary#[0-9a-z]+","skills:0#[0-9a-z]+"\]/.test(json) || !/"rejected":\["order:experience:exp-0#[0-9a-z]+"\]/.test(json)) problems.push(`stored ${json}`);

            // Closing and opening the panel again shows the same choices.
            await open();
            if ((await states()).join() !== "summary:accepted,order:rejected,skills:accepted") problems.push(`choices not remembered: ${await states()}`);
            if (!(await count()).startsWith("2 of 3 accepted")) problems.push(`remembered count says: ${await count()}`);

            // Accept all, Reject all.
            await panel.click("text=Accept all");
            if (!(await count()).startsWith("3 of 3 accepted")) problems.push(`after Accept all: ${await count()}`);
            await panel.click("text=Reject all");
            if (!(await count()).startsWith("0 of 3 accepted")) problems.push(`after Reject all: ${await count()}`);
            if ((await copied()).includes("Core skills include")) problems.push("Reject all still copied a proposal");
            await panel.click("text=Accept all");
            const all = await copied();
            if (!all.includes("Core skills include") || !all.includes("Patient assessment, Medication administration")) problems.push("Accept all didn't put every change in the copy");

            // The PDF is made from the accepted changes too.
            await panel.click("text=Reject all");
            await panel.click('button[aria-label="Accept Summary: summary"]');
            await panel.click('button[aria-label="Accept Skills: skills order"]');
            const [download] = await Promise.all([panel.waitForEvent("download", { timeout: 15_000 }), panel.click("text=Download PDF")]);
            const file = path.join(out, `approved-${download.suggestedFilename()}`);
            await download.saveAs(file);
            if (statSync(file).size < 1000) problems.push(`PDF is only ${statSync(file).size} bytes`);
        }
        if (errors.length) problems.push(...errors);
        report("panel: each change is accepted or rejected, and the copy, PDF and storage follow", problems);
        await panel.close();
    }
    // The card's form fill attaches the same résumé: the accepted changes (summary, skills) and not the rejected one.
    {
        const problems = [];
        tracked.length = 0;
        await page.goto(FORM_JOB_URL);
        card = await waitForCard(page, ["Fill from your résumé"]);
        await clickCard(page, "Fill from your résumé");
        card = await waitForCard(page, ["Filled"], 20_000);
        if (!card?.text.includes("Your résumé went in with the 2 of 3 proposed changes you accepted.")) problems.push(`card says: ${card?.text}`);
        await page.screenshot({ path: path.join(out, "card-filled-approved.png") });
        const pdf = await page.evaluate(async () => {
            const f = document.getElementById("resume").files[0];
            return f ? { name: f.name, size: f.size, head: new TextDecoder().decode(new Uint8Array(await f.slice(0, 5).arrayBuffer())) } : null;
        });
        if (!pdf || pdf.head !== "%PDF-" || pdf.size < 1000) problems.push(`résumé upload ${JSON.stringify(pdf)}`);
        // The PDF's own text: the accepted summary and skills order are in it, the rejected line order is not.
        const accepted = (await attachedPdfText(page)) ?? "";
        if (!accepted.includes("Core skills include IV therapy, Medication administration and Epic.")) problems.push("the attached PDF lacks the accepted summary");
        if (!accepted.includes("Patient assessment, Medication administration, IV therapy, Epic, BLS, ACLS, Triage")) problems.push("the attached PDF lacks the accepted skills order");
        const triagePdf = accepted.indexOf("Triage and assess 30+ patients");
        const coordinatePdf = accepted.indexOf("Coordinate with physicians and respiratory therapists");
        if (triagePdf < 0 || coordinatePdf < 0 || triagePdf > coordinatePdf) problems.push(`the attached PDF has the rejected line order (lines at ${triagePdf}, ${coordinatePdf})`);
        report("card: fill attaches the résumé with the accepted changes only", problems);

        // Saving the résumé again on Velai starts the decisions over (they were made on the old one).
        state = { ...STATES.found, me: { ...signedIn, resume: { ...signedIn.resume, updatedAt: "2026-10-12T09:00:00Z" } } };
        await accountChanged();
        const problems2 = [];
        await page.goto(FORM_JOB_URL);
        card = await waitForCard(page, ["Fill from your résumé"]);
        await clickCard(page, "Fill from your résumé");
        card = await waitForCard(page, ["Filled"], 20_000);
        if (!card?.text.includes("Your résumé went in as you wrote it; 3 proposed changes are waiting for your OK in the panel.")) problems2.push(`after the résumé changed, card says: ${card?.text}`);
        if ((await attachedPdfText(page))?.includes("Core skills include")) problems2.push("the attached PDF has a change accepted on the older résumé");
        report("card: decisions made on an older résumé aren't applied to a newer one", problems2);
        state = STATES.found;
        await accountChanged();
        await worker.evaluate(() => chrome.storage.local.remove("velaiTailorChoices"));
    }

    // The form on a page of its own: the card knows the job from the page before it, and a form that confirms in place is tracked too.
    state = { ...STATES.found, hits: similar };
    tracked.length = 0;
    await page.goto(SPLIT_JOB_URL);
    await waitForCard(page, ["against your résumé"]);
    await page.goto(SPLIT_APPLY_URL);
    card = await waitForCard(page, ["Fill from your résumé"]);
    {
        const problems = [];
        if (!card?.text.includes("Registered Nurse - ICU · Harbourline Health")) problems.push(`card is about: ${card?.text ?? "nothing"}`);
        if (!card?.text.includes("Fill from your résumé")) problems.push("no fill button");
        else {
            await clickCard(page, "Fill from your résumé");
            card = await waitForCard(page, ["Filled"], 20_000);
            const form = await page.evaluate(() => ({
                values: Object.fromEntries([...document.querySelectorAll("form input:not([type=file])")].map((i) => [i.name, i.value])),
                changes: window.__changes,
                file: document.querySelector("#resume-upload-input").files[0]?.name ?? null,
            }));
            const want = { name: "Jordan Lee", email: "jordan.lee@example.com", phone: "416-555-0100", location: "Toronto, ON, Canada", org: "", "urls[LinkedIn]": "" };
            for (const [k, v] of Object.entries(want)) if (form.values[k] !== v) problems.push(`${k} = "${form.values[k]}"`);
            // The page's own scripts saw each change, the way a React form must.
            for (const k of ["name", "email", "phone", "location", "resume"]) if (!form.changes.includes(k)) problems.push(`page didn't see ${k} change`);
            if (!form.file?.endsWith(".pdf")) problems.push("no résumé attached");
            await page.screenshot({ path: path.join(out, "card-filled.png") });
            await page.click("button.submit");
            card = await waitForCard(page, ["Added to your Velai tracker as Applied"], 15_000);
            if (!card?.text.includes("Added to your Velai tracker as Applied")) problems.push(`after sending, card says: ${card?.text ?? "nothing"}`);
            if (tracked.length !== 1 || tracked[0].body.company !== "Harbourline Health") problems.push(`tracked ${JSON.stringify(tracked.map((t) => t.body))}`);
        }
        report("fills a form on its own page and tracks an in-place confirmation", problems);
    }

    // The form's free-text questions: listed, drafted on a tap from the résumé lines that bear on each, and written into
    // the form only when the person taps "Insert in the form". Nothing is asked of the AI before a tap.
    {
        await page.setViewportSize({ width: 1280, height: 1400 });
        state = STATES.found;
        tracked.length = 0;
        const sealedStatusSeen = [];
        const tinfoilSeen = [];
        const passThroughSeen = [];
        await context.route("https://velai.app/api/sealed-ai/status", (r) => {
            sealedStatusSeen.push(r.request().url());
            // velai.app answers enabled only for a signed-in account with a paid month.
            return answer(r, state.sealedOff ? { enabled: false } : { enabled: true, model: "llama3-3-70b" });
        });
        await context.route("https://velai.app/api/sealed-ai/v1/**", (r) => {
            passThroughSeen.push(r.request().url());
            return r.fulfill({ status: 503, body: "" });
        });
        // Tinfoil's attestation hosts, which this sandbox can't reach: every request is recorded and refused (with CORS headers, as a browser-ready host sends).
        await context.route(/^https:\/\/([a-z0-9-]+\.)*(tinfoil\.sh|sigstore\.dev|githubusercontent\.com|github\.com|amd\.com)\//, (r) => {
            tinfoilSeen.push(new URL(r.request().url()).host);
            return r.fulfill({ status: 503, body: "", headers: { "access-control-allow-origin": "*" } });
        });
        const fieldValues = (ids) => page.evaluate((list) => Object.fromEntries(list.map((id) => [id, document.getElementById(id).value])), ids);
        const ALL_BOXES = ["q_why", "q_iv", "q_pay", "q_cover", "q_hear", "q_kube", "q_strength"];
        const openQuestions = async () => {
            await page.goto(QUESTIONS_URL);
            return waitForCard(page, ["Questions on this form"]);
        };
        const sealedCalls = () => worker.evaluate(() => (globalThis.__sealedCalls ?? []).length);

        // 1. The list: questions with a draft button, questions Velai leaves to the person and why, and no field that isn't a question.
        card = await openQuestions();
        {
            const problems = [];
            for (const t of [
                "Questions on this form",
                "Why are you interested in this role?",
                "Describe your experience with IV therapy.",
                "Describe your experience with Kubernetes clusters.",
                "Velai leaves this one to you: pay.",
                "Velai leaves this one to you: a cover letter or open note, not a question.",
                "Velai leaves this one to you: where you heard about the job.",
                "Drafts come from your résumé when you ask. You choose what goes in the form.",
            ]) if (!card?.text.includes(t)) problems.push(`missing "${t}"`);
            for (const t of ["What is your biggest strength?", "Current company", "legally authorized", "First Name"]) {
                if (card?.text.includes(t)) problems.push(`lists "${t}"`);
            }
            const asks = card?.buttons.filter((b) => b.text.startsWith("Draft an answer")).length;
            if (asks !== 3) problems.push(`${asks} draft buttons, want 3 (why, IV therapy, Kubernetes)`);
            // Seeing the list asks nothing of the AI and writes nothing in the form.
            if (sealedStatusSeen.length || tinfoilSeen.length || passThroughSeen.length) problems.push(`asked the AI before a tap: ${sealedStatusSeen.length} status, ${tinfoilSeen.length} Tinfoil, ${passThroughSeen.length} pass-through`);
            const values = await fieldValues(ALL_BOXES);
            for (const id of ALL_BOXES) if (values[id] !== (id === "q_strength" ? "I already wrote this one." : "")) problems.push(`${id} = "${values[id]}"`);
            report("form questions: listed, some left to the person with the reason, nothing sent or written yet", problems);
        }

        // 2. Sealed AI on, no stub: the real Tinfoil client runs in the worker. Its servers aren't reachable here, so the draft is the résumé lines, marked as that.
        {
            const problems = [];
            await clickCard(page, "Draft an answer", 1);
            card = await waitForCard(page, ["Draft from your résumé"], 50_000);
            if (!card?.text.includes("Draft from your résumé. Check every claim before you use it.")) problems.push(`no draft: ${card?.text.slice(-300)}`);
            if (!card?.text.includes("These lines as your résumé has them (no AI).")) problems.push("didn't say the lines stand in for the AI");
            if (card?.text.includes("Written by Velai's sealed AI")) problems.push("claimed AI wrote it");
            if (!/IV therapy/i.test(card?.text.split("Draft from your résumé.")[1] ?? "")) problems.push("the draft lacks the IV therapy line");
            if (sealedStatusSeen.length !== 1) problems.push(`${sealedStatusSeen.length} status requests, want 1`);
            if (!tinfoilSeen.length) problems.push("the Tinfoil client never tried to attest a server (it didn't run in the worker)");
            if (passThroughSeen.length) problems.push("sent a request to the pass-through without attesting the server first");
            if ((await fieldValues(["q_iv"])).q_iv !== "") problems.push("wrote into the form unasked");
            console.log(`     (real client, servers unreachable here: tried ${[...new Set(tinfoilSeen)].join(", ")})`);
            report("form questions: sealed AI that can't be verified falls back to the résumé lines", problems);
        }

        // From here the sealed model is a stub in the worker: it records every request and answers from the numbered lines.
        await worker.evaluate(() => {
            globalThis.__sealedCalls = [];
            globalThis.__sealedMode = "echo";
            globalThis.__velaiSealedAi = async (messages, options) => {
                globalThis.__sealedCalls.push({ messages, options });
                if (globalThis.__sealedMode === "refuse") return "I'm sorry, but I can't answer that from the lines provided to me.";
                const user = messages.find((m) => m.role === "user").content;
                const lines = user.split("Résumé lines:")[1].split("\n").map((l) => l.replace(/^\d+\.\s*\[[^\]]*\]\s*/, "").trim()).filter(Boolean);
                return `I have done this work. ${lines.join(" ")}`;
            };
        });

        // 3. A draft on a tap: the sealed model's reply, marked as a draft, sent with the question and the matching lines only; nothing in the form until Insert.
        card = await openQuestions();
        {
            const problems = [];
            await clickCard(page, "Draft an answer", 0);
            card = await waitForCard(page, ["Draft from your résumé"], 20_000);
            if (!card?.text.includes("Written by Velai's sealed AI from these lines only.")) problems.push("didn't say the sealed AI wrote it");
            if (!/From your résumé: [^.]*(Emergency Department|Summary)/.test(card?.text ?? "")) problems.push(`no source line naming the résumé lines: ${card?.text.slice(-400)}`);
            if (!card?.text.includes("Insert in the form") || !card.text.includes("Copy")) problems.push("no Insert / Copy");
            const calls = await worker.evaluate(() => globalThis.__sealedCalls);
            if (calls.length !== 1) problems.push(`${calls.length} model requests for one tap`);
            else {
                const { messages, options } = calls[0];
                const sent = messages.map((m) => m.content).join("\n");
                if (!sent.includes("Question: Why are you interested in this role?")) problems.push("the question wasn't sent");
                if (!sent.includes("Job: Registered Nurse - ICU at Cedarbrook Health")) problems.push("the job wasn't sent");
                for (const secret of [/\bJordan\b/, /\bLee\b/, /jordan\.lee@example\.com/, /416-555-0100/]) if (secret.test(sent)) problems.push(`sent ${secret}`);
                const lines = sent.split("Résumé lines:")[1].split("\n").filter((l) => /^\d+\./.test(l));
                if (!lines.length || lines.length > 4) problems.push(`${lines.length} résumé lines sent`);
                for (const l of lines) {
                    const bare = l.replace(/^\d+\.\s*\[[^\]]*\]\s*/, "").replace(/^[-•]\s*/, "");
                    if (!resumeText.includes(bare.replace(/[.]$/, ""))) problems.push(`a sent line isn't on the résumé: ${bare}`);
                }
                if (!(options.maxTokens > 0 && options.maxTokens <= 220)) problems.push(`reply cap ${options.maxTokens}`);
            }
            if ((await fieldValues(["q_why"])).q_why !== "") problems.push("the draft was in the form before Insert");
            await page.screenshot({ path: path.join(out, "card-draft.png") });
            await clickCard(page, "Insert in the form");
            card = await waitForCard(page, ["Inserted."], 5_000);
            const after = await page.evaluate(() => ({ why: document.getElementById("q_why").value, events: window.__events, url: location.href }));
            if (!after.why.startsWith("I have done this work.") || !after.why.includes("acute care")) problems.push(`the form has: ${after.why.slice(0, 120)}`);
            for (const e of ["input:q_why", "change:q_why"]) if (!after.events.includes(e)) problems.push(`the page didn't see ${e}`);
            if (!card?.text.includes("Inserted. Edit it in the form, then submit it yourself.")) problems.push("card didn't say it was inserted");
            if (after.url !== QUESTIONS_URL || tracked.length) problems.push("the form was sent");
            if ((await fieldValues(["q_iv", "q_pay"])).q_iv !== "") problems.push("another box was written");
            report("form questions: a draft on a tap, from the matching lines only, in the form only after Insert", problems);
        }

        // 4. Text the person typed since stays: Insert leaves a box that has something in it.
        card = await openQuestions();
        {
            const problems = [];
            await clickCard(page, "Draft an answer", 1);
            await waitForCard(page, ["Draft from your résumé"], 20_000);
            await page.fill("#q_iv", "My own words.");
            await clickCard(page, "Insert in the form");
            card = await waitForCard(page, ["That box has text in it now"], 5_000);
            if (!card?.text.includes("That box has text in it now, so Velai left it. Copy the draft instead.")) problems.push(`card says: ${card?.text.slice(-200)}`);
            if ((await fieldValues(["q_iv"])).q_iv !== "My own words.") problems.push("overwrote what the person typed");
            report("form questions: Insert never replaces what the person typed", problems);
        }

        // 5. A reply the guard refuses (the model declining) leaves the résumé lines as the draft.
        await worker.evaluate(() => (globalThis.__sealedMode = "refuse"));
        card = await openQuestions();
        {
            const problems = [];
            await clickCard(page, "Draft an answer", 1);
            card = await waitForCard(page, ["Draft from your résumé"], 20_000);
            if (!card?.text.includes("These lines as your résumé has them (no AI).")) problems.push("didn't say the lines stand in for the AI");
            if (card?.text.includes("I'm sorry")) problems.push("showed the model's refusal as a draft");
            if (!/IV therapy/i.test(card?.text.split("Draft from your résumé.")[1] ?? "")) problems.push("the draft lacks the IV therapy line");
            report("form questions: a refused reply falls back to the résumé lines", problems);
        }
        await worker.evaluate(() => (globalThis.__sealedMode = "echo"));

        // 6. No résumé line speaks to the Kubernetes question: Velai says so and asks the AI nothing.
        card = await openQuestions();
        {
            const problems = [];
            const before = await sealedCalls();
            await clickCard(page, "Draft an answer", 2);
            card = await waitForCard(page, ["no line on your résumé speaks to it"], 10_000);
            if (!card?.text.includes("Velai leaves this one to you: no line on your résumé speaks to it.")) problems.push(`card says: ${card?.text.slice(-200)}`);
            if ((await sealedCalls()) !== before) problems.push("asked the AI with nothing to draft from");
            report("form questions: a question the résumé has nothing on is left to the person, with nothing sent", problems);
        }

        // 7. Copy puts the draft on the clipboard.
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://job-boards.greenhouse.io" });
        card = await openQuestions();
        {
            const problems = [];
            await clickCard(page, "Draft an answer", 1);
            await waitForCard(page, ["Draft from your résumé"], 20_000);
            await clickCard(page, "Copy");
            card = await waitForCard(page, ["Copied."], 5_000);
            const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `error: ${e.message}`);
            if (!card?.text.includes("Copied.") || !copied.startsWith("I have done this work.")) problems.push(`clipboard: ${copied.slice(0, 80)}; card: ${card?.text.slice(-120)}`);
            if ((await fieldValues(["q_iv"])).q_iv !== "") problems.push("Copy wrote into the form");
            report("form questions: Copy leaves the form alone", problems);
        }

        // 8. Signed out with no résumé anywhere: no questions, nothing to draft from.
        state = { me: { signedIn: false } };
        await setDevice(null);
        await accountChanged();
        await page.goto(QUESTIONS_URL);
        card = await waitForCard(page, ["Add your résumé to see your fit"]);
        report("form questions: no résumé, no question list", card?.text.includes("Questions on this form") ? ["the list showed"] : []);

        // 9. No account, with the résumé velai.app keeps in this browser: the questions are listed and drafted from its lines,
        // the sealed AI is never asked (it is part of a paid month), and the card says so with where to get it.
        {
            const problems = [];
            state = { me: { signedIn: false }, sealedOff: true };
            // The real status check from here (the stub stands in for a paid month's sealed AI).
            await worker.evaluate(() => {
                delete globalThis.__velaiSealedAi;
            });
            await setDevice(deviceResume);
            await accountChanged();
            const before = await sealedCalls();
            card = await openQuestions();
            if (!card?.text.includes("Questions on this form")) problems.push("no question list");
            else {
                await clickCard(page, "Draft an answer", 1);
                card = await waitForCard(page, ["Draft from your résumé"], 20_000);
                if (!card?.text.includes("These lines as your résumé has them (no AI).")) problems.push("didn't say the draft is the lines");
                if (!card?.text.includes("With a paid month, Velai's sealed AI writes the answer from these lines.")) problems.push("didn't say what a paid month adds");
                if (!card?.text.includes("See the plan")) problems.push("no link to the plan");
                if (!/IV therapy/i.test(card?.text.split("Draft from your résumé.")[1] ?? "")) problems.push("the draft lacks the IV therapy line");
                if ((await sealedCalls()) !== before) problems.push("asked the sealed AI without a paid month");
                await page.screenshot({ path: path.join(out, "card-draft-free.png") });
            }
            report("form questions: no account, drafts from the browser's résumé lines and says what a paid month adds", problems);
        }
        await setDevice(null);
        state = STATES.found;
        await accountChanged();
        await worker.evaluate(() => {
            delete globalThis.__velaiSealedAi;
        });
        await page.setViewportSize({ width: 1280, height: 800 });
    }

    if (pageErrors.length) {
        console.log(`FAIL card: page errors — ${pageErrors.join("; ")}`);
        failures.push("card: page errors");
    }
} finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
}
console.log(`Screenshots in ${path.relative(process.cwd(), out)}`);
if (failures.length) process.exit(1);
