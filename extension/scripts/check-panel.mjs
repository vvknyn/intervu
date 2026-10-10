#!/usr/bin/env node
/**
 * Loads the built extension in Chromium and drives the side panel through
 * each state against a stubbed velai.app, printing what the panel says and
 * failing on any script error or a state that never finishes loading. Then
 * the on-page card: it shows on its own on a listed job site with sourced
 * lines, stays away from a page that isn't a job, signs in through a small
 * window that closes itself and re-checks, opens the panel, and saves "I
 * applied". It also saves the screenshots the store listing is made from.
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
const PAGES = {
    job: { url: JOB_URL, html: jobHtml },
    board: { url: "https://jobs.board.example/view/48213", html: "<!doctype html><title>Registered Nurse - ICU | Cedarbrook Health | JobBoard</title><main><h1>Registered Nurse - ICU</h1><p>Cedarbrook Health, Toronto, ON</p><p>Patient care in the ICU: IV therapy, Epic charting, triage of critically ill patients. BLS and ACLS required.</p></main>" },
    blog: { url: "https://trails.example/blog/best-hikes", html: "<!doctype html><title>Best fall hikes near Toronto | Trail Notes</title><main><h1>Best fall hikes near Toronto</h1><p>Ten trails with great colours this October.</p></main>" },
};

/** Each state: what velai.app answers, the page clicked on, and what the panel must say. */
const STATES = {
    found: { me: signedIn, hits: [velaiCopy, ...similar], expect: ["Strong", "Actively posted", "lines that use this job's words now come first", "Download PDF"], pdf: true },
    "not-on-velai": { me: signedIn, hits: similar, expect: ["Not on Velai yet", "The page says apply by", "Similar roles on Velai", "✓ Registered", "✗ ICU"], has: [".rows .row-fit"] },
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
    const searchBodies = [];
    await context.route("https://velai.app/api/jobs/search", (r) => {
        searchBodies.push(JSON.parse(r.request().postData() ?? "{}"));
        return answer(r, typeof state.hits === "number" ? state.hits : { hits: state.hits, total: state.hits.length, backend: "meilisearch", configured: true });
    });
    const tracked = [];
    await context.route("https://velai.app/api/extension/track", (r) => {
        tracked.push({ type: r.request().headers()["content-type"], body: JSON.parse(r.request().postData() ?? "{}") });
        return answer(r, { ok: true, id: "app-1" });
    });
    await context.route(/^https:\/\/velai\.app\/(login|yours|resume)/, (r) =>
        r.fulfill({ contentType: "text/html", body: `<!doctype html><title>Velai</title><h1>${new URL(r.request().url()).pathname}</h1>` }),
    );
    await context.route(BOARD_JOB_URL, (r) => r.fulfill({ contentType: "text/html", body: jobHtml }));
    await context.route(BOARD_LIST_URL, (r) => r.fulfill({ contentType: "text/html", body: PAGES.blog.html }));

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
        const ok = text.includes("Sign in to Velai") && text.includes("How it works");
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

    // "I applied" saves to the tracker with Velai's job id.
    tracked.length = 0;
    await clickCard(page, "I applied");
    card = await waitForCard(page, ["Added to your Velai tracker"]);
    {
        const problems = [];
        if (!card?.text.includes("Added to your Velai tracker as Applied")) problems.push("no confirmation");
        const sent = tracked[0];
        if (!sent) problems.push("nothing sent");
        else {
            if (sent.type !== "application/json") problems.push(`content-type ${sent.type}`);
            if (sent.body.jobId !== velaiCopy.id || sent.body.company !== "Cedarbrook Health") problems.push(`sent ${JSON.stringify(sent.body)}`);
        }
        report("I applied", problems);
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
        if (!card?.text.includes("Sign in to Velai to see how this fits your résumé")) problems.push("no sign-in note");
        if (card?.text.includes("I applied")) problems.push("offers I applied while signed out");
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
        for (const t of ["Edit your résumé on Velai", "I applied", "Show the Velai card on careers.cedarbrook.example job pages"]) if (!text.includes(t)) problems.push(`missing "${t}"`);
        await panel.screenshot({ path: path.join(out, "panel-after-sign-in.png"), fullPage: true });
        report("panel sign-in re-checks; edit, applied and card offer show", problems);
        await panel.close();
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
