/**
 * Site chrome — an ink band (dark surface) in BOTH themes, not a paper
 * surface (2026-08-15 dark-chrome pass; formerly the #12151a "instrument
 * void", then briefly the light paper reading surface). Product chrome
 * (TopBar, Footer, MobileTabBar) is paper (`bg-background`); `siteChrome`
 * remains for `/mock` demo bars only. Every element rendered inside an ink
 * chrome bar must take its paint from THIS object, never from page-level
 * tokens — foreground/muted-foreground are illegible on the ink fill, since
 * those tokens are tuned for the light page surface, not the dark chrome
 * sitting on top of it.
 */
export const siteChrome = {
    bar: "bg-chrome text-chrome-foreground",
    muted: "text-chrome-foreground",
    mutedHover: "text-chrome-foreground transition-colors hover:text-chrome-foreground",
    active: "font-[550] text-chrome-foreground",
    faint: "text-chrome-foreground",
    faintHover: "hover:text-chrome-foreground",
    border: "border-transparent",
} as const;
