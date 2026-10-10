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
 *  - Sign-in and the résumé editor open velai.app in a small window over the
 *    job page. A sign-in window closes itself once velai.app says the person
 *    is signed in; closing either window tells the card and the panel to
 *    check the job again, so nobody has to find their way back and click.
 */
import { PAGE_QUERY_KEY, hostOf, queryFromPage, queryFromSelection } from "./page-query";
import { jobFromPage, readJobPage, validThrough, type PageRead } from "./page-reader";
import { resumeFromMe, sameJob, type MeResponse } from "./report";
import { cardSummary } from "./card-summary";
import { fetchMe, isSignedInLanding, searchVelai, SIGN_IN_PATH, trackApplied } from "./velai-api";
import { ACCOUNT_CHANGED_KEY, type CardAnswer, type ToBackground, type TrackAnswer } from "./messages";
import { JOB_SITE_MATCHES } from "./job-sites";
import { VELAI_ORIGIN } from "./rows";
import type { HandOff } from "./handoff";
import type { JobSearchResult } from "@/lib/jobs/types";

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

// ── The on-page card ───────────────────────────────────────────────────────

/** What the card shows for a page, or null for no card: a page that doesn't
 *  publish its job details only gets one when Velai has the role it names. */
async function cardFor(read: PageRead, fresh: boolean): Promise<CardAnswer> {
    const pageJob = jobFromPage(read);
    const fromTitle = queryFromPage(read.title, read.url);
    const q = read.posting ? [pageJob.title, pageJob.company].filter(Boolean).join(" ") : fromTitle.q;
    if (!q.trim()) return null;
    const [account, result] = await Promise.all([getMe(fresh), searchOnce(q)]);
    const velaiJob = result ? sameJob(result.hits, read.url, { title: pageJob.title, company: pageJob.company ?? (fromTitle.paired || null) }) : null;
    if (!read.posting && !velaiJob) return null;
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
    const script = { id: OPTIONAL_SCRIPT_ID, matches: granted, js: ["card.js"], runAt: "document_idle" as const, persistAcrossSessions: true };
    await (registered.length ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]));
}

chrome.permissions.onAdded.addListener(() => void syncOptionalSites());
chrome.permissions.onRemoved.addListener(() => void syncOptionalSites());

// ── Messages from the card and the panel ───────────────────────────────────

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as ToBackground;
    switch (message.type) {
        case "card":
            void cardFor(message.read, message.fresh === true).then(sendResponse, () => sendResponse(null));
            return true;
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
            void trackApplied(message.job).then(
                (r): TrackAnswer => (r.ok ? { ok: true } : { ok: false, error: "Velai didn't save it." }),
                (): TrackAnswer => ({ ok: false, error: "Velai didn't answer." }),
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
