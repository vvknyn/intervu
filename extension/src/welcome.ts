/**
 * The page a first install opens. It adds the person's résumé on velai.app
 * (free, kept in this browser) or signs them in, in a small window right
 * here, so the first job page they open already shows their fit, instead of
 * sending them off to velai.app and back.
 */
import { fetchMe } from "./velai-api";
import type { MeResponse } from "./report";
import { readDeviceResume, resumeInUse } from "./device-resume";
import { ACCOUNT_CHANGED_KEY, type ToBackground } from "./messages";
import { ALL_SITES } from "./job-sites";

const account = document.getElementById("account") as HTMLElement;
const everywhere = document.getElementById("everywhere") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function button(text: string, className: string, message: ToBackground): HTMLButtonElement {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", () => void chrome.runtime.sendMessage(message));
    return b;
}

function actions(...children: Node[]): HTMLElement {
    const row = el("div", "actions");
    row.append(...children);
    return row;
}

async function render(): Promise<void> {
    let me: MeResponse | null = null;
    try {
        me = await fetchMe();
    } catch {
        me = null;
    }
    const inUse = resumeInUse(me, await readDeviceResume());
    const add = button("Add your résumé", "primary", { type: "openVelai", path: "/resume" });
    if (inUse) {
        account.replaceChildren(
            el(
                "p",
                "lede",
                inUse.from === "account"
                    ? "You're signed in, and Velai has your résumé. Open any job page to see how it fits you."
                    : "Velai has your résumé in this browser. Open any job page to see how it fits you.",
            ),
        );
    } else if (me?.signedIn) {
        account.replaceChildren(
            el("p", "lede", "You're signed in. Add your résumé on Velai and every job page shows how it fits you."),
            actions(add),
            ...(me.paid ? [] : [el("p", "hint", "Free: velai.app reads it in this browser and keeps it here.")]),
        );
    } else {
        account.replaceChildren(
            el("h2", "card-title", "See how each job fits you"),
            el("p", "lede", "Add your résumé on Velai and each job page shows how the role fits it. Free, and no account needed: velai.app reads it in this browser and keeps it here."),
            actions(add, button("Sign in to Velai", "secondary", { type: "signIn" })),
            el(
                "p",
                "hint",
                me
                    ? "Both open a small window that closes on its own when you're done. Sign in if your résumé is on your Velai account."
                    : "Velai didn't answer just now. You can still add your résumé or sign in.",
            ),
        );
    }
}

/** The card on company careers sites too, not only the job sites it knows: one permission, asked once. */
async function renderEverywhere(): Promise<void> {
    const on = await chrome.permissions.contains({ origins: [ALL_SITES] });
    if (on) {
        everywhere.replaceChildren(el("h2", "card-title", "On every careers site"), el("p", "lede", "The card shows on job pages on any site, including company careers sites."));
        return;
    }
    const turnOn = el("button", "secondary", "Show the card on every careers site");
    turnOn.type = "button";
    // Straight from the click, so Chrome asks.
    turnOn.addEventListener("click", () => void chrome.permissions.request({ origins: [ALL_SITES] }).then(() => renderEverywhere()));
    everywhere.replaceChildren(
        el("h2", "card-title", "On every careers site"),
        el("p", "lede", "The card already shows on the main job boards. Turn it on for company careers sites too."),
        actions(turnOn),
        el("p", "hint", "Chrome asks once. On each page the card only checks whether it's a job, and Velai hears nothing about pages that aren't."),
    );
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ACCOUNT_CHANGED_KEY]) void render();
});
void render();
void renderEverywhere();
