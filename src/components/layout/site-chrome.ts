/**
 * Instrument void chrome — same plane as the landing (#12151a).
 * Hardcoded so a stale `intervu-dark=0` preference can never flash a
 * light TopBar over a dark jobs body again.
 */
export const siteChrome = {
    bar: "bg-[#12151a] text-[#ececec]",
    muted: "text-[#8b919a]",
    mutedHover: "text-[#8b919a] transition-colors hover:text-[#ececec]",
    active: "font-[550] text-[#ececec]",
    faint: "text-[#5c636e]",
    border: "border-[#2a2f36]",
} as const;
