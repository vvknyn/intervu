/**
 * The Velai card: a content script on job boards and applicant-tracking sites
 * (job-sites.json) and on any site the person turned it on for. On a page
 * that is a job, it shows a small card with the person's fit and a few
 * facts about the posting, each saying where it comes from. The service
 * worker does the work (velai.app calls, scoring); this only reads the page
 * and draws the card. Pages that aren't jobs get nothing.
 */
import { readJobPage, type PageRead } from "./page-reader";
import { ACCOUNT_CHANGED_KEY, HIDDEN_SITES_KEY, type CardAnswer, type ToBackground, type TrackAnswer } from "./messages";
import type { CardSummary } from "./card-summary";

const HOST_ID = "velai-card-host";
/** Client-rendered job pages fill in after load; look once more after this. */
const RETRY_MS = 2_500;
/** Single-page sites (LinkedIn) change the URL without a reload. */
const URL_POLL_MS = 1_000;
/** ...and fill in the new job a moment after; reading at once would read the last one. */
const SPA_SETTLE_MS = 1_200;

let checkedUrl = "";
let dismissedUrl = "";
/** What the card last said about the account, to look again when the person comes back to the tab. */
let shownAccount: CardSummary["account"] = null;

function send<T>(message: ToBackground): Promise<T> {
    return chrome.runtime.sendMessage(message) as Promise<T>;
}

function removeCard(): void {
    document.getElementById(HOST_ID)?.remove();
}

async function hiddenHere(): Promise<boolean> {
    const stored = await chrome.storage.local.get(HIDDEN_SITES_KEY);
    const hidden = (stored[HIDDEN_SITES_KEY] as string[] | undefined) ?? [];
    return hidden.includes(location.hostname);
}

/* Velai's dark palette, as in sidepanel.css. */
const STYLE = `
:host { all: initial; }
.card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 320px; max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 12px 14px; border-radius: 12px; background: rgb(16 18 24); color: rgb(245 245 245); border: 1px solid rgb(38 38 38);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; text-align: left; }
.head { display: flex; align-items: center; gap: 8px; }
.brand { font-weight: 600; }
.close { margin-left: auto; border: 0; background: none; color: rgb(163 163 163); font: 18px/1 inherit; cursor: pointer; padding: 2px 4px; }
.close:hover { color: rgb(245 245 245); }
.title { margin: 8px 0 0; font-weight: 600; }
.fit { margin: 8px 0 0; }
.chip { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; font-size: 13px; font-weight: 600; }
.fit-strong { color: rgb(47 191 113); } .fit-good { color: rgb(245 245 245); } .fit-stretch, .fit-outside { color: rgb(245 158 11); }
.fit-source { margin-left: 6px; font-size: 12px; color: rgb(163 163 163); }
.note { margin: 8px 0 0; font-size: 13px; color: rgb(163 163 163); }
ul { list-style: none; margin: 8px 0 0; padding: 0; }
li { margin-top: 4px; }
li::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 999px; background: rgb(163 163 163); vertical-align: middle; }
li.ok::before { background: rgb(47 191 113); } li.warn::before { background: rgb(245 158 11); } li.bad::before { background: rgb(255 59 105); }
.src { color: rgb(163 163 163); font-size: 12px; }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
button { font: inherit; cursor: pointer; }
button.primary { border: 0; border-radius: 10px; padding: 7px 12px; background: rgb(47 191 113); color: rgb(8 9 12); font-weight: 600; }
button.secondary { border: 1px solid rgb(38 38 38); border-radius: 10px; padding: 6px 12px; background: transparent; color: rgb(245 245 245); }
button.secondary:hover { background: rgb(26 26 26); }
button:disabled { opacity: 0.6; cursor: default; }
button.link { border: 0; background: none; padding: 0; color: rgb(163 163 163); font-size: 12px; text-decoration: underline; }
.done { margin: 0; font-size: 13px; color: rgb(47 191 113); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Velai's mark (icons/icon128.png) drawn inline: an image file would have to be
 *  web-accessible to every site, which lets any page detect the extension. */
function mark(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    const parts: [string, Record<string, string>][] = [
        ["rect", { width: "32", height: "32", rx: "7", fill: "rgb(248 245 237)" }],
        ["path", { d: "M11 8H8v16h3", fill: "none", stroke: "rgb(24 48 92)", "stroke-width": "3" }],
        ["path", { d: "M21 8h3v16h-3", fill: "none", stroke: "rgb(24 48 92)", "stroke-width": "3" }],
        ["circle", { cx: "16", cy: "16", r: "5", fill: "rgb(56 153 110)" }],
    ];
    for (const [tag, attrs] of parts) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        svg.append(node);
    }
    return svg;
}

const ACCOUNT_NOTE: Record<NonNullable<CardSummary["account"]>, string> = {
    "signed-out": "Sign in to Velai to see how this fits your résumé.",
    "no-resume": "Add your résumé on Velai to see how this fits you.",
    "no-overlap": "Your résumé and this role don't share enough to score.",
    unavailable: "Velai didn't answer, so your fit isn't shown.",
};

function render(summary: CardSummary, read: PageRead): void {
    removeCard();
    const host = el("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "closed" });
    const style = el("style");
    style.textContent = STYLE;
    const card = el("section", "card");
    card.setAttribute("role", "complementary");
    card.setAttribute("aria-label", "Velai");

    const head = el("div", "head");
    head.append(mark(), el("span", "brand", "Velai"), button("×", "close", () => {
        dismissedUrl = location.href;
        removeCard();
    }));
    head.querySelector(".close")?.setAttribute("aria-label", "Close");
    card.append(head, el("p", "title", [summary.title, summary.company].filter(Boolean).join(" · ")));

    if (summary.fit) {
        const fit = el("p", "fit");
        fit.append(el("span", `chip fit-${summary.fit.tone}`, summary.fit.label), el("span", "fit-source", "against your résumé"));
        card.append(fit);
    } else if (summary.account) {
        card.append(el("p", "note", ACCOUNT_NOTE[summary.account]));
    }

    if (summary.lines.length) {
        const list = el("ul");
        for (const line of summary.lines) {
            const li = el("li", line.tone);
            li.append(`${line.text} `, el("span", "src", `· ${line.source}`));
            list.append(li);
        }
        card.append(list);
    }

    const actions = el("div", "actions");
    if (summary.account === "signed-out") {
        actions.append(button("Sign in to see your fit", "primary", () => void send({ type: "signIn" })));
    } else if (summary.account === "no-resume") {
        actions.append(button("Add your résumé", "primary", () => void send({ type: "openVelai", path: "/resume" })));
    } else {
        const label = summary.fit ? "Your résumé for this job" : "Open in Velai";
        actions.append(button(label, "primary", () => void send({ type: "openPanel", read })));
    }
    const track = summary.track;
    if (track) {
        const applied = button("I applied", "secondary", () => {
            applied.disabled = true;
            void send<TrackAnswer>({ type: "track", job: track }).then((answer) => {
                if (answer.ok) applied.replaceWith(el("p", "done", "Added to your Velai tracker as Applied"));
                else {
                    applied.disabled = false;
                    applied.textContent = `${answer.error} Try again`;
                }
            });
        });
        actions.append(applied);
    }
    card.append(actions);
    const off = button(`Don't show on ${location.hostname}`, "link", () => {
        void chrome.storage.local.get(HIDDEN_SITES_KEY).then((stored) => {
            const hidden = new Set((stored[HIDDEN_SITES_KEY] as string[] | undefined) ?? []);
            hidden.add(location.hostname);
            return chrome.storage.local.set({ [HIDDEN_SITES_KEY]: [...hidden] });
        });
        removeCard();
    });
    const footer = el("div", "actions");
    footer.append(off);
    card.append(footer);

    root.append(style, card);
    document.documentElement.append(host);
    shownAccount = summary.account;
}

async function check(force = false, settleMs = 0): Promise<void> {
    const url = location.href;
    if (!force && url === checkedUrl) return;
    checkedUrl = url;
    // A new page drops the last one's card at once; a re-check of the same page keeps it until the answer.
    if (!force) removeCard();
    if (settleMs) {
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        if (location.href !== url) return;
    }
    if (url === dismissedUrl || (await hiddenHere())) {
        removeCard();
        return;
    }
    let read = readJobPage();
    let summary = await send<CardAnswer>({ type: "card", read, fresh: force });
    if (!summary && !read.posting) {
        // A page that fills in its job details after load.
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        if (location.href !== url) return;
        read = readJobPage();
        if (read.posting) summary = await send<CardAnswer>({ type: "card", read });
    }
    if (location.href !== url) return;
    if (summary) render(summary, read);
    else removeCard();
}

// One card per page, even if the script is injected twice (built-in site and a site the person turned on).
const flag = "__velaiCard";
const w = window as unknown as Record<string, boolean>;
if (!w[flag]) {
    w[flag] = true;
    void check();
    const poll = setInterval(() => {
        // The extension was updated or removed: this copy of the script has nothing left to talk to.
        if (!chrome.runtime?.id) clearInterval(poll);
        else if (location.href !== checkedUrl) void check(false, SPA_SETTLE_MS);
    }, URL_POLL_MS);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[ACCOUNT_CHANGED_KEY] && document.getElementById(HOST_ID)) void check(true);
    });
    // Signed in or added a résumé in another tab: look again on coming back.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && document.getElementById(HOST_ID) && shownAccount && shownAccount !== "no-overlap") void check(true);
    });
}
