/**
 * User-facing résumé privacy / storage copy shared by signed-out app surfaces.
 * Wording matches `/privacy`: the quick read runs in the browser; what it
 * misses can go, without name or contact details, to sealed AI (Tinfoil),
 * encrypted so only that server can read it; job search sends derived
 * role/skill phrases to our search index, not the full file.
 */

/** /resume PageHeader — the one primary headline on the signed-out page. */
export const RESUME_PAGE_HEADLINE = "One résumé unlocks your personalized job search.";

/** Signed-out empty state only — supportive h2, not a second page headline. */
export const RESUME_SIGNED_OUT_EMPTY_TITLE = "You're one upload away.";

/** /resume PageHeader description — plain English, no product codenames. */
export const RESUME_PAGE_SUBCOPY =
    "Upload a résumé to find matching roles, tailor applications for each job, and export PDFs once you sign in.";

/** /resume subcopy for a signed-in visitor, who can already export. */
export const RESUME_PAGE_SUBCOPY_SIGNED_IN =
    "The résumé your matches are ranked by. Edit it, export a PDF, or replace it with a new file.";

/** /resume local-résumé banner — semibold label (matches prior banner markup). */
export const RESUME_LOCAL_DEVICE_BANNER_LABEL = "Parsed on this device";

/** /resume local-résumé banner — body after em dash in UI. */
export const RESUME_LOCAL_DEVICE_BANNER_BODY =
    "The file and structured result stay in this browser until you create an account and sync. When you search jobs, our servers may send role and skill phrases derived from your résumé to our search index—not your full résumé file.";

/** Full banner text (tests / grep); UI uses label + body spans. */
export const RESUME_LOCAL_DEVICE_BANNER = `${RESUME_LOCAL_DEVICE_BANNER_LABEL}. ${RESUME_LOCAL_DEVICE_BANNER_BODY}`;

/** Importer modal + empty-state upload promise (shared with /jobs front door). */
export const RESUME_UPLOAD_PROMISE =
    "Upload a PDF or Word résumé. We parse it in your browser, show what we accepted, then use derived role and skill phrases to retrieve matching jobs—not your full file. Fit labels are computed after results return.";

/** Passed into ResumeImportModal `storageNote`. */
export const RESUME_IMPORT_STORAGE_NOTE =
    "The parsed résumé stays in this browser until you sign in and sync.";

const RESUME_IMPORT_ACCOUNT_STORAGE_NOTE =
    "Your résumé and the parsed result are then saved to your account so they follow you across devices.";

/** `storageNote` for a caller whose persistence depends on sign-in: account when signed in, this browser otherwise. */
export function resumeImportStorageNote(signedIn: boolean): string {
    return signedIn ? RESUME_IMPORT_ACCOUNT_STORAGE_NOTE : RESUME_IMPORT_STORAGE_NOTE;
}

/** Résumé import modal — parsing location (interpretation, not job-search retrieval). */
export const RESUME_IMPORT_PARSE_LINE =
    "The quick read runs in this browser, not on our servers.";

/** Résumé import modal, where this server has sealed AI: what it reads, and how. */
export const RESUME_IMPORT_SEALED_LINE =
    "If it misses something, the text without your name or contact details goes to Tinfoil's sealed AI server, encrypted so only that server can read it.";

/** Auth popover body when unlocking résumé-backed features (fit/resume gates). */
export const AUTH_GATE_RESUME_UNLOCK_BODY =
    "We'll return you here with personalized job picks, Strong/Good/Stretch fit bands, customize tools, and tailored PDFs.";

/** /jobs front-door résumé band (signed-out or no résumé on file). */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY =
    "Upload one résumé to see your top 3 matches and why. It stays in this browser; a free account unlocks every match, customize, and tailored PDFs.";

/** The same band for a signed-in account with no résumé: the upload is saved to the account (see `resumeImportStorageNote`). */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN =
    "Upload your résumé to rank these jobs by fit, with the reasons. It is saved to your account, so it follows you across devices.";

/** Landing onboarding — device-only storage choice helper. */
export const LANDING_DEVICE_STORAGE_NOTE =
    "Parsed résumé stays in this browser until you sign in. Job search sends derived phrases to our servers, not your full file.";

/** Landing onboarding — privacy footnote after profile edit. */
export const LANDING_PROFILE_PRIVACY_NOTE =
    "Parsing starts on this device. Matching uses derived role and skill phrases on our servers—see our privacy policy for details.";

/** Landing onboarding — pre-upload privacy footnote. */
export const LANDING_UPLOAD_PRIVACY_NOTE =
    "Résumé parsing runs in this browser tab. What it misses can be read by a sealed AI server, without your name or contact details, encrypted so only that server can read it. Job search may use derived phrases from your résumé on our servers.";

/** First-time onboarding modal — matching step. */
export const ONBOARDING_MATCHING_PRIVACY =
    "Résumé parsing starts on your device. To find roles, we send derived titles and skills to our search service—not your full résumé file.";

/** First-time onboarding modal — upload step banner strong label. */
export const ONBOARDING_UPLOAD_PRIVACY_LABEL = "Parsed on this device:";

/** First-time onboarding modal — upload step banner body after `<strong>`. */
export const ONBOARDING_UPLOAD_PRIVACY_BODY =
    "Your résumé file is read here. What the quick read misses can go to a sealed AI server, without your name or contact details, encrypted so only that server can read it. Sign in to store a copy in your account.";

/** Packs home, once a résumé has loaded (Today header, and the welcome panel before it): results are ranked in this browser (see `RESUME_UPLOAD_PROMISE`). */
export const PRIVATE_MATCHING_ACTIVE = "Private matching active on this device";

/** Customize dialog badge when sealed AI (Tinfoil) rewrites the lines. */
export const CUSTOMIZE_SEALED_BADGE =
    "Rewritten on Tinfoil's sealed AI server: only the matched lines are sent, encrypted so only that server can read them.";

/** Customize dialog badge when this server has no sealed AI: the rules draft. */
export const CUSTOMIZE_RULES_BADGE = "Tailored in your browser by rules.";

/** Connect FAQ — no MCP required. */
export const CONNECT_FAQ_NO_MCP_NEEDED =
    "No. You can search jobs, see fit bands, and use the tracker in the browser without pairing an AI assistant. Connect is optional for people who use MCP-compatible assistants.";
