/**
 * Service worker. Two ways in, both a click by the person:
 *  - the toolbar button reads the job off the clicked tab (`activeTab` grants
 *    that one tab, that one time; `readJobPage` runs there) and opens the
 *    side panel on it;
 *  - "Search Velai for …" on selected text opens the panel on that search.
 * The panel picks the hand-off up from session storage, which only extension
 * pages can read and which clears when the browser closes.
 */
import { PAGE_QUERY_KEY, hostOf, queryFromSelection } from "./page-query";
import { readJobPage, type PageRead } from "./page-reader";
import type { HandOff } from "./handoff";

const MENU_ID = "velai-search-selection";

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

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Search Velai for “%s”", contexts: ["selection"] });
});

chrome.action.onClicked.addListener((tab) => {
    // open() must run inside the click's user gesture, before anything awaits.
    void chrome.sidePanel.open({ windowId: tab.windowId });
    void readTab(tab).then((read) => handOff({ kind: "page", read, site: hostOf(read.url), at: Date.now() }));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab) return;
    void chrome.sidePanel.open({ windowId: tab.windowId });
    const query = queryFromSelection(info.selectionText ?? "", info.pageUrl ?? tab.url ?? "");
    handOff({ kind: "search", q: query.q, site: query.site, at: Date.now() });
});
