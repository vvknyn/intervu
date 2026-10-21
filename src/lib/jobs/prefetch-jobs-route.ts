/** Stable `/jobs` href for Next.js router prefetch (browse + hub warm paths). */
export function jobsBrowseSearchHref(query: string): string {
    const params = new URLSearchParams();
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    const qs = params.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
}
