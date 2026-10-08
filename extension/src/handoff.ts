import type { PageRead } from "./page-reader";

/** What the service worker hands the side panel through session storage. */
export type HandOff =
    /** The toolbar button on a page: the job as read off that page. */
    | { kind: "page"; read: PageRead; site: string | null; at: number }
    /** Selected text: a plain Velai search. */
    | { kind: "search"; q: string; site: string | null; at: number };
