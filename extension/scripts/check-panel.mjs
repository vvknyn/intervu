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
    found: { me: signedIn, hits: [velaiCopy, ...similar], expect: ["Strong", "Actively posted", "lines that use this job's words now come first", "Download PDF"], order: ["Your fit", "Velai's checks"], pdf: true },
    "not-on-velai": { me: signedIn, hits: similar, expect: ["Not on Velai yet", "The page says apply by", "Similar roles on Velai", "✓ Registered", "✗ ICU"], has: [".rows .row-fit"] },
    "signed-out": { me: { signedIn: false }, hits: [velaiCopy], expect: ["Sign in to Velai", "Actively posted", "create an account"], order: ["Velai's checks", "Your fit"] },
    "no-resume": { me: { signedIn: true, resume: { data: null, text: null, updatedAt: null }, preferences: null }, hits: [velaiCopy], expect: ["Add your résumé"], order: ["Velai's checks", "Your fit"] },
    "velai-down": { me: 500, hits: 500, expect: ["Velai didn't answer", "Velai's search didn't answer"] },
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
    await context.route(BOARD_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: jobHtml }));
    await context.route(BOARD_CODED_URL, (r) => r.fulfill({ contentType: "text/html", body: codedHtml }));
    await context.route(BOARD_LIST_URL, (r) => r.fulfill({ contentType: "text/html", body: PAGES.blog.html }));
    await context.route(FORM_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: formHtml }));
    await context.route(`${FORM_CONFIRM_URL}**`, (r) => r.fulfill({ contentType: "text/html", body: confirmHtml }));
    await context.route(SPLIT_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: splitJobHtml }));
    await context.route(SPLIT_APPLY_URL, (r) => r.fulfill({ contentType: "text/html", body: applyHtml }));

    // First install opens the welcome page, which offers sign-in right there.
    state = { me: { signedIn: false } };
    const welcome = context.pages().find((p) => p.url().endsWith("/welcome.html")) ?? (await context.waitForEvent("page", { timeout: 5_000 }).catch(() => null));
    if (!welcome?.url().endsWith("/welcome.html")) {
        console.log("FAIL welcome — no welcome page on install");
        failures.push("welcome");
    } else {
        await welcome.setViewportSize({ width: 1280, height: 800 });
        await welcome.reload();
        await welcome.waitForFunction(() => document.body.innerText.includes("Sign in to Velai"), null, { timeout: 10_000 }).catch(() => {});
        const text = await welcome.evaluate(() => document.body.innerText);
        // The card's no-account value comes before the ask to sign in.
        const ok = text.includes("Sign in to Velai") && text.includes("How it works") && text.indexOf("needs no account") >= 0 && text.indexOf("needs no account") < text.indexOf("Sign in to Velai");
        console.log(`${ok ? "ok  " : "FAIL"} welcome`);
        if (!ok) failures.push("welcome");
        await welcome.screenshot({ path: path.join(out, "welcome.png") });
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
    async function clickCard(page, label) {
        const card = await readCard(page);
        const b = card?.buttons.find((x) => x.text.startsWith(label) && x.x != null);
        if (!b) throw new Error(`no "${label}" button on the card`);
        await page.mouse.click(b.x, b.y);
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
    card = await waitForCard(page, ["Sign in to see your fit"]);
    {
        const problems = [];
        // Leads with the posting's facts; the button is the only ask to sign in.
        if (!(card && card.text.indexOf("Actively posted") >= 0 && card.text.indexOf("Actively posted") < card.text.indexOf("Sign in to see your fit"))) problems.push("facts don't come before the sign-in button");
        if (card?.text.includes("I applied")) problems.push("offers I applied while signed out");
        if (card?.buttons.some((b) => b.text === "Save")) problems.push("offers Save while signed out");
        await page.screenshot({ path: path.join(out, "card-signed-out.png") });
        const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 10_000 }), clickCard(page, "Sign in to see your fit")]);
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
        await panel.waitForFunction(() => document.body.innerText.includes("Sign in to Velai"), null, { timeout: 15_000 }).catch(() => problems.push("no sign-in offer"));
        const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 10_000 }), panel.click('button:has-text("Sign in to Velai")')]);
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
