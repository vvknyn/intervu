import {
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN,
    RESUME_UPLOAD_PROMISE,
} from "@/lib/jobs/resume-privacy-copy";

export { FRONT_DOOR_RESUME_CARD_SUBCOPY, FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN, RESUME_UPLOAD_PROMISE };

/**
 * Shared résumé-upload CTA copy — the /jobs front door, /resume empty state,
 * For you deck, and job-detail customize entry points.
 */

export const RESUME_UPLOAD_SIGNIN_LINE =
    "Sign in to see every match. Saving your résumé to your account is a paid month.";

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

/** For you deck download CTA. */
export const FOR_YOU_DOWNLOAD_LABEL = "Download tailored PDF & open application";

/** For you deck empty-state upload prompt. */
export const FOR_YOU_UPLOAD_PDF_EMPTY = "Upload résumé to create a tailored PDF.";

/** Customize panel header when a résumé is present. */
export const CUSTOMIZE_READY_HEADER = "Your résumé is ready. Customize for this role.";

/** Signed-out sync line inside customize panel. */
export const SIGN_IN_TO_SYNC_LABEL = "Sign in to save this version. Saving needs a paid month.";

/** Job detail action when no résumé yet. A button label, so no full stop. */
export const UPLOAD_TO_CUSTOMIZE_LABEL = "Upload résumé to customize";
