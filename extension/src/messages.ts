import type { CardSummary, TrackJob } from "./card-summary";
import type { FieldKind } from "./form-fill";
import type { PageRead } from "./page-reader";

/** Messages to the service worker from the on-page card and the side panel. */
export type ToBackground =
    /** The card on a page asks what to show for the job it read; answered with a CardSummary, or null for no card.
     *  `fresh` skips the remembered account answer (the person may have just signed in elsewhere).
     *  `applying`: the page has an application form, so it gets a card even when it isn't the job page itself. */
    | { type: "card"; read: PageRead; fresh?: boolean; applying?: boolean }
    /** The card's button: open the side panel on this page's job. */
    | { type: "openPanel"; read: PageRead }
    /** Sign in to velai.app in a small window; the window closes itself once signed in. */
    | { type: "signIn" }
    /** Open a velai.app page (the résumé editor) in a small window; closing it re-checks the job. */
    | { type: "openVelai"; path: string }
    /** The card's "I applied": add the job to the person's Velai tracker. Answered with a TrackAnswer. */
    | { type: "track"; job: TrackJob }
    /** The panel turned the card on for a site; inject it into that tab now. */
    | { type: "siteEnabled"; tabId: number }
    /** The card's "Fill from your résumé": the résumé's contact details and the PDF tailored to this tab's job. Answered with a FillAnswer. */
    | { type: "fillData"; read: PageRead }
    /** The card filled this tab's application form for this job; track it once the site confirms. */
    | { type: "filled"; track: TrackJob | null }
    /** Whether this tab has a filled application waiting for the site to confirm it. Answered with a PendingFill or null. */
    | { type: "pendingFill" }
    /** The site confirmed the application the card filled: add it to the tracker as Applied. Answered with an AppliedAnswer. */
    | { type: "appliedAfterFill" };

export type CardAnswer = CardSummary | null;
export type TrackAnswer = { ok: true } | { ok: false; error: string };
export type FillAnswer =
    | { ok: true; values: Partial<Record<FieldKind, string>>; pdf: { base64: string; filename: string } | null }
    | { ok: false; error: string };
export interface PendingFill {
    title: string;
}
export type AppliedAnswer = (TrackAnswer & { title: string }) | null;

/** chrome.storage.local key bumped whenever the person may have signed in or changed their résumé, so the card and panel re-check. */
export const ACCOUNT_CHANGED_KEY = "velaiAccountChangedAt";

/** chrome.storage.local key: hostnames where the person turned the card off. */
export const HIDDEN_SITES_KEY = "velaiCardHiddenSites";
