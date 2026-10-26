import { PRO_MONTHLY_PRICE } from "@/app/pricing/offer";

/**
 * Velai's privacy copy: two modes, Local (free) and Private cloud (paid). The
 * one module every surface that talks about privacy imports: /pricing, /privacy,
 * the /jobs masthead, Settings, the upload dialogs, /connect, the FAQ.
 * tests/unit/privacy-modes.test.ts fails if a surface carries its own wording.
 *
 * Each line is true of the code it names:
 * - Local: the file is parsed in the browser (`lib/local-ai/parse-resume.ts`,
 *   `extract-in-browser.ts`) and kept in localStorage (`resume-storage.ts`);
 *   search sends derived terms only (`lib/jobs/search-payload.ts`); résumé-built
 *   searches are not logged (`shouldLogSearch`) and analytics carry no match data.
 * - Private cloud: the résumé is sealed AES-256-GCM before it is stored
 *   (`lib/db/docstore/seal.ts`); AI runs on Tinfoil hardware the `tinfoil` SDK
 *   attests before anything is sent (`lib/sealed-ai/client.ts`); our server reads
 *   the saved résumé for tailoring, daily picks, the MCP tools and the extension.
 */

export type PrivacyModeId = "local" | "cloud";

export interface PrivacyMode {
    id: PrivacyModeId;
    name: string;
    price: string;
    /** Numbered in the spec; every surface quotes these, none rewords them. */
    points: readonly string[];
}

// TODO(#1119): replace with `import { DELETED_WHEN } from "@/lib/retention/rules"` once that PR merges.
const DELETED_WHEN = "within an hour after your paid time ends";

export const PRIVACY_MODES: Readonly<Record<PrivacyModeId, PrivacyMode>> = {
    local: {
        id: "local",
        name: "Local",
        price: "Free",
        points: [
            "Your résumé is read in your browser and stays on this device. The file is never uploaded.",
            "To find jobs we send the search only: job titles or top skills, country and seniority.",
            "Searches built from your résumé aren't logged, and analytics never include your résumé or how you match a job.",
        ],
    },
    cloud: {
        id: "cloud",
        name: "Private cloud",
        price: `${PRO_MONTHLY_PRICE} per 30 days`,
        points: [
            "Your résumé is saved to your account, encrypted with AES-256 before it's stored.",
            "AI tailoring runs on Tinfoil's sealed hardware. The connection checks that hardware before anything is sent, and neither we nor Tinfoil can read what it processes.",
            "Our server unlocks your saved résumé only to run what you ask for: tailoring, daily picks, and an assistant or extension you connect.",
            `Deleted ${DELETED_WHEN}. Never sold, never used to train AI.`,
        ],
    },
};

const { local, cloud } = PRIVACY_MODES;

export const PRIVACY_SUMMARY =
    "Free keeps your résumé on this device. Paid saves it encrypted to your account and runs AI on sealed hardware that neither we nor the AI host can read.";

/** The /privacy section that holds everything about a résumé. */
export const PRIVACY_RESUME_SECTION_ID = "your-resume";
export const PRIVACY_LINK_LABEL = "How Velai keeps it private";

/**
 * What Private cloud adds: exactly what the server gates (the stored résumé,
 * its read-back, AI help, the extension's and the MCP résumé tools, the
 * daily-picks email). Rule-based tailoring and PDF export are free on the
 * device and are not here.
 */
export const PAID_FEATURES = [
    "your résumé saved to your account and read back on any device",
    "AI help importing it",
    "AI tailoring for each job",
    "AI answers to screening questions",
    "your résumé in the Chrome extension",
    "résumé tools for your AI agent",
    "the daily-picks email",
] as const;

/** The list as a sentence: "a, b and c". */
export function paidFeaturesSentence(): string {
    return `${PAID_FEATURES.slice(0, -1).join(", ")} and ${PAID_FEATURES[PAID_FEATURES.length - 1]}`;
}

/** The upgrade line every free surface closes with. */
const CLOUD_UPGRADE = `${cloud.name} (${cloud.price}) saves it to your account, encrypted.`;

/** /jobs masthead: both modes in one line. */
export const PRIVACY_HEADLINE = PRIVACY_SUMMARY;

/** /resume PageHeader description. */
export const RESUME_PAGE_SUBCOPY =
    `Upload a résumé to find matching roles. It stays on this device. ${cloud.name} adds ${paidFeaturesSentence()}.`;

/** /resume subcopy for a signed-in visitor, who can already export. */
export const RESUME_PAGE_SUBCOPY_SIGNED_IN =
    `The résumé your matches are ranked by. ${local.name} keeps it on this device; ${CLOUD_UPGRADE} Edit it, export a PDF, or replace it with a new file.`;

/** /resume local-résumé banner: the label, then the Local points. */
export const RESUME_LOCAL_DEVICE_BANNER_LABEL = `${local.name} · ${local.price}`;
export const RESUME_LOCAL_DEVICE_BANNER_BODY = local.points.join(" ");
export const RESUME_LOCAL_DEVICE_BANNER = `${RESUME_LOCAL_DEVICE_BANNER_LABEL}. ${RESUME_LOCAL_DEVICE_BANNER_BODY}`;

/** Importer modal + empty-state upload promise. Local 1 is not repeated: the dialog banner beneath already says it. */
export const RESUME_UPLOAD_PROMISE =
    `Upload a PDF or Word résumé. We show what we accepted before you use it. ${local.points[1]}`;

/** Passed into ResumeImportModal `storageNote`: which mode this visitor is in. */
export const RESUME_IMPORT_STORAGE_NOTE = "Nothing is saved to a server.";
export function resumeImportStorageNote(signedIn: boolean): string {
    return signedIn ? CLOUD_UPGRADE : RESUME_IMPORT_STORAGE_NOTE;
}

/** Résumé import modal: where the read happens (Local 1). */
export const RESUME_IMPORT_PARSE_LINE = local.points[0];

/** Résumé import modal, where this server has sealed AI (Private cloud 2). */
export const RESUME_IMPORT_SEALED_LINE = cloud.points[1];

/** Customize dialog badge when AI rewrites the lines (Private cloud 2), and when it does not: the rules draft. */
export const CUSTOMIZE_SEALED_BADGE = cloud.points[1];
export const CUSTOMIZE_RULES_BADGE = "Tailored in your browser by rules.";

/** /jobs front-door résumé band. */
export const FRONT_DOOR_RESUME_CARD_SUBCOPY = `Top 3 matches and why. ${local.points[0]}`;
export const FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN = `Rank these jobs by fit. ${local.name} keeps your résumé on this device; ${CLOUD_UPGRADE}`;

/** Connect, "Permissions and privacy": what an assistant you connect can reach, and where it goes. */
export const CONNECT_PRIVACY_LINE =
    `${cloud.points[2]} What your assistant reads goes to its own AI provider, under that provider's terms.`;

/** Settings, under a saved résumé. */
export const SETTINGS_RESUME_PRIVACY_LINE =
    `${cloud.points[0]} ${cloud.points[2]} Delete removes it and its saved versions.`;

/** The site FAQ answer to "Is my résumé private on Velai?". */
export const PRIVACY_FAQ_ANSWER = `${PRIVACY_SUMMARY} ${local.points[0]} ${cloud.points[3]}`;
