/** Stable `/jobs` href for Next.js router prefetch (browse + hub warm paths). */
export function jobsBrowseSearchHref(query: string): string {
    const params = new URLSearchParams();
    params.set("view", "search");
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    return `/jobs?${params.toString()}`;
}

export function jobsForYouHubHref(): string {
    return "/jobs?view=for-you";
}
