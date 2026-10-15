/**
 * Service worker.
 *  - The toolbar button reads the job off the clicked tab (`activeTab` grants
 *    that one tab, that one time; `readJobPage` runs there) and opens the
 *    side panel on it. "Search Velai for …" on selected text opens the panel
 *    on that search. The panel picks the hand-off up from session storage,
 *    which only extension pages can read and which clears when the browser
 *    closes.
 *  - The on-page card (card.ts, on the job sites in job-sites.json and any
 *    site the person turned it on for) asks here what to show: the velai.app
 *    calls and the scoring run in this worker, not in the page.
 *  - The card's "Fill from your résumé" gets the résumé's contact details and
 *    the PDF (the résumé with the changes the person accepted for the tab's
 *    job in the panel) from here, and once the site confirms the application
 *    this adds the job to the tracker as Applied.
 *  - Sign-in and the résumé editor open velai.app in a small window over the
 *    job page. A sign-in window closes itself once velai.app says the person
 *    is signed in; closing either window tells the card and the panel to
 *    check the job again, so nobody has to find their way back and click.
 */
import { PAGE_QUERY_KEY, hostOf, queryFromPage, queryFromSelection } from "./page-query";
import { jobFromPage, looksLikeJob, readJobPage, validThrough, type PageRead } from "./page-reader";
import { resumeFromMe, sameJob, tailoringJob, type MeResponse } from "./report";
import { cardSummary, type TrackJob } from "./card-summary";
import { contactValues } from "./form-fill";
import { tailoredResumePdf, toBase64 } from "./resume-pdf";
import { loadChoice } from "./tailor-choices";
import { acceptedCount, acceptedResume, choiceKey, decisionsFor, proposeChanges } from "./tailor-review";
import { fetchMe, isSignedInLanding, saveToTracker, searchVelai, SIGN_IN_PATH, trackApplied } from "./velai-api";
import { ACCOUNT_CHANGED_KEY, type AppliedAnswer, type CardAnswer, type DraftAnswer, type FillAnswer, type PendingFill, type SaveAnswer, type ToBackground, type TrackAnswer } from "./messages";
import { trackerStatusLabel } from "@/lib/pursuits/tracker-display";
import { ALL_SITES, JOB_SITE_MATCHES } from "./job-sites";
import { VELAI_ORIGIN } from "./rows";
import type { HandOff } from "./handoff";
import type { JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";
import { sealedAiStatus, sealedChat, useSealedAiOrigin } from "@/lib/sealed-ai/client";
import { draftScreeningAnswer } from "@/lib/screening/answer";
import { classifyQuestion, questionText } from "@/lib/screening/question";

const MENU_ID = "velai-search-selection";
/** The registered content script for sites the person turned the card on for. */
const OPTIONAL_SCRIPT_ID = "velai-card-sites";
/** storage.session: the velai.app window this worker opened, which survives the worker restarting. */
const VELAI_WINDOW_KEY = "velaiWindow";
/** Roles the card's lookup asks for; the posting is usually first. */
const CARD_SEARCH_LIMIT = 10;
/** How long the card reuses the account answer and a page's search. */
const ME_TTL_MS = 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
/** storage.session: per tab, the last job page the card read, for an application form on a later page of the same site. */
const TAB_JOBS_KEY = "velaiTabJobs";
/** storage.session: per tab, the job whose application form the card filled, until the site confirms it was sent. */
const FILLED_KEY = "velaiFilled";
/** How long a tab's job, or a filled form, is remembered. */
const TAB_MEMORY_MS = 2 * 60 * 60_000;

interface VelaiWindow {
    windowId: number;
    kind: "signIn" | "edit";
}

function handOff(value: HandOff): void {
    void chrome.storage.session.set({ [PAGE_QUERY_KEY]: value });
}

/** The page's own read, or just its title and URL where Chrome won't let an
 *  extension read a page (the Web Store, chrome:// pages, PDFs). */
async function readTab(tab: chrome.tabs.Tab): Promise<PageRead> {
    const fallback: PageRead = { url: tab.url ?? "", title: tab.title ?? "", posting: null, text: "" };
    if (tab.id == null) return fallback;
    try {
        const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readJobPage });
        return injection?.result ?? fallback;
    } catch {
        return fallback;
    }
}

// ── The account, remembered briefly ────────────────────────────────────────

let me: { at: number; value: Promise<MeResponse | null> } | null = null;
const searches = new Map<string, { at: number; value: Promise<JobSearchResult | null> }>();

function getMe(fresh: boolean): Promise<MeResponse | null> {
    if (fresh || !me || Date.now() - me.at > ME_TTL_MS) {
        me = { at: Date.now(), value: fetchMe().catch(() => null) };
    }
    return me.value;
}

function searchOnce(q: string): Promise<JobSearchResult | null> {
    const now = Date.now();
    for (const [key, entry] of searches) if (now - entry.at > SEARCH_TTL_MS) searches.delete(key);
    let entry = searches.get(q);
    if (!entry) {
        entry = {
            at: now,
            value: searchVelai(q, CARD_SEARCH_LIMIT, true)
                .then((r) => (r.unavailable ? null : r))
                .catch(() => null),
        };
        searches.set(q, entry);
        // A failed lookup is tried again next time rather than remembered.
        void entry.value.then((r) => r ?? searches.delete(q));
    }
    return entry.value;
}

/** The person may have signed in or changed their résumé: forget the
 *  remembered account and tell the card and the panel to check again. */
function accountChanged(): void {
    me = null;
    void chrome.storage.local.set({ [ACCOUNT_CHANGED_KEY]: Date.now() });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ACCOUNT_CHANGED_KEY]) me = null;
});

// ── What each tab is applying to ───────────────────────────────────────────

interface Remembered<T> {
    host: string | null;
    at: number;
    value: T;
}

async function tabMemory<T>(key: string, tabId: number, url: string): Promise<T | null> {
    const stored = await chrome.storage.session.get(key);
    const entry = ((stored[key] ?? {}) as Record<string, Remembered<T>>)[tabId];
    return entry && entry.host != null && entry.host === hostOf(url) && Date.now() - entry.at < TAB_MEMORY_MS ? entry.value : null;
}

/** Writes to one key wait for the last, so two tabs writing at once don't drop each other's entry. */
const memoryWrites = new Map<string, Promise<void>>();

function setTabMemory<T>(key: string, tabId: number, url: string, value: T | null): Promise<void> {
    const write = async () => {
        const stored = await chrome.storage.session.get(key);
        const all = { ...((stored[key] ?? {}) as Record<string, Remembered<T>>) };
        for (const [id, entry] of Object.entries(all)) if (Date.now() - entry.at >= TAB_MEMORY_MS) delete all[id];
        if (value == null) delete all[tabId];
        else all[tabId] = { host: hostOf(url), at: Date.now(), value };
        await chrome.storage.session.set({ [key]: all });
    };
    const done = (memoryWrites.get(key) ?? Promise.resolve()).then(write, write);
    memoryWrites.set(key, done.catch(() => {}));
    return done;
}

/** The job a page is about: the page itself when it reads as a job, else the
 *  job page the person came from on the same site in this tab (an
 *  application form often sits on a page of its own). */
async function jobReadFor(read: PageRead, tabId: number | undefined): Promise<PageRead> {
    if (read.posting || looksLikeJob(read) || tabId == null) return read;
    return (await tabMemory<PageRead>(TAB_JOBS_KEY, tabId, read.url)) ?? read;
}

chrome.tabs.onRemoved.addListener((tabId) => {
    void setTabMemory(TAB_JOBS_KEY, tabId, "", null);
    void setTabMemory(FILLED_KEY, tabId, "", null);
});

// ── The on-page card ───────────────────────────────────────────────────────

/** What to search Velai for to find the job a page is about, and the employer its title pairs the role with. */
function lookupFor(read: PageRead, pageJob: PublicJob): { q: string; paired: string } {
    const fromTitle = queryFromPage(read.title, read.url);
    return { q: read.posting ? [pageJob.title, pageJob.company].filter(Boolean).join(" ") : fromTitle.q, paired: fromTitle.paired };
}

/** Velai's copy of the page's job among the search's hits, if one is it. */
function velaiCopyOf(result: JobSearchResult | null, read: PageRead, pageJob: PublicJob, paired: string): PublicJob | null {
    return result ? sameJob(result.hits, read.url, { title: pageJob.title, company: pageJob.company ?? (paired || null) }) : null;
}

/** What the card shows for a page, or null for no card: a page that doesn't
 *  publish its job details only gets one when Velai has the role it names,
 *  the page reads as a job, or it has an application form. */
async function cardFor(pageRead: PageRead, fresh: boolean, tabId: number | undefined, applying: boolean): Promise<CardAnswer> {
    const read = applying ? await jobReadFor(pageRead, tabId) : pageRead;
    const pageJob = jobFromPage(read);
    const { q, paired } = lookupFor(read, pageJob);
    if (!q.trim()) return null;
    const [account, result] = await Promise.all([getMe(fresh), searchOnce(q)]);
    const velaiJob = velaiCopyOf(result, read, pageJob, paired);
    // A page with no structured details still gets a card when Velai has the role or the page reads as a job.
    const isJob = Boolean(read.posting || velaiJob || looksLikeJob(read));
    if (!isJob && !applying) return null;
    if (isJob && tabId != null) await setTabMemory(TAB_JOBS_KEY, tabId, read.url, read);
    return cardSummary({
        pageJob,
        velaiJob,
        applyBy: validThrough(read),
        signedIn: account ? account.signedIn : null,
        resume: account?.signedIn ? resumeFromMe(account) : null,
        prefs: account?.preferences ?? null,
        resumeUpdatedAt: account?.resume?.updatedAt ?? null,
        nowMs: Date.now(),
    });
}

// ── Filling an application form ────────────────────────────────────────────

/** The signed-in account's résumé and the posting an application form is for: what fillData and draftAnswer both start from. */
async function applyingTo(read: PageRead, tabId: number | undefined): Promise<{ ok: true; account: MeResponse; resume: ResumeData; job: PublicJob } | { ok: false; error: string }> {
    const account = await getMe(false);
    if (!account) return { ok: false, error: "Velai didn't answer." };
    if (!account.signedIn) return { ok: false, error: "Sign in to Velai first." };
    const resume = resumeFromMe(account);
    if (!resume) return { ok: false, error: "Add your résumé to Velai first." };
    const jobRead = await jobReadFor(read, tabId);
    const pageJob = jobFromPage(jobRead);
    // The same posting the panel proposes changes for, so the same choices apply.
    const { q, paired } = lookupFor(jobRead, pageJob);
    const velaiJob = q.trim() ? velaiCopyOf(await searchOnce(q), jobRead, pageJob, paired) : null;
    return { ok: true, account, resume, job: tailoringJob(jobRead, pageJob, velaiJob) };
}

/**
 * The résumé's contact details and its PDF for the card to put in the form:
 * the person's résumé with the changes they accepted for this job in the panel
 * (tailor-review.ts), none if they haven't decided any. `tailored` says how
 * many of the proposed changes that is, for the card to tell them.
 */
async function fillData(read: PageRead, tabId: number | undefined): Promise<FillAnswer> {
    const applying = await applyingTo(read, tabId);
    if (!applying.ok) return applying;
    const { account, resume, job } = applying;
    let pdf: { base64: string; filename: string } | null = null;
    let tailored = { accepted: 0, proposed: 0 };
    try {
        const draft = proposeChanges(resume, job);
        const decisions = decisionsFor(draft, await loadChoice(choiceKey(job)), account.resume?.updatedAt ?? null);
        tailored = { accepted: acceptedCount(draft, decisions), proposed: draft.changes.length };
        const made = await tailoredResumePdf(acceptedResume(draft, decisions), job);
        pdf = { base64: toBase64(await made.blob.arrayBuffer()), filename: made.filename };
    } catch {
        // The contact details still go in; the person attaches a file themselves.
        pdf = null;
    }
    return { ok: true, values: contactValues(resume.profile), pdf, tailored };
}

// ── Drafting an answer to a question on the form ───────────────────────────

// Sealed AI goes through velai.app's pass-through, from here instead of from a velai.app page.
useSealedAiOrigin(VELAI_ORIGIN);
/** The longest a draft waits for the sealed model (attesting its server, then the answer) before the résumé lines stand in for it. */
const SEALED_ANSWER_MS = 45_000;

const leftToYou = (reason: string): DraftAnswer => ({ ok: false, error: `Velai leaves this one to you: ${reason}.` });

/**
 * A draft answer to one question, on the person's tap. A question Velai leaves
 * to the person, or that no résumé line speaks to, is answered with why and
 * nothing is sent anywhere. Otherwise the draft comes from the few résumé
 * lines that bear on it: written by the sealed AI from those lines (and the
 * question and the job's title and company) when it is set up and answers,
 * else the lines themselves. Never touches the form.
 */
async function draftAnswer(read: PageRead, question: string, tabId: number | undefined): Promise<DraftAnswer> {
    const asked = questionText(question);
    const verdict = classifyQuestion(asked);
    if (!verdict.draft) return leftToYou(verdict.reason);
    const applying = await applyingTo(read, tabId);
    if (!applying.ok) return applying;
    const sealed = (await sealedAiStatus()).enabled;
    const chat: Parameters<typeof draftScreeningAnswer>[0]["chat"] = sealed
        ? (messages, options) => Promise.race([sealedChat(messages, options), new Promise<null>((resolve) => setTimeout(resolve, SEALED_ANSWER_MS, null))])
        : undefined;
    const draft = await draftScreeningAnswer({ chat }, { resume: applying.resume, question: asked, job: { title: applying.job.title, company: applying.job.company ?? "" } });
    if (!draft.verdict.draft || !draft.by) return leftToYou(draft.verdict.draft ? "nothing to draft" : draft.verdict.reason);
    return { ok: true, text: draft.text, by: draft.by, lines: draft.lines.map(({ text, where }) => ({ text, where })) };
}

/** Tabs whose confirmed application is being tracked right now (the page and its watcher can both see the confirmation). */
const confirming = new Set<number>();

/** The site confirmed the application the card filled: track it once. */
async function appliedAfterFill(tabId: number, url: string): Promise<AppliedAnswer> {
    if (confirming.has(tabId)) return null;
    confirming.add(tabId);
    try {
        const track = await tabMemory<TrackJob>(FILLED_KEY, tabId, url);
        if (!track) return null;
        await setTabMemory(FILLED_KEY, tabId, url, null);
        const answer: TrackAnswer = await trackApplied(track).then(
            (r): TrackAnswer => (r.ok ? { ok: true } : { ok: false, error: "Velai didn't save it." }),
            (): TrackAnswer => ({ ok: false, error: "Velai didn't answer." }),
        );
        return { ...answer, title: track.title };
    } finally {
        confirming.delete(tabId);
    }
}

// ── velai.app in a small window ────────────────────────────────────────────

async function velaiWindow(): Promise<VelaiWindow | null> {
    const stored = await chrome.storage.session.get(VELAI_WINDOW_KEY);
    return (stored[VELAI_WINDOW_KEY] as VelaiWindow | undefined) ?? null;
}

async function openVelaiWindow(path: string, kind: VelaiWindow["kind"]): Promise<void> {
    const prior = await velaiWindow();
    if (prior) {
        await chrome.storage.session.remove(VELAI_WINDOW_KEY);
        await chrome.windows.remove(prior.windowId).catch(() => {});
    }
    const win = await chrome.windows.create({ url: `${VELAI_ORIGIN}${path}`, type: "popup", width: 480, height: 760, focused: true });
    if (win.id != null) await chrome.storage.session.set({ [VELAI_WINDOW_KEY]: { windowId: win.id, kind } satisfies VelaiWindow });
}

/** A sign-in window that has reached velai.app proper: close it once velai.app confirms the sign-in. */
async function onVelaiWindowPage(tab: chrome.tabs.Tab): Promise<void> {
    const open = await velaiWindow();
    if (!open || open.kind !== "signIn" || tab.windowId !== open.windowId || !tab.url || !isSignedInLanding(tab.url)) return;
    const account = await getMe(true);
    if (!account?.signedIn) return;
    await chrome.storage.session.remove(VELAI_WINDOW_KEY);
    accountChanged();
    await chrome.windows.remove(open.windowId).catch(() => {});
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (info.status === "complete" || info.url) void onVelaiWindowPage(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
    void velaiWindow().then(async (open) => {
        if (open?.windowId !== windowId) return;
        await chrome.storage.session.remove(VELAI_WINDOW_KEY);
        accountChanged();
    });
});

// ── Sites the person turned the card on for ────────────────────────────────

/** Keeps the card's registered content script in step with the sites the
 *  person granted (optional host permissions, one site at a time). */
async function syncOptionalSites(): Promise<void> {
    const { origins = [] } = await chrome.permissions.getAll();
    const builtIn = new Set([`${VELAI_ORIGIN}/*`, ...JOB_SITE_MATCHES]);
    const granted = origins.filter((origin) => !builtIn.has(origin));
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [OPTIONAL_SCRIPT_ID] });
    if (!granted.length) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [OPTIONAL_SCRIPT_ID] });
        return;
    }
    // Every site, once granted, covers the single sites; velai.app and the built-in job sites have their own copy.
    const matches = granted.includes(ALL_SITES) ? [ALL_SITES] : granted;
    const script = {
        id: OPTIONAL_SCRIPT_ID,
        matches,
        excludeMatches: [`${VELAI_ORIGIN}/*`, ...JOB_SITE_MATCHES],
        js: ["card.js"],
        runAt: "document_idle" as const,
        persistAcrossSessions: true,
    };
    await (registered.length ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]));
}

chrome.permissions.onAdded.addListener(() => void syncOptionalSites());
chrome.permissions.onRemoved.addListener(() => void syncOptionalSites());

// ── Messages from the card and the panel ───────────────────────────────────

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as ToBackground;
    switch (message.type) {
        case "card":
            void cardFor(message.read, message.fresh === true, sender.tab?.id, message.applying === true).then(sendResponse, () => sendResponse(null));
            return true;
        case "draftAnswer":
            void draftAnswer(message.read, message.question, sender.tab?.id).then(sendResponse, () => sendResponse({ ok: false, error: "Velai couldn't draft this one." } satisfies DraftAnswer));
            return true;
        case "fillData":
            void fillData(message.read, sender.tab?.id).then(sendResponse, () => sendResponse({ ok: false, error: "The form couldn't be filled." } satisfies FillAnswer));
            return true;
        case "filled": {
            const tabId = sender.tab?.id;
            const url = sender.url ?? sender.tab?.url;
            if (tabId != null && url) void setTabMemory(FILLED_KEY, tabId, url, message.track);
            sendResponse(true);
            return false;
        }
        case "pendingFill": {
            const tabId = sender.tab?.id;
            const url = sender.url ?? sender.tab?.url;
            if (tabId == null || !url) {
                sendResponse(null);
                return false;
            }
            void tabMemory<TrackJob>(FILLED_KEY, tabId, url).then(
                (track) => sendResponse(track ? ({ title: track.title } satisfies PendingFill) : null),
                () => sendResponse(null),
            );
            return true;
        }
        case "appliedAfterFill": {
            const tabId = sender.tab?.id;
            const url = sender.url ?? sender.tab?.url;
            if (tabId == null || !url) {
                sendResponse(null);
                return false;
            }
            void appliedAfterFill(tabId, url).then(sendResponse, () => sendResponse(null));
            return true;
        }
        case "openPanel": {
            const tab = sender.tab;
            if (tab) {
                // Inside the click's user gesture, before anything awaits. Where
                // Chrome doesn't carry the gesture over, the panel opens in a
                // small window instead.
                void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() =>
                    chrome.windows.create({ url: chrome.runtime.getURL("sidepanel.html"), type: "popup", width: 420, height: 800 }),
                );
                handOff({ kind: "page", read: message.read, site: hostOf(message.read.url), at: Date.now(), tabId: tab.id });
            }
            sendResponse(true);
            return false;
        }
        case "signIn":
            void openVelaiWindow(SIGN_IN_PATH, "signIn").then(() => sendResponse(true), () => sendResponse(false));
            return true;
        case "openVelai":
            void openVelaiWindow(message.path.startsWith("/") ? message.path : `/${message.path}`, "edit").then(
                () => sendResponse(true),
                () => sendResponse(false),
            );
            return true;
        case "track":
            // Tracked by hand: nothing left to track when the site confirms.
            if (sender.tab?.id != null) void setTabMemory(FILLED_KEY, sender.tab.id, "", null);
            void trackApplied(message.job).then(
                (r): TrackAnswer => (r.ok ? { ok: true } : { ok: false, error: "Velai didn't save it." }),
                (): TrackAnswer => ({ ok: false, error: "Velai didn't answer." }),
            ).then(sendResponse);
            return true;
        case "save":
            // Saving isn't applying: a filled form still waits for the site's confirmation.
            void saveToTracker(message.job).then(
                (r): SaveAnswer => (r.ok ? { ok: true, status: trackerStatusLabel(r.status ?? "interested") } : { ok: false, error: "Velai didn't save it." }),
                (e: unknown): SaveAnswer => ({ ok: false, error: /HTTP 401/.test(String(e)) ? "Velai says you're signed out." : "Velai didn't answer." }),
            ).then(sendResponse);
            return true;
        case "siteEnabled":
            void syncOptionalSites()
                .then(() => chrome.scripting.executeScript({ target: { tabId: message.tabId }, files: ["card.js"] }))
                .then(() => sendResponse(true), () => sendResponse(false));
            return true;
        default:
            return false;
    }
});

// ── Toolbar, menu, install ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Search Velai for “%s”", contexts: ["selection"] });
    void syncOptionalSites();
    // First install: a short welcome that signs the person in there, so the
    // first job page they open already shows their fit.
    if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onStartup.addListener(() => void syncOptionalSites());

chrome.action.onClicked.addListener((tab) => {
    // open() must run inside the click's user gesture, before anything awaits.
    void chrome.sidePanel.open({ windowId: tab.windowId });
    void readTab(tab).then((read) => handOff({ kind: "page", read, site: hostOf(read.url), at: Date.now(), tabId: tab.id }));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab) return;
    void chrome.sidePanel.open({ windowId: tab.windowId });
    const query = queryFromSelection(info.selectionText ?? "", info.pageUrl ?? tab.url ?? "");
    handOff({ kind: "search", q: query.q, site: query.site, at: Date.now() });
});
