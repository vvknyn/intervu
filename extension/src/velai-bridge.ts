/**
 * Content script on velai.app pages only. Hands the résumé velai.app keeps in
 * this browser (device-resume.ts) to the service worker whenever it changes,
 * so the card and the panel can score jobs against it without an account.
 * It reads that one localStorage key, sends it only to this extension, and
 * never writes to the page.
 */
// The site's own key (device-resume.ts SITE_RESUME_KEY), imported from the site's small module so this script stays small.
import { LOCAL_AI_RESUME_KEY as SITE_RESUME_KEY } from "@/lib/local-ai/resume-storage";
import type { ToBackground } from "./messages";

/** How often a visible velai.app page is looked at again: the site writes the key in the same tab, which fires no storage event there. */
const LOOK_MS = 1_500;

let last: string | null | undefined;

function look(): void {
    if (!chrome.runtime?.id) return;
    let raw: string | null;
    try {
        raw = localStorage.getItem(SITE_RESUME_KEY);
    } catch {
        return;
    }
    if (raw === last) return;
    last = raw;
    const message: ToBackground = { type: "deviceResume", raw };
    void chrome.runtime.sendMessage(message).catch(() => {
        // The worker didn't take it; try again on the next look.
        last = undefined;
    });
}

look();
addEventListener("storage", (event) => {
    if (event.key === SITE_RESUME_KEY || event.key === null) look();
});
addEventListener("pagehide", look);
const timer = setInterval(() => {
    // The extension was updated or removed: this copy of the script has nothing left to talk to.
    if (!chrome.runtime?.id) clearInterval(timer);
    else if (document.visibilityState === "visible") look();
}, LOOK_MS);
