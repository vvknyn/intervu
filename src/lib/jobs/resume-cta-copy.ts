/**
 * Shared résumé-upload CTA copy — the /jobs front door's at-rest band and
 * /resume's signed-out empty state both invite the same action and must say
 * the exact same thing about what it does, or the two surfaces drift.
 *
 * `RESUME_UPLOAD_PROMISE` makes NO on-device, privacy, or AI claim, even
 * though the upload path (`ResumeImportModal.tsx`) now always parses
 * on-device (founder rule: résumé interpretation never happens on our
 * servers). Kept conservative here because this copy is unconditional CTA
 * copy shared across surfaces, not a decision about what to say about
 * privacy — that's ResumeImportModal's own consent-block copy to own.
 */
export const RESUME_UPLOAD_PROMISE = "Upload a PDF or Word document.";

/** Sign-in value line paired with the promise above on the /jobs front-door
 *  band. Not currently duplicated on /resume (that page's own sign-in button
 *  sits in a full page of context that already explains itself), but kept
 *  here rather than inline so a future second surface reuses it instead of
 *  drifting. */
export const RESUME_UPLOAD_SIGNIN_LINE =
    "Sign in to upload. You also get job alerts, saved searches, and an application tracker on any device.";
