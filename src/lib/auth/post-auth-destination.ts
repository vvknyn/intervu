/**
 * Post-auth landing paths. Sign-in and sign-up both return to the page the
 * person was on, so what they signed in for is there when they land: the
 * company page, the job, the full search, the queued Apply. Bare /jobs stays
 * /jobs, where a new account's setup is the page itself (components/onboarding/).
 *
 * Sign-up used to land every résumé-less account on the résumé importer
 * (`/jobs?resume=gate`) instead. Both new accounts in a month that got it
 * closed it, and one lost the company page they signed up on (onboarding map,
 * 2026-10-05), so nothing routes a sign-in there any more.
 */

import type { AuthGateReason } from "@/lib/auth/auth-gate-copy";
import type { ResumeFunnelReason } from "@/lib/analytics/resume-funnel";

/**
 * `/jobs?resume=gate` opens the résumé importer for a signed-in account with
 * no résumé: setup's "Add your résumé" from another page. The value stays
 * "gate" so a sign-up already in flight when this shipped still opens it.
 * `resume=setup` is the same link, counted as setup in the résumé funnel.
 */
export const RESUME_IMPORTER_PARAM = "resume";
export const RESUME_IMPORTER_VALUES = ["gate", "setup"] as const;
export type ResumeImporterValue = (typeof RESUME_IMPORTER_VALUES)[number];

export function resumeImporterHref(value: ResumeImporterValue = "setup"): string {
    return `/jobs?${RESUME_IMPORTER_PARAM}=${value}`;
}

/** Which importer link `path` is, if any. */
export function resumeImporterValue(path: string): ResumeImporterValue | null {
    try {
        const url = new URL(path, "http://localhost");
        const value = url.searchParams.get(RESUME_IMPORTER_PARAM);
        return url.pathname === "/jobs" && (RESUME_IMPORTER_VALUES as readonly string[]).includes(value ?? "")
            ? (value as ResumeImporterValue)
            : null;
    } catch {
        return null;
    }
}

/** True when `next` is the anonymous browse default, not a deliberate return target. */
export function isBareJobsDefault(next: string | null | undefined): boolean {
    if (!next) return true;
    const trimmed = next.trim();
    if (trimmed === "/jobs" || trimmed === "/jobs/") return true;
    return resumeImporterValue(trimmed) !== null;
}

const AUTH_TO_FUNNEL: Partial<Record<AuthGateReason, ResumeFunnelReason>> = {
    fit: "fit",
    resume: "resume",
    tailor: "tailor",
    apply: "tracker",
    tracker: "tracker",
};

/** Map gate continuity to résumé funnel `reason` for resume_gate_shown. */
export function authGateReasonToFunnelReason(reason?: AuthGateReason | null): ResumeFunnelReason {
    if (!reason) return "fit";
    return AUTH_TO_FUNNEL[reason] ?? "fit";
}

/**
 * Where a sign-in or sign-up lands: the page it started from. An old importer
 * link (`/jobs?resume=gate`, still in the odd bookmark or in-flight sign-up)
 * lands on /jobs itself, so a new account meets setup there rather than a
 * dialog over it.
 */
export function resolvePostAuthDestination(validatedNext: string | null): string {
    if (!validatedNext || isBareJobsDefault(validatedNext)) return "/jobs";
    return validatedNext;
}

/**
 * AuthKit's `returnTo` for a sign-in or sign-up: the same page, by the same
 * rule as `resolvePostAuthDestination`. Null when there is nothing to return to.
 */
export function resolveAuthKitReturnTo(rawNext: string | null | undefined): string | null {
    const next = rawNext?.trim() ? rawNext.trim() : null;
    return next ? resolvePostAuthDestination(next) : null;
}

/** A same-site path. A bare query string (`?q=…`) is not one: `next` would land off `/jobs`. */
export type SitePath = `/${string}`;

/**
 * Hrefs for the two doors a signed-out gate offers — real links, so the gate
 * needs no client state. Both carry the page the visitor was on, and both
 * come back to it.
 */
export function signupGateHrefs(returnTo: SitePath): { create: string; signIn: string } {
    const next = encodeURIComponent(returnTo);
    return { create: `/auth/start?mode=signup&next=${next}`, signIn: `/login?next=${next}` };
}
