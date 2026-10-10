import type { PageRead } from "./page-reader";

/** What the service worker hands the side panel through session storage. */
export type HandOff =
    /** The toolbar button or the on-page card: the job as read off that tab. */
    | { kind: "page"; read: PageRead; site: string | null; at: number; tabId?: number }
    /** Selected text: a plain Velai search. */
    | { kind: "search"; q: string; site: string | null; at: number };
