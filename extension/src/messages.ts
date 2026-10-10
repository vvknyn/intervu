import type { CardSummary, TrackJob } from "./card-summary";
import type { PageRead } from "./page-reader";

/** Messages to the service worker from the on-page card and the side panel. */
export type ToBackground =
    /** The card on a page asks what to show for the job it read; answered with a CardSummary, or null for no card.
     *  `fresh` skips the remembered account answer (the person may have just signed in elsewhere). */
    | { type: "card"; read: PageRead; fresh?: boolean }
    /** The card's button: open the side panel on this page's job. */
    | { type: "openPanel"; read: PageRead }
    /** Sign in to velai.app in a small window; the window closes itself once signed in. */
    | { type: "signIn" }
    /** Open a velai.app page (the résumé editor) in a small window; closing it re-checks the job. */
    | { type: "openVelai"; path: string }
    /** The card's "I applied": add the job to the person's Velai tracker. Answered with a TrackAnswer. */
    | { type: "track"; job: TrackJob }
    /** The panel turned the card on for a site; inject it into that tab now. */
    | { type: "siteEnabled"; tabId: number };

export type CardAnswer = CardSummary | null;
export type TrackAnswer = { ok: true } | { ok: false; error: string };

/** chrome.storage.local key bumped whenever the person may have signed in or changed their résumé, so the card and panel re-check. */
export const ACCOUNT_CHANGED_KEY = "velaiAccountChangedAt";

/** chrome.storage.local key: hostnames where the person turned the card off. */
export const HIDDEN_SITES_KEY = "velaiCardHiddenSites";
