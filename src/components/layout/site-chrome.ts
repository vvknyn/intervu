/**
 * Paper chrome — the light reading surface (2026-08-14 investor-polish
 * reskin; formerly the #12151a "instrument void"). Token classes, not
 * hex, so the chrome and the page body read from the same `:root`
 * palette and cannot drift apart.
 */
export const siteChrome = {
    bar: "bg-background text-foreground",
    muted: "text-muted-foreground",
    mutedHover: "text-muted-foreground transition-colors hover:text-foreground",
    active: "font-[550] text-foreground",
    faint: "text-faint",
    border: "border-border",
} as const;
