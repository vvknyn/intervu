/**
 * The two velai.app calls the extension makes, with the person's own
 * velai.app session cookie (the host permission lets it through). Used by
 * the side panel and by the service worker for the on-page card.
 */
import type { JobSearchResult } from "@/lib/jobs/types";
import type { MeResponse } from "./report";
import { VELAI_ORIGIN } from "./rows";

const REQUEST_TIMEOUT_MS = 10_000;

export async function velai<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${VELAI_ORIGIN}${path}`, { ...init, credentials: "include", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The public search the site's jobs list uses. `automatic` marks the on-page
 * card's own lookup when a job page loads, which isn't a search the person
 * made, so velai.app doesn't log it as one.
 */
export function searchVelai(q: string, limit: number, automatic = false): Promise<JobSearchResult> {
    return velai<JobSearchResult>("/api/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q, hideGhosts: false, limit, ...(automatic ? { automatic: true } : {}) }),
    });
}

/** The signed-in person's saved résumé and preferences, or `{ signedIn: false }`. */
export function fetchMe(): Promise<MeResponse> {
    return velai<MeResponse>("/api/extension/me");
}

/** Adds the job to the person's Velai tracker as Applied (the site's own "I applied"). */
export function trackApplied(job: { title: string; company: string; applyUrl: string; jobId?: string }): Promise<{ ok: boolean; id?: string }> {
    return velai<{ ok: boolean; id?: string }>("/api/extension/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
    });
}

/** Where the sign-in window starts: velai.app's own sign-in, landing on the tracker. */
export const SIGN_IN_PATH = "/login?next=%2Fyours";

/** velai.app pages that are part of signing in, not past it. */
const AUTH_PATH = /^\/(login|auth|oauth|reset-password)(\/|$)/;

/** Pure: whether a sign-in window has left the sign-in pages for velai.app proper,
 *  which is the moment to ask velai.app whether the person is now signed in. */
export function isSignedInLanding(url: string): boolean {
    try {
        const u = new URL(url);
        return u.origin === VELAI_ORIGIN && !AUTH_PATH.test(u.pathname);
    } catch {
        return false;
    }
}
