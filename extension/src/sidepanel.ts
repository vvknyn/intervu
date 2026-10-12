/**
 * Side panel. On a job page (the toolbar button) it shows, for the person
 * signed in to velai.app in this browser:
 *  1. how the role fits their Velai résumé (the site's fit label and reasons),
 *  2. Velai's checks on the posting (or what the page itself states when
 *     Velai doesn't have it),
 *  3. their résumé tailored to the role, to download as a PDF or copy.
 * Signed out, it still shows the checks and offers sign-in. Selected text or
 * a typed search lists matching roles on Velai instead.
 *
 * Everything is computed here, in the browser, with velai.app's own code:
 * the résumé comes from the person's account (GET /api/extension/me) and
 * never goes anywhere else; roles come from the public search the site's
 * jobs list uses (POST /api/jobs/search).
 */
import { PAGE_QUERY_KEY, queryFromPage } from "./page-query";
import { jobFromPage, looksLikeJob, validThrough, type PageRead } from "./page-reader";
import { panelRow, velaiSearchUrl, VELAI_ORIGIN, type PanelRow } from "./rows";
import { fitReport, pageChecks, resumeFromMe, sameJob, tailoredResume, velaiChecks, type CheckLine, type MeResponse } from "./report";
import { tailoredResumePdf } from "./resume-pdf";
import { fetchMe, searchVelai, trackApplied } from "./velai-api";
import { ALL_SITES, isKnownJobSite, sitePattern } from "./job-sites";
import { ACCOUNT_CHANGED_KEY, HIDDEN_SITES_KEY, type ToBackground } from "./messages";
import { fitTerms } from "./card-summary";
import type { HandOff } from "./handoff";
import { resumeDataToPlainText } from "@/lib/resume/to-plain-text";
import { presentJob } from "@/lib/presentation";
import { LOCATION_UNKNOWN_TEXT } from "@/lib/jobs/presentation";
import type { JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/** Rows a plain search lists before "See all on Velai". */
export const PANEL_LIMIT = 10;
/** Similar roles shown under a page Velai doesn't have. */
const SIMILAR_LIMIT = 3;

const form = document.getElementById("search") as HTMLFormElement;
const input = document.getElementById("q") as HTMLInputElement;
const source = document.getElementById("source") as HTMLParagraphElement;
const results = document.getElementById("results") as HTMLElement;

/** The latest render; an older one that finishes late is dropped. */
let generation = 0;

/** The job page on screen, re-checked when the person signs in or edits their résumé. */
let shown: { kind: "page"; ctx: PageContext; textIsTheJob: boolean } | { kind: "other" } = { kind: "other" };

interface PageContext {
    read: PageRead;
    site: string | null;
    /** The tab the page is in, to turn the on-page card on for its site. */
    tabId?: number;
}

function send(message: ToBackground): void {
    void chrome.runtime.sendMessage(message);
}

// ── DOM helpers ────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function link(href: string, text: string, className?: string): HTMLAnchorElement {
    const a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

function section(title: string, ...children: Node[]): HTMLElement {
    const s = el("section", "card");
    s.append(el("h2", "card-title", title), ...children);
    return s;
}

function setSource(text: string | null): void {
    source.textContent = text ?? "";
    source.hidden = !text;
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function rowNode(row: PanelRow, fit?: { label: string; tone: string } | null): HTMLElement {
    const li = el("li", "row");
    li.append(link(row.velaiUrl, row.title, "title"));
    li.append(el("p", "meta", row.meta.join(" · ")));
    if (fit) li.append(el("p", `fit fit-${fit.tone} row-fit`, fit.label));
    if (row.marks.length) {
        const marks = el("p", "marks");
        for (const mark of row.marks) marks.append(el("span", `mark mark-${mark.tone}`, mark.text));
        li.append(marks);
        if (row.explain) li.append(el("p", "explain", row.explain));
    }
    if (row.applyUrl && row.applyHost) li.append(link(row.applyUrl, `Open on ${row.applyHost}`, "apply"));
    return li;
}

function checksNode(lines: CheckLine[]): HTMLElement {
    const list = el("ul", "checks");
    for (const line of lines) {
        const li = el("li", `check check-${line.tone}`);
        li.append(el("span", "check-label", line.label));
        if (line.detail) li.append(el("p", "explain", line.detail));
        list.append(li);
    }
    return list;
}

function fitNode(me: MeResponse | null, resume: ResumeData | null, job: PublicJob, onRetry: () => void): HTMLElement {
    if (!me) {
        return section("Your fit", el("p", "notice", "Velai didn't answer, so your fit can't be shown right now."), button("Try again", "secondary", onRetry));
    }
    if (!me.signedIn) {
        return section(
            "Your fit",
            el("p", "lede", "Sign in to see how this role fits your résumé."),
            actionsRow(button("Sign in to Velai", "primary", () => send({ type: "signIn" })), button("Check again", "ghost", onRetry)),
            el("p", "hint", "Opens a small window, where you can also create an account. It closes on its own and this job is checked again."),
        );
    }
    if (me.resume === null) {
        return section("Your fit", el("p", "notice", "Velai couldn't load your résumé just now."), button("Try again", "secondary", onRetry));
    }
    if (!resume) {
        return section(
            "Your fit",
            el("p", "lede", "Add your résumé on Velai to see how this role fits you."),
            actionsRow(button("Add your résumé", "primary", () => send({ type: "openVelai", path: "/resume" })), button("Check again", "ghost", onRetry)),
            el("p", "hint", "Opens in a small window. Close it when you're done and this job is checked again."),
        );
    }
    const edit = editResumeNode();
    const report = fitReport(resume, me.preferences ?? null, job, me.resume?.updatedAt);
    if (!report) {
        return section("Your fit", el("p", "muted", "Your résumé and this role don't share enough to score, so Velai gives it no fit label."), edit);
    }
    const rows = el("dl", "receipt");
    for (const row of report.rows) rows.append(el("dt", undefined, row.label), el("dd", undefined, row.value));
    const parts: Node[] = [el("p", `fit fit-${report.tone}`, report.label), el("p", "fit-heading", report.heading), el("p", "fit-why", report.why), rows];
    // The words behind the relevance row, ✓ on the résumé or ✗ not, so the
    // person sees what a résumé edit would need to cover.
    const terms = fitTerms(resume, job);
    if (terms) {
        const chips = el("p", "terms");
        chips.append(
            ...terms.matched.map((t) => el("span", "term term-has", `✓ ${t}`)),
            ...terms.missing.map((t) => el("span", "term term-lacks", `✗ ${t}`)),
        );
        parts.push(chips, el("p", "hint", "Words in the role's title and tags, the terms the fit label counts: ✓ on your résumé, ✗ not on it."));
    }
    parts.push(edit);
    return section("Your fit", ...parts);
}

function actionsRow(...children: Node[]): HTMLElement {
    const row = el("div", "actions");
    row.append(...children);
    return row;
}

/** Velai's résumé editor in a small window; closing it checks this job again. */
function editResumeNode(): HTMLElement {
    const node = el("div", "edit");
    node.append(
        actionsRow(button("Edit your résumé on Velai", "secondary", () => send({ type: "openVelai", path: "/resume" }))),
        el("p", "hint", "Opens in a small window. Close it when you're done and this job is checked against your updated résumé."),
    );
    return node;
}

/** "I applied": the job goes into the person's Velai tracker as Applied, the same as velai.app's own "Mark as applied". */
function applyingNode(job: PublicJob, applyUrl: string): HTMLElement | null {
    const company = job.company?.trim();
    if (!company) return null;
    const status = el("p", "muted", "Once you've applied on this page, add the job to your Velai tracker, dated today.");
    const done = button("I applied", "primary", () => {
        done.disabled = true;
        void trackApplied({ title: job.title, company, applyUrl, ...(job.id.startsWith("page:") ? {} : { jobId: job.id }) })
            .then(() => {
                status.replaceChildren("Added to your Velai tracker as Applied. ", link(`${VELAI_ORIGIN}/yours`, "Open your tracker"));
                done.remove();
            })
            .catch((e: unknown) => {
                done.disabled = false;
                status.textContent = /HTTP 401/.test(String(e)) ? "Velai says you're signed out. Sign in and try again." : "Velai didn't save it. Try again.";
            });
    });
    return section("Applying", status, actionsRow(done));
}

/**
 * Turning the on-page card on (or back on) for this page's site. The built-in
 * job sites have it already; any other site needs the person's say-so, which
 * Chrome asks for: once for every site (the card only looks for a job on each
 * page and stays silent on the rest), or for this one site.
 */
async function cardSiteNode(ctx: PageContext): Promise<HTMLElement | null> {
    const pattern = sitePattern(ctx.read.url);
    if (!pattern || ctx.tabId == null) return null;
    const host = new URL(ctx.read.url).hostname;
    const stored = await chrome.storage.local.get(HIDDEN_SITES_KEY);
    const hidden = new Set((stored[HIDDEN_SITES_KEY] as string[] | undefined) ?? []);
    const enabled = isKnownJobSite(ctx.read.url) || (await chrome.permissions.contains({ origins: [pattern] }));
    const note = el("p", "hint");
    const tabId = ctx.tabId;
    if (enabled && !hidden.has(host)) return null;
    if (enabled) {
        note.append(
            `The Velai card is off on ${host}. `,
            button("Show it again", "inline", () => {
                hidden.delete(host);
                void chrome.storage.local.set({ [HIDDEN_SITES_KEY]: [...hidden] }).then(() => (note.textContent = `The Velai card shows on ${host} again.`));
            }),
        );
    } else {
        // Must be called straight from the click for Chrome to ask.
        const turnOn = (origins: string[], done: string) => () =>
            void chrome.permissions.request({ origins }).then((granted) => {
                if (!granted) return;
                hidden.delete(host);
                void chrome.storage.local.set({ [HIDDEN_SITES_KEY]: [...hidden] });
                send({ type: "siteEnabled", tabId });
                note.replaceChildren(done);
            });
        const all = button("Show the Velai card on every careers site", "secondary", turnOn([ALL_SITES], "The Velai card now shows on job pages on any site."));
        note.append(
            all,
            el(
                "span",
                undefined,
                " Chrome asks once. On each page the card only checks whether it's a job, and Velai hears nothing about pages that aren't. Or ",
            ),
            button(`only on ${host}`, "inline", turnOn([pattern], `The Velai card now shows on ${host} job pages.`)),
            ".",
        );
        note.classList.add("card-site");
    }
    return note;
}

/** Rewordings listed in the panel before "and N more in the PDF". */
const REWORDED_SHOWN = 4;

function tailorNode(resume: ResumeData, job: PublicJob): HTMLElement {
    const tailored = tailoredResume(resume, job);
    const body: Node[] = [];
    const changes: string[] = [];
    if (tailored.movedRoles.length) {
        const n = tailored.movedRoles.length;
        changes.push(`In ${n} ${n === 1 ? "role" : "roles"}, the lines that use this job's words now come first.`);
    }
    if (tailored.leadingSkills.length) {
        changes.push(`Skills this job names lead their group: ${tailored.leadingSkills.slice(0, 5).join(", ")}.`);
    }
    const reworded = tailored.reworded.length + (tailored.summary ? 1 : 0);
    if (reworded) changes.push(`${reworded} ${reworded === 1 ? "line" : "lines"} reworded toward this job, using only words already in your résumé.`);
    if (changes.length) {
        const list = el("ul", "changes");
        list.append(...changes.map((text) => el("li", undefined, text)));
        body.push(list);
    } else {
        body.push(el("p", "muted", "Nothing could be reworded or reordered toward this job without adding words your résumé doesn't have, so this is your résumé as it is."));
    }
    if (tailored.summary) body.push(el("p", "diff-label", "Summary"), el("p", "diff-after", tailored.summary));
    for (const bullet of tailored.reworded.slice(0, REWORDED_SHOWN)) {
        body.push(el("p", "diff-label", `${bullet.role} · ${bullet.company}`), el("p", "diff-after", bullet.after), el("p", "diff-before", `Was: ${bullet.before}`));
    }
    if (tailored.reworded.length > REWORDED_SHOWN) body.push(el("p", "muted", `And ${tailored.reworded.length - REWORDED_SHOWN} more in the PDF.`));

    const status = el("p", "muted");
    const download = button("Download PDF", "primary", () => {
        download.disabled = true;
        status.textContent = "Making your PDF…";
        void tailoredResumePdf(tailored.resume, job)
            .then(({ blob, filename }) => {
                const url = URL.createObjectURL(blob);
                const a = el("a");
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                status.textContent = `Saved ${filename}.`;
            })
            .catch(() => {
                status.textContent = "The PDF couldn't be made. Copy the text instead.";
            })
            .finally(() => {
                download.disabled = false;
            });
    });
    const copy = button("Copy text", "secondary", () => {
        void navigator.clipboard
            .writeText(resumeDataToPlainText(tailored.resume))
            .then(() => (status.textContent = "Copied."))
            .catch(() => (status.textContent = "Copying didn't work here."));
    });
    const actions = el("div", "actions");
    actions.append(download, copy);
    body.push(actions, status);
    return section("Your résumé for this role", ...body);
}

// ── Screens ────────────────────────────────────────────────────────────────

function renderIdle(): void {
    shown = { kind: "other" };
    setSource(null);
    results.replaceChildren(
        el("p", "lede", "Open a job on any careers site or job board and click the Velai button, or the button on the Velai card."),
        el("p", "muted", "You'll see how it fits your Velai résumé, whether the posting looks current, and a copy of your résumé tailored to it."),
    );
}

/** The role as the site's job rows name it (`presentJob`), leaving out what isn't known. */
function jobHeader(job: PublicJob): HTMLElement {
    const presented = presentJob(job);
    const place = job.work_type === "remote" || presented.location !== LOCATION_UNKNOWN_TEXT ? presented.location : null;
    const header = el("header", "job");
    header.append(el("h1", "job-title", presented.title), el("p", "meta", [job.company ? presented.company.name : null, place].filter(Boolean).join(" · ")));
    return header;
}

/** Similar roles, each with its fit label when the person has a résumé on Velai. */
function similarNode(title: string, hits: PublicJob[], q: string, now: number, fit?: (job: PublicJob) => { label: string; tone: string } | null): HTMLElement {
    const list = el("ul", "rows");
    list.append(...hits.slice(0, SIMILAR_LIMIT).map((hit) => rowNode(panelRow(hit, now), fit?.(hit))));
    return section(title, list, link(velaiSearchUrl(q), "See more on Velai", "secondary"));
}

/**
 * The report for the job on a page. A page that publishes its job details
 * (schema.org JobPosting) is read as the job; one that doesn't is only
 * treated as a job when Velai has that role, or when the person says it is
 * one ("Read this page as the job"), so a page that isn't a job never gets a
 * fit label.
 */
async function renderPage(ctx: PageContext, textIsTheJob = false): Promise<void> {
    const mine = ++generation;
    const { read, site } = ctx;
    shown = { kind: "page", ctx, textIsTheJob };
    const fromTitle = queryFromPage(read.title, read.url);
    const pageJob = jobFromPage(read);
    input.value = read.posting ? [pageJob.title, pageJob.company].filter(Boolean).join(" ") : fromTitle.q || pageJob.title;
    const where = site ? `this ${site} page` : "this page";
    setSource(read.posting ? `Read from the job details ${where} publishes.` : `Reading ${where}…`);
    results.replaceChildren(jobHeader(pageJob), el("p", "status", "Checking with Velai…"));

    const [meResult, searchResult] = await Promise.allSettled([fetchMe(), searchVelai(input.value, PANEL_LIMIT)]);
    if (mine !== generation) return;
    const me = meResult.status === "fulfilled" ? meResult.value : null;
    const hits = searchResult.status === "fulfilled" && !searchResult.value.unavailable ? searchResult.value.hits : null;
    // Matching only: the page's stated employer, else what its title pairs the
    // role with. A wrong guess just doesn't match.
    const velaiJob = hits ? sameJob(hits, read.url, { title: pageJob.title, company: pageJob.company ?? (fromTitle.paired || null) }) : null;
    const now = Date.now();
    const retry = () => void renderPage(ctx, textIsTheJob);
    const resume = me ? resumeFromMe(me) : null;
    // Each similar role's fit label, scored the same way as the job on the page.
    const fitOf = resume
        ? (hit: PublicJob) => {
              const report = fitReport(resume, me?.preferences ?? null, hit);
              return report ? { label: report.label, tone: report.tone } : null;
          }
        : undefined;

    // A careers page with no structured details that still reads as a job is read as the job without asking.
    const autoRead = !read.posting && !textIsTheJob && looksLikeJob(read);
    if (autoRead) textIsTheJob = true;
    if (!read.posting && !velaiJob && !textIsTheJob) {
        setSource(`${where.charAt(0).toUpperCase()}${where.slice(1)} doesn't publish its job details.`);
        const parts: Node[] = [
            el("p", "notice", hits === null ? "Velai's search didn't answer, so it couldn't look for this role." : "Velai doesn't have a role that matches this page's title."),
            el("p", "muted", "If this page is a job, Velai can read its title and text as the job instead."),
        ];
        const actions = el("div", "actions");
        actions.append(button("Read this page as the job", "primary", () => void renderPage(ctx, true)));
        if (hits === null) actions.append(button("Try again", "secondary", retry));
        parts.push(actions);
        if (hits?.length) parts.push(similarNode("Roles on Velai like this page's title", hits, input.value, now, fitOf));
        const offer = await cardSiteNode(ctx).catch(() => null);
        if (mine !== generation) return;
        if (offer) parts.push(offer);
        results.replaceChildren(...parts);
        return;
    }
    if (!read.posting) {
        setSource(
            velaiJob
                ? `${where.charAt(0).toUpperCase()}${where.slice(1)} doesn't publish its job details, so this is Velai's copy of the role it names.`
                : autoRead
                  ? `Read from the heading and text of ${where}, which publishes no job details.`
                  : `Read from the title and text of ${where}, as you asked.`,
        );
    }

    // Velai's copy when it has the posting, so the fit and checks match the site's.
    const job = velaiJob ?? pageJob;
    const parts: Node[] = [jobHeader(job)];
    const fit = fitNode(me, resume, job, retry);
    const checks = velaiJob
        ? section("Velai's checks", checksNode(velaiChecks(velaiJob, now)), link(panelRow(velaiJob, now).velaiUrl, "Open on Velai", "secondary"))
        : hits === null
          ? section("Velai's checks", el("p", "notice", "Velai's search didn't answer, so this posting couldn't be checked."), button("Try again", "secondary", retry))
          : section("Velai's checks", checksNode(pageChecks(pageJob, validThrough(read), now)));
    // Lead with what Velai can already say: the fit when there's a résumé to
    // score, else the posting checks, which need no account, above the ask to sign in.
    parts.push(...(resume ? [fit, checks] : [checks, fit]));

    if (resume) {
        // Tailor to the fullest description of the role: the page's published
        // one when Velai's stored copy is shorter. A page's loose text is only
        // used when it is all there is.
        const pageText = read.posting || !velaiJob ? (pageJob.description ?? "") : "";
        const forTailor = velaiJob && (velaiJob.description ?? "").length < pageText.length ? { ...velaiJob, description: pageText } : job;
        parts.push(tailorNode(resume, forTailor));
    }

    if (me?.signedIn) {
        const applying = applyingNode(job, read.url);
        if (applying) parts.push(applying);
    }

    if (!velaiJob && hits?.length) parts.push(similarNode("Similar roles on Velai", hits, input.value, now, fitOf));
    const cardSite = await cardSiteNode(ctx).catch(() => null);
    if (mine !== generation) return;
    if (cardSite) parts.push(cardSite);
    results.replaceChildren(...parts);
}

async function renderSearch(raw: string): Promise<void> {
    shown = { kind: "other" };
    const q = raw.replace(/\s+/g, " ").trim();
    if (!q) {
        renderIdle();
        return;
    }
    const mine = ++generation;
    results.replaceChildren(el("p", "status", `Searching Velai for “${q}”…`));
    let result: JobSearchResult;
    try {
        result = await searchVelai(q, PANEL_LIMIT);
    } catch {
        if (mine === generation) results.replaceChildren(el("p", "notice", "Velai's search didn't answer."), button("Try again", "secondary", () => void renderSearch(q)));
        return;
    }
    if (mine !== generation) return;
    if (result.unavailable) {
        results.replaceChildren(el("p", "notice", result.note ?? "Velai's search didn't answer."), button("Try again", "secondary", () => void renderSearch(q)));
        return;
    }
    if (!result.hits?.length) {
        results.replaceChildren(
            el("p", "notice", `No role on Velai matches “${q}”.`),
            el("p", "muted", "Try fewer words, such as just the role or just the company."),
            link(velaiSearchUrl(q), "Search on Velai", "secondary"),
        );
        return;
    }
    const now = Date.now();
    const rows = result.hits.slice(0, PANEL_LIMIT).map((job) => panelRow(job, now));
    const header = el("p", "count");
    if (result.widened) {
        header.textContent = "Nothing matches every word of that, so these are the closest matches.";
    } else {
        header.append(el("strong", undefined, String(result.total)), ` ${result.total === 1 ? "role" : "roles"} on Velai match “${q}”`);
    }
    const list = el("ul", "rows");
    list.append(...rows.map((row) => rowNode(row)));
    const more = result.total > rows.length && !result.widened ? `See all ${result.total} on Velai` : "Open this search on Velai";
    results.replaceChildren(header, list, link(velaiSearchUrl(q), more, "secondary"));
}

function apply(handOff: HandOff | null): void {
    if (!handOff) {
        renderIdle();
    } else if (handOff.kind === "page") {
        void renderPage({ read: handOff.read, site: handOff.site, tabId: handOff.tabId });
    } else {
        input.value = handOff.q;
        setSource(handOff.site ? `Searching the text you selected on ${handOff.site}.` : null);
        void renderSearch(handOff.q);
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    setSource(null);
    void renderSearch(input.value);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[PAGE_QUERY_KEY]?.newValue) apply(changes[PAGE_QUERY_KEY].newValue as HandOff);
    // Signed in, or closed the résumé editor: check the job on screen again, no click needed.
    if (area === "local" && changes[ACCOUNT_CHANGED_KEY] && shown.kind === "page") void renderPage(shown.ctx, shown.textIsTheJob);
});

void chrome.storage.session.get(PAGE_QUERY_KEY).then((stored) => apply((stored[PAGE_QUERY_KEY] as HandOff | undefined) ?? null));
