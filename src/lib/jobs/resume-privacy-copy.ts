/**
 * User-facing résumé privacy / storage copy shared by app surfaces. The
 * headline promises themselves live in `lib/legal/privacy-promises.ts`; every
 * line here must agree with them and with /privacy#your-resume.
 * Wording matches `/privacy`: the quick read runs in the browser; what it
 * misses can go, without name or contact details, to sealed AI (Tinfoil),
 * encrypted so only that server can read it; job search sends derived
 * role/skill phrases to our search index, not the full file.
 */

/**
 * What a paid month adds: exactly what the server gates (the stored résumé,
 * its read-back, sealed-AI help, the extension's and the MCP résumé tools, the
 * daily-picks email). The one list every "a paid month adds…" line and the
 * pricing card read. Rule-based tailoring and PDF export are free on the
 * device and are not here.
 */
export const PAID_FEATURES = [
    "your résumé saved to your account and read back on any device",
    "sealed-AI help importing it",
    "sealed-AI tailoring for each job",
    "sealed-AI answers to screening questions",
    "your résumé in the Chrome extension",
    "résumé tools for your AI agent",
    "the daily-picks email",
] as const;

/** The list as a sentence: "a, b and c". */
export function paidFeaturesSentence(): string {
    return `${PAID_FEATURES.slice(0, -1).join(", ")} and ${PAID_FEATURES[PAID_FEATURES.length - 1]}`;
}

/** /resume PageHeader — the one primary headline on the signed-out page. */
export const RESUME_PAGE_HEADLINE = "One résumé unlocks your personalized job search.";

/** Signed-out empty state only — supportive h2, not a second page headline. */
export const RESUME_SIGNED_OUT_EMPTY_TITLE = "You're one upload away.";

/** /resume PageHeader description — plain English, no product codenames. */
export const RESUME_PAGE_SUBCOPY =
    `Upload a résumé to find matching roles. It stays in this browser. A paid month adds ${paidFeaturesSentence()}.`;

/** /resume subcopy for a signed-in visitor, who can already export. */
export const RESUME_PAGE_SUBCOPY_SIGNED_IN =
    "The résumé your matches are ranked by. It stays on this device; a paid month saves it to your account, encrypted. Edit it, export a PDF, or replace it with a new file.";

/** /resume local-résumé banner — semibold label (matches prior banner markup). */
export const RESUME_LOCAL_DEVICE_BANNER_LABEL = "Parsed on this device";

/** /resume local-résumé banner — body after em dash in UI. */
export const RESUME_LOCAL_DEVICE_BANNER_BODY =
    "The file is read here and never uploaded. The structured result stays in this browser. Saving it to your account, encrypted, needs a paid month. To find jobs, our servers send role and skill phrases derived from your résumé to our search index, not your full résumé file, and those searches aren't logged.";

/** Full banner text (tests / grep); UI uses label + body spans. */
export const RESUME_LOCAL_DEVICE_BANNER = `${RESUME_LOCAL_DEVICE_BANNER_LABEL}. ${RESUME_LOCAL_DEVICE_BANNER_BODY}`;

/** Importer modal + empty-state upload promise (shared with /jobs front door). */
export const RESUME_UPLOAD_PROMISE =
    "Upload a PDF or Word résumé. We parse it in your browser, show what we accepted, then use derived role and skill phrases to retrieve matching jobs—not your full file. Fit labels are computed after results return.";

/** Passed into ResumeImportModal `storageNote`. */
export const RESUME_IMPORT_STORAGE_NOTE =
    "The parsed résumé stays in this browser.";

const RESUME_IMPORT_ACCOUNT_STORAGE_NOTE =
    "The parsed résumé stays on this device. With a paid month it is saved to your account, encrypted, so it follows you across devices. The file itself is never uploaded.";

/** `storageNote` for a caller whose persistence depends on sign-in: account when signed in, this browser otherwise. */
export function resumeImportStorageNote(signedIn: boolean): string {
    return signedIn ? RESUME_IMPORT_ACCOUNT_STORAGE_NOTE : RESUME_IMPORT_STORAGE_NOTE;
}

/** Résumé import modal — parsing location (interpretation, not job-search retrieval). */
export const RESUME_IMPORT_PARSE_LINE =
    "The quick read runs in this browser, not on our servers.";

/**
 * Résumé import modal, where this server has sealed AI: the plain promise
 * first, the how one tap away (`RESUME_IMPORT_SEALED_DETAIL`). A simulated
 * focus group (2026-10-12) found "Tinfoil's sealed AI server" lost people who
 * aren't technical, while the technical ones still wanted it.
 */
export const RESUME_IMPORT_SEALED_LINE = "Your name and contact details are taken out before any AI reads it.";

/** The how behind `RESUME_IMPORT_SEALED_LINE`: `withoutContactDetails` + `sealedChat` (parse-resume.ts). */
export const RESUME_IMPORT_SEALED_DETAIL =
    "If the quick read misses something, the text without your name or contact details goes to Tinfoil's sealed AI server, encrypted so only that server can read it. Velai can't read it on the way.";

/** /jobs front-door résumé band (signed-out or no résumé on file). */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY =
    "Upload a résumé to see your top 3 matches and why. It stays in this browser.";

/** The same band for a signed-in account with no résumé: the upload is saved to the account (see `resumeImportStorageNote`). */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN =
    "Upload your résumé to rank these jobs by fit. It stays on this device; a paid month saves it to your account, encrypted.";

/** Packs home, once a résumé has loaded (Today header, and the welcome panel before it): results are ranked in this browser (see `RESUME_UPLOAD_PROMISE`). */
export const PRIVATE_MATCHING_ACTIVE = "Private matching active on this device";

/** Customize dialog badge when sealed AI rewrites the lines: plain first, the how one tap away (`CUSTOMIZE_SEALED_DETAIL`). */
export const CUSTOMIZE_SEALED_BADGE =
    "AI sees only the parts of your résumé that match this job, never your name or contact details.";

/** The how behind `CUSTOMIZE_SEALED_BADGE` (tailor-with-engine.ts sends the matched lines through `sealedChat`). */
export const CUSTOMIZE_SEALED_DETAIL =
    "They're rewritten on Tinfoil's sealed AI server, encrypted so only that server can read them. Velai can't read them on the way.";

/** Customize dialog badge when this server has no sealed AI: the rules draft. */
export const CUSTOMIZE_RULES_BADGE = "Tailored in your browser by rules.";

/** Connect FAQ — no MCP required. */
export const CONNECT_FAQ_NO_MCP_NEEDED =
    "No. You can search jobs, see fit bands, and use the tracker in the browser without pairing an AI assistant. Connect is optional for people who use MCP-compatible assistants.";

/** Connect, "Permissions and privacy": where the résumé an assistant reads lives, and where it goes. */
export const CONNECT_PRIVACY_LINE =
    "Velai keeps your résumé encrypted, and the tools your assistant calls run without any AI on our servers. What your assistant reads goes to its own AI provider, under that provider's terms.";

/** Settings, under a saved résumé: how it is kept and who can load it (/privacy#your-resume). */
export const SETTINGS_RESUME_PRIVACY_LINE =
    "It stays on this device. With a paid month it is also saved to your account, encrypted with AES-256, and only you, and an assistant or the Velai extension you connect, can load it. Delete removes it and its saved versions.";
