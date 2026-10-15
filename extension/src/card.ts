/**
 * The Velai card: a content script on job boards and applicant-tracking sites
 * (job-sites.json) and on any site the person turned it on for. On a page
 * that is a job, it shows a small card with the person's fit and a few
 * facts about the posting, each saying where it comes from. The service
 * worker does the work (velai.app calls, scoring); this only reads the page
 * and draws the card. Pages that aren't jobs get nothing.
 *
 * On an application form, the card fills it from the person's résumé on
 * their click (form-fill.ts) and never submits it. Once the site then says
 * the application went through, the job goes into their tracker as Applied.
 * "Save" puts the job in the tracker's Saved column without applying. Under
 * the form's free-text questions (form-questions.ts), "Draft an answer" asks
 * for a draft from the résumé lines that bear on that question; it goes in the
 * form only when the person taps "Insert in the form".
 */
import { looksLikeJob, readJobPage, type PageRead } from "./page-reader";
import { isKnownJobSite } from "./job-sites";
import {
    ACCOUNT_CHANGED_KEY,
    HIDDEN_SITES_KEY,
    type AppliedAnswer,
    type CardAnswer,
    type DraftAnswer,
    type FillAnswer,
    type PendingFill,
    type SaveAnswer,
    type ToBackground,
    type TrackAnswer,
} from "./messages";
import { CARD_TERM_LIMIT, type CardSummary } from "./card-summary";
import { fillForm, filledList, findApplicationForm, isConfirmation, setValue } from "./form-fill";
import { findQuestions, type FormQuestion } from "./form-questions";
import { attachedNote } from "./fill-note";

const HOST_ID = "velai-card-host";
/** Client-rendered job pages fill in after load; look once more after this. */
const RETRY_MS = 2_500;
/** Single-page sites (LinkedIn) change the URL without a reload. */
const URL_POLL_MS = 1_000;
/** An application form that draws itself after the card: look for it again at these times. */
const FORM_RETRY_MS = [3_000, 8_000];
/** After a fill, how long the page is watched for the site's "application sent" message. */
const CONFIRM_WATCH_MS = 30 * 60_000;
/** ...and fill in the new job a moment after; reading at once would read the last one. */
const SPA_SETTLE_MS = 1_200;

let checkedUrl = "";
let dismissedUrl = "";
/** What the card last said about the account, to look again when the person comes back to the tab. */
let shownAccount: CardSummary["account"] = null;

function send<T>(message: ToBackground): Promise<T> {
    return chrome.runtime.sendMessage(message) as Promise<T>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
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
.card { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 320px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
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
.fit-source { margin-left: 6px; font-size: 13px; color: rgb(163 163 163); }
.terms { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
.term { padding: 1px 7px; border-radius: 999px; font-size: 13px; border: 1px solid rgb(38 38 38); }
.term-has { color: rgb(47 191 113); } .term-lacks { color: rgb(245 158 11); }
.terms-note { margin: 4px 0 0; font-size: 12px; color: rgb(163 163 163); }
.note { margin: 8px 0 0; font-size: 13px; color: rgb(163 163 163); }
ul { list-style: none; margin: 8px 0 0; padding: 0; }
li { margin-top: 4px; }
li::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 999px; background: rgb(163 163 163); vertical-align: middle; }
li.ok::before { background: rgb(47 191 113); } li.warn::before { background: rgb(245 158 11); } li.bad::before { background: rgb(255 59 105); }
.src { color: rgb(163 163 163); font-size: 13px; }
.actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
button { font: inherit; cursor: pointer; }
button.primary { border: 0; border-radius: 10px; padding: 7px 12px; background: rgb(47 191 113); color: rgb(8 9 12); font-weight: 600; }
button.secondary { border: 1px solid rgb(38 38 38); border-radius: 10px; padding: 6px 12px; background: transparent; color: rgb(245 245 245); }
button.secondary:hover { background: rgb(26 26 26); }
button:disabled { opacity: 0.6; cursor: default; }
button.link { border: 0; background: none; padding: 0; color: rgb(163 163 163); font-size: 13px; text-decoration: underline; }
.done { margin: 0; font-size: 13px; color: rgb(47 191 113); }
.qs { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgb(38 38 38); }
.qs-title { margin: 0; font-weight: 600; }
.q { margin-top: 8px; }
.q-text { margin: 0; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.q .actions { margin-top: 6px; }
.draft-mark { margin: 6px 0 4px; font-size: 12px; font-weight: 600; color: rgb(245 158 11); }
textarea.draft { display: block; width: 100%; min-height: 110px; box-sizing: border-box; resize: vertical; padding: 8px; border-radius: 8px;
  border: 1px solid rgb(64 64 64); background: rgb(10 11 15); color: rgb(245 245 245); font: inherit; font-size: 13px; }
.draft-src { margin: 4px 0 0; font-size: 12px; color: rgb(163 163 163); }
@media (prefers-contrast: more) {
  .card, .term, button.secondary, .qs { border-color: rgb(120 120 120); }
  .draft-src { color: rgb(225 225 225); }
  .close, .fit-source, .terms-note, .note, .src, button.link { color: rgb(225 225 225); }
}
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

/** Why there's no fit label, where no button already says it: signed out and no résumé get "Sign in to see your fit" and "Add your résumé" under the posting's facts instead. */
const ACCOUNT_NOTE: Partial<Record<NonNullable<CardSummary["account"]>, string>> = {
    "no-overlap": "Your résumé and this role don't share enough to score.",
    unavailable: "Velai didn't answer, so your fit isn't shown.",
};

/** A new card on the page: the shell with Velai's mark and a close button; the caller fills it and calls `show`. */
function cardShell(): { card: HTMLElement; show: () => void } {
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
    card.append(head);
    return {
        card,
        show: () => {
            root.append(style, card);
            document.documentElement.append(host);
        },
    };
}

/** The card after the site confirmed an application the card filled. */
function renderApplied(answer: NonNullable<AppliedAnswer>): void {
    const { card, show } = cardShell();
    card.append(el("p", "title", answer.title));
    card.append(answer.ok ? el("p", "done", "Application sent. Added to your Velai tracker as Applied.") : el("p", "note", `Application sent, but it isn't in your tracker yet: ${answer.error}`));
    show();
    shownAccount = null;
}

/** After the site confirms the application the card filled, it goes into the tracker. */
async function confirmApplied(): Promise<boolean> {
    const answer = await send<AppliedAnswer>({ type: "appliedAfterFill" }).catch(() => null);
    if (!answer) return false;
    renderApplied(answer);
    return true;
}

let confirmWatch: MutationObserver | null = null;

/** Watches a form page that confirms in place (no new page) for the site's "application sent" message. */
function watchForConfirmation(): void {
    confirmWatch?.disconnect();
    confirmWatch = null;
    // Text that was there before the fill (an intro that says "thank you for applying") doesn't count.
    if (!document.body || isConfirmation(document.body.innerText)) return;
    const stopAt = Date.now() + CONFIRM_WATCH_MS;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const look = () => {
        pending = null;
        if (Date.now() > stopAt) {
            confirmWatch?.disconnect();
            confirmWatch = null;
        } else if (isConfirmation(document.body.innerText) && !findApplicationForm()) {
            confirmWatch?.disconnect();
            confirmWatch = null;
            void confirmApplied();
        }
    };
    confirmWatch = new MutationObserver(() => {
        pending ??= setTimeout(look, 1_000);
    });
    confirmWatch.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** "Fill from your résumé": the form's fields from the résumé, its upload with the PDF of the résumé with the changes accepted for this job. */
function fillButton(summary: CardSummary, read: PageRead, status: HTMLElement): HTMLButtonElement {
    const label = "Fill from your résumé";
    const fill = button(label, "primary", () => {
        fill.disabled = true;
        fill.textContent = "Filling…";
        status.textContent = "";
        void send<FillAnswer>({ type: "fillData", read })
            .catch((): FillAnswer => ({ ok: false, error: "Velai didn't answer." }))
            .then((answer) => {
                if (!answer?.ok) {
                    fill.disabled = false;
                    fill.textContent = label;
                    status.textContent = answer?.error ?? "The form couldn't be filled.";
                    return;
                }
                const fields = findApplicationForm() ?? [];
                const pdf = answer.pdf ? { bytes: fromBase64(answer.pdf.base64), filename: answer.pdf.filename } : null;
                const filled = fillForm(fields, answer.values, pdf);
                const missedPdf = !pdf && fields.some((f) => f.kind === "resume");
                const done = filled.length
                    ? `Filled ${filledList(filled)}. Check the form, then submit it yourself.${missedPdf ? " Attach your résumé too." : pdf ? attachedNote(answer.tailored) : ""}`
                    : "Nothing to fill: these fields are filled in already, or ask for what your résumé doesn't say.";
                fill.replaceWith(el("p", "done", done));
                if (filled.length && summary.track) {
                    void send({ type: "filled", track: summary.track }).catch(() => {});
                    watchForConfirmation();
                }
            });
    });
    return fill;
}

/** "Registered Nurse · St. Michael's Hospital; Skills": where on the résumé a draft's lines are from, each place once. */
function placesOf(lines: { where: string }[]): string {
    return [...new Set(lines.map((l) => l.where))].join("; ");
}

/** The draft under a question: marked as a draft, editable, naming the résumé lines it comes from. Nothing is in the form until "Insert in the form". */
function draftBlock(question: FormQuestion, answer: Extract<DraftAnswer, { ok: true }>, again: () => void): HTMLElement {
    const block = el("div", "draft-block");
    const box = el("textarea", "draft");
    box.value = answer.text;
    box.setAttribute("aria-label", `Draft answer to: ${question.text}`);
    const status = el("p", "note");
    status.setAttribute("aria-live", "polite");
    const how = answer.by === "sealed" ? "Written by Velai's sealed AI from these lines only." : "These lines as your résumé has them (no AI).";
    const insert = button("Insert in the form", "primary", () => {
        const text = box.value.trim();
        if (!text) return;
        // The person may have typed in the form since; their words stay.
        if (question.el.value.trim()) {
            status.textContent = "That box has text in it now, so Velai left it. Copy the draft instead.";
            return;
        }
        setValue(question.el, text);
        insert.disabled = true;
        status.textContent = "Inserted. Edit it in the form, then submit it yourself.";
    });
    const copy = button("Copy", "secondary", () => {
        const text = box.value;
        const fallback = () => {
            box.select();
            return document.execCommand("copy");
        };
        void navigator.clipboard
            .writeText(text)
            .then(() => true, fallback)
            .then((ok) => {
                status.textContent = ok ? "Copied." : "Select the draft and copy it.";
            });
    });
    const actions = el("div", "actions");
    actions.append(insert, copy, button("Discard", "link", again));
    block.append(
        el("p", "draft-mark", "Draft from your résumé. Check every claim before you use it."),
        box,
        el("p", "draft-src", `From your résumé: ${placesOf(answer.lines)}. ${how}`),
        actions,
        status,
    );
    return block;
}

/** One question of the form: Velai's draft on a tap, or why it leaves the question to the person. */
function questionRow(question: FormQuestion, read: PageRead): HTMLElement {
    const row = el("div", "q");
    const text = el("p", "q-text", question.text);
    text.title = question.text;
    row.append(text);
    if (!question.verdict.draft) {
        row.append(el("p", "note", `Velai leaves this one to you: ${question.verdict.reason}.`));
        return row;
    }
    const label = "Draft an answer";
    const status = el("p", "note");
    status.setAttribute("aria-live", "polite");
    const actions = el("div", "actions");
    const ask = button(label, "secondary", () => {
        ask.disabled = true;
        ask.textContent = "Drafting…";
        status.textContent = "";
        // One request, on this tap: nothing is asked of the AI until then.
        void send<DraftAnswer>({ type: "draftAnswer", read, question: question.text })
            .catch((): DraftAnswer => ({ ok: false, error: "Velai didn't answer." }))
            .then((answer) => {
                ask.disabled = false;
                ask.textContent = label;
                if (!answer?.ok) {
                    status.textContent = answer?.error ?? "Velai couldn't draft this one.";
                    return;
                }
                const block = draftBlock(question, answer, () => {
                    block.replaceWith(actions, status);
                    status.textContent = "";
                });
                actions.replaceWith(block);
                status.remove();
            });
    });
    actions.append(ask);
    row.append(actions, status);
    return row;
}

/** The form's free-text questions, each with a draft on request. */
function questionsSection(questions: FormQuestion[], read: PageRead): HTMLElement {
    const section = el("div", "qs");
    section.append(el("p", "qs-title", "Questions on this form"));
    section.append(el("p", "terms-note", "Drafts come from your résumé when you ask. You choose what goes in the form."));
    for (const question of questions) section.append(questionRow(question, read));
    return section;
}

function render(summary: CardSummary, read: PageRead): void {
    const { card, show } = cardShell();
    card.append(el("p", "title", [summary.title, summary.company].filter(Boolean).join(" · ")));

    if (summary.fit) {
        const fit = el("p", "fit");
        fit.append(el("span", `chip fit-${summary.fit.tone}`, summary.fit.label), el("span", "fit-source", "against your résumé"));
        card.append(fit);
        if (summary.terms) {
            // The words the label counts, as chips: what's on the résumé first, then what isn't.
            const chips = [
                ...summary.terms.matched.map((t) => el("span", "term term-has", `✓ ${t}`)),
                ...summary.terms.missing.map((t) => el("span", "term term-lacks", `✗ ${t}`)),
            ].slice(0, CARD_TERM_LIMIT);
            const row = el("p", "terms");
            row.append(...chips);
            card.append(row, el("p", "terms-note", "Words in the role's title: ✓ on your résumé, ✗ not on it"));
        }
    } else if (summary.account && ACCOUNT_NOTE[summary.account]) {
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
    const form = summary.canFill ? findApplicationForm() : null;
    const fillStatus = el("p", "note");
    fillStatus.setAttribute("aria-live", "polite");
    const openPanel = () => void send({ type: "openPanel", read });
    if (summary.account === "signed-out") {
        actions.append(button("Sign in to see your fit", "primary", () => void send({ type: "signIn" })));
    } else if (summary.account === "no-resume") {
        actions.append(button("Add your résumé to see your fit", "primary", () => void send({ type: "openVelai", path: "/resume" })));
    } else if (form) {
        actions.append(fillButton(summary, read, fillStatus));
    } else {
        const label = summary.fit ? "Your résumé for this job" : "Open in Velai";
        actions.append(button(label, "primary", openPanel));
    }
    const track = summary.track;
    if (track) {
        // Save for later: the tracker's Saved column, without saying the person applied.
        const save = button("Save", "secondary", () => {
            save.disabled = true;
            void send<SaveAnswer>({ type: "save", job: track })
                .catch((): SaveAnswer => ({ ok: false, error: "Velai didn't answer." }))
                .then((answer) => {
                    if (answer?.ok) save.replaceWith(el("p", "done", answer.status === "Saved" ? "Saved to your Velai tracker" : `Already in your Velai tracker as ${answer.status}`));
                    else {
                        save.disabled = false;
                        save.textContent = `${answer?.error ?? "Velai didn't answer."} Try again`;
                    }
                });
        });
        actions.append(save);
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
    if (form) card.append(fillStatus);
    const questions = summary.canFill ? findQuestions() : [];
    if (questions.length) card.append(questionsSection(questions, read));
    const off = button(`Don't show on ${location.hostname}`, "link", () => {
        void chrome.storage.local.get(HIDDEN_SITES_KEY).then((stored) => {
            const hidden = new Set((stored[HIDDEN_SITES_KEY] as string[] | undefined) ?? []);
            hidden.add(location.hostname);
            return chrome.storage.local.set({ [HIDDEN_SITES_KEY]: [...hidden] });
        });
        removeCard();
    });
    const footer = el("div", "actions");
    // On a form, the panel (what was tailored and why) is one tap away instead of the main button.
    if (form) footer.append(button("See your fit and review résumé changes", "link", openPanel));
    footer.append(off);
    card.append(footer);

    show();
    shownAccount = summary.account;
    // A form that draws itself after the card (a site's "Apply" step): offer to fill it once it's there.
    if (summary.canFill && !form) {
        const url = location.href;
        for (const wait of FORM_RETRY_MS) {
            setTimeout(() => {
                if (location.href === url && document.getElementById(HOST_ID) && !formOffered && (findApplicationForm() || findQuestions().length)) render(summary, read);
            }, wait);
        }
    }
    formOffered = Boolean(form) || questions.length > 0;
}

/** Whether the card on the page already offers to fill its form. */
let formOffered = false;

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
    // After the card filled an application in this tab, the site's thank-you page puts the job in the tracker.
    if (!force) {
        const pending = await send<PendingFill | null>({ type: "pendingFill" }).catch(() => null);
        if (pending) {
            for (const wait of [0, RETRY_MS]) {
                if (wait) await sleep(wait);
                if (location.href !== url) return;
                if (document.body && isConfirmation(document.body.innerText) && !findApplicationForm()) {
                    if (await confirmApplied()) return;
                    break;
                }
            }
        }
    }
    let read = readJobPage();
    let form = findApplicationForm();
    // On a site the person turned the card on for (not a built-in job site), Velai only hears about pages that read as a job or hold an application form.
    if (!isKnownJobSite(url) && !looksLikeJob(read) && !form) {
        await sleep(RETRY_MS);
        if (location.href !== url) return;
        read = readJobPage();
        form = findApplicationForm();
        if (!looksLikeJob(read) && !form) {
            removeCard();
            return;
        }
    }
    let summary = await send<CardAnswer>({ type: "card", read, fresh: force, applying: Boolean(form) });
    if (!summary && !read.posting) {
        // A page that fills in its job details, or draws its form, after load.
        await sleep(RETRY_MS);
        if (location.href !== url) return;
        read = readJobPage();
        form = findApplicationForm();
        if (read.posting || form) summary = await send<CardAnswer>({ type: "card", read, applying: Boolean(form) });
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
