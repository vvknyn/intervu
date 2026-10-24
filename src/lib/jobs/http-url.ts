/** True when `url` is safe to hand off as a real navigation target (http/https only). */
export function isHttpApplyUrl(url: string): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/** The URL when it is http(s), else null: stored job/apply URLs are untrusted at render time. */
export function httpUrlOrNull(url: string | null | undefined): string | null {
    return url && isHttpApplyUrl(url) ? url : null;
}
