import { RESUME_UPLOAD_AUTH_CTA, RESUME_UPLOAD_CTA } from "@/lib/auth/auth-gate-copy";

/**
 * Shared résumé-upload CTA copy — the /jobs front door, /resume empty state,
 * For you deck, and job-detail customize entry points.
 */

/** Upload button label — auth-first vs importer-first entry points. */
export function resumeUploadCtaLabel(next: "auth" | "importer"): string {
    return next === "auth" ? RESUME_UPLOAD_AUTH_CTA : RESUME_UPLOAD_CTA;
}

/** Beside the importer control — not the front-door card subcopy. */
export const RESUME_UPLOAD_PROMISE =
    "Upload a PDF or Word résumé. We parse it privately, then show what was accepted before scoring jobs.";

export const RESUME_UPLOAD_SIGNIN_LINE =
    "Sign in to sync your résumé and tracker across devices.";

/** Jobs tabs helper — directly under ForYouToggle when Search is active. */
export const JOBS_TAB_HELPER =
    "Search is open. Add a résumé to unlock fit bands and tailored applications.";

/** Under For you / Search tabs. Null = render nothing.
 *  Confirmed résumé, or presence not yet known, must not ask to add one. */
export function jobsTabHelperCopy(resumeOnFile: boolean | null): string | null {
    if (resumeOnFile !== false) return null;
    return JOBS_TAB_HELPER;
}

/** Rank-by-fit secondary line (orientation card + sort menu). */
export const RANK_SECONDARY_COPY =
    "See Strong, Good, and Stretch matches—with the reasons.";

/** Post-signup résumé gate modal title — distinct from rank-by-fit entry. */
export const POST_SIGNUP_RESUME_GATE_TITLE = "Upload your résumé";

/** Front-door résumé band card subcopy (not the upload promise). */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY =
    "Create a free account, upload one résumé, and unlock For you, fit bands, Customize, and tailored PDFs.";

/** For you deck download CTA. */
export const FOR_YOU_DOWNLOAD_LABEL = "Download tailored PDF & open application";

/** For you deck empty-state upload prompt. */
export const FOR_YOU_UPLOAD_PDF_EMPTY = "Upload résumé to create a tailored PDF.";

/** Customize panel header when a résumé is present. */
export const CUSTOMIZE_READY_HEADER = "Your résumé is ready. Customize for this role.";

/** Signed-out sync line inside customize panel. */
export const SIGN_IN_TO_SYNC_LABEL = "Sign in to sync this version.";

/** Job detail action when no résumé yet. */
export const UPLOAD_TO_CUSTOMIZE_LABEL = "Upload résumé to customize.";
