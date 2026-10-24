/**
 * Velai's privacy promises about a résumé, in the one wording every surface
 * uses: the front door's privacy band (`FrontDoorPrivacy`), the summary at the
 * top of /privacy, and /connect. Each promise links to the /privacy section
 * that explains it, and each is true of the code it names:
 *
 * - read-in-browser: the file is parsed in the browser
 *   (`lib/local-ai/parse-resume.ts`, `extract-in-browser.ts`); no route takes
 *   a résumé file. A signed-in account saves the structured résumé.
 * - encrypted: account records are sealed with AES-256-GCM before they are
 *   stored (`lib/db/docstore/seal.ts`); a guest's résumé is kept in
 *   localStorage only (`lib/local-ai/resume-storage.ts`).
 * - sealed-ai: the read fallback strips contact details
 *   (`withoutContactDetails`, parse-resume.ts) and tailoring sends the
 *   matched lines (`tailor-with-engine.ts`), both encrypted in the browser to
 *   Tinfoil's attested server (`lib/sealed-ai/client.ts`); no AI on our
 *   servers reads a résumé.
 * - never-sold: no ad or tracking pixels; analytics have no autocapture, replay, survey or
 *   exception capture (`lib/posthog-options.ts`), and searches built from a résumé are not
 *   logged (`shouldLogSearch`).
 *
 * tests/unit/privacy-promises.test.ts checks those code facts and that each
 * link lands on a section /privacy has.
 */

export interface PrivacyPromise {
    id: "read-in-browser" | "encrypted" | "sealed-ai" | "never-sold";
    title: string;
    detail: string;
    /** The /privacy section that explains it. */
    href: string;
}

/** The section of /privacy that holds everything about a résumé. */
export const PRIVACY_RESUME_SECTION_ID = "your-resume";

export const PRIVACY_PROMISES: readonly PrivacyPromise[] = [
    {
        id: "read-in-browser",
        title: "Read in your browser",
        detail: "Velai reads your résumé file on your device. The file itself is never uploaded.",
        href: `/privacy#${PRIVACY_RESUME_SECTION_ID}`,
    },
    {
        id: "encrypted",
        title: "Encrypted when saved",
        detail: "Signed in, your résumé is encrypted with AES-256 before it's stored. Not signed in, it stays in this browser.",
        href: `/privacy#${PRIVACY_RESUME_SECTION_ID}`,
    },
    {
        id: "sealed-ai",
        title: "AI sees only what it needs",
        detail: "Your name and contact details are taken out first, and it runs on a sealed server we can't read. Tailoring sends just the lines that match the job.",
        href: "/privacy#ai-processing",
    },
    {
        id: "never-sold",
        title: "Never sold",
        detail: "No ads or data brokers. Our analytics count clicks, never the words on your screen or what you type.",
        href: "/privacy#cookies-analytics",
    },
];

/** One line for places with room for one: the front door masthead. */
export const PRIVACY_HEADLINE = "Private by design: your résumé is read in your browser and encrypted when saved.";

/** The link text that goes with it. */
export const PRIVACY_LINK_LABEL = "How Velai keeps it private";
