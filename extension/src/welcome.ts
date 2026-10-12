/**
 * The page a first install opens. It signs the person in to velai.app in a
 * small window right here, so the first job page they open already shows
 * their fit, instead of sending them off to velai.app and back.
 */
import { fetchMe } from "./velai-api";
import { resumeFromMe, type MeResponse } from "./report";
import { ACCOUNT_CHANGED_KEY, type ToBackground } from "./messages";

const account = document.getElementById("account") as HTMLElement;

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
    if (!me) {
        account.replaceChildren(
            el("p", "notice", "Velai didn't answer just now. You can still sign in."),
            actions(button("Sign in to Velai", "primary", { type: "signIn" })),
        );
    } else if (!me.signedIn) {
        account.replaceChildren(
            el("h2", "card-title", "See how each job fits you"),
            el("p", "lede", "Sign in and each job page shows how the role fits the résumé on your Velai account."),
            actions(button("Sign in to Velai", "primary", { type: "signIn" })),
            el("p", "hint", "Opens a small window, where you can also create an account. It closes on its own when you're done."),
        );
    } else if (!resumeFromMe(me)) {
        account.replaceChildren(
            el("p", "lede", "You're signed in. Add your résumé on Velai and every job page shows how it fits you."),
            actions(button("Add your résumé", "primary", { type: "openVelai", path: "/resume" })),
        );
    } else {
        account.replaceChildren(
            el("p", "lede", "You're signed in, and Velai has your résumé. Open any job page to see how it fits you."),
        );
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ACCOUNT_CHANGED_KEY]) void render();
});
void render();
