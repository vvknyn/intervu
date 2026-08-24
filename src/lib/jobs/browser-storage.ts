/**
 * localStorage access for the /jobs prompts, in one place.
 *
 * Every read and write is wrapped: `window.localStorage` THROWS on access in
 * a blocked-cookies context (not returns null), and `setItem` throws on quota
 * and in some private-mode browsers. A prompt that crashes the page because
 * someone has storage disabled is worse than a prompt that forgets it already
 * asked, so every failure degrades to "no stored value".
 *
 * Extracted when the signed-in email nudge needed the same three functions
 * `onboarding-prompt.ts` already had privately — two copies of "remember that
 * we dismissed this" is two places for the try/catch to be forgotten.
 */
export function browserStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

/** Null for a missing key AND for a storage that refused to answer — a caller
 *  cannot tell the two apart, and shouldn't: both mean "no stored value". */
export function readBrowserValue(key: string): string | null {
    try {
        return browserStorage()?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

export function writeBrowserValue(key: string, value: string): void {
    try {
        browserStorage()?.setItem(key, value);
    } catch {
        /* quota exceeded / private mode */
    }
}

/** True only for an explicitly stored "true" — a missing key is not dismissed. */
export function readBrowserFlag(key: string): boolean {
    return readBrowserValue(key) === "true";
}

export function setBrowserFlag(key: string): void {
    writeBrowserValue(key, "true");
}
