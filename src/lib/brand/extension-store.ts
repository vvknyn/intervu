/**
 * The Velai Chrome extension's Web Store item, and what it does on a job page in a few words each. Every point is
 * something the extension does today (`extension/store/LISTING.md`, `extension/README.md`); keep it that way when
 * either changes. Name no other company here: the store rejected an earlier listing that named job sites.
 */
export const CHROME_EXTENSION_ID = "jndkidbobccmcjochgioiiiiaaaldjjd";

export const CHROME_EXTENSION_STORE_URL = `https://chromewebstore.google.com/detail/${CHROME_EXTENSION_ID}`;

export const CHROME_EXTENSION_NAME = "Velai for Chrome";

export const CHROME_EXTENSION_LEAD = "On a job page, Velai checks the role before you apply.";

export type ExtensionPointId = "fit" | "posting" | "resume" | "apply";

export const CHROME_EXTENSION_POINTS: readonly { id: ExtensionPointId; text: string }[] = [
    { id: "fit", text: "Your fit for the role" },
    { id: "posting", text: "Checks if the posting looks current" },
    { id: "resume", text: "Your résumé tailored to the role" },
    { id: "apply", text: "Fills the form and tracks it" },
];
