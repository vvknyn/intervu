/**
 * Shared résumé-upload CTA copy — the /jobs front door's at-rest band and
 * /resume's signed-out empty state both invite the same action and must say
 * the exact same thing about what it does, or the two surfaces drift.
 *
 * `RESUME_UPLOAD_PROMISE` makes NO on-device, privacy, or AI claim. The
 * default upload path is server-side: `ResumeImportModal.tsx` imports
 * `parseResumeWithAI`/`extractPDFText`/`extractDocxText` from
 * `@/actions/resume` (server actions) and only switches to local,
 * in-browser extraction when `readLocalAiEnabled()` is true — a default-OFF
 * flag (`src/lib/local-ai/flag.ts`). A "parsed locally, never touches the
 * cloud" claim next to the upload button would therefore be false for the
 * common case; this line states only what's true unconditionally.
 */
export const RESUME_UPLOAD_PROMISE = "Upload a PDF or Word document.";

/** Sign-in value line paired with the promise above on the /jobs front-door
 *  band. Not currently duplicated on /resume (that page's own sign-in button
 *  sits in a full page of context that already explains itself), but kept
 *  here rather than inline so a future second surface reuses it instead of
 *  drifting. */
export const RESUME_UPLOAD_SIGNIN_LINE =
    "Sign in to upload. You also get job alerts, saved searches, and an application tracker on any device.";
