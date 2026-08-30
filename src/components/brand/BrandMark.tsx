/** Velai mark — the "va" ligature stroke. Follows currentColor so it adapts
 *  to light/dark surfaces. Replaces the old bracket-gate [ · ] lockup
 *  (2026-08-27 rebrand); the live-signal dot that design carried had no
 *  equivalent in this glyph and was dropped, not relocated — the `--live`
 *  token and its other consumers (status pills, verdict badges) are
 *  unaffected. */

// Canonical geometry — the ONLY place the mark's path data is allowed to
// live. Every other rendering of the mark (Satori/next-og OG cards, the
// error/not-found fallbacks, anything that can't use this component directly)
// must import these instead of hand-copying path strings, so a future
// brand-mark change is a one-file edit, not a repo-wide find-and-replace.
export const BRAND_MARK_VIEWBOX = "0 0 128 128";
export const BRAND_MARK_PATHS = [
    "M 52 50 H 30 A 18 18 0 1 1 58 64 C 60 74 62 84 64 94 A 20 18 0 0 0 102 90 V 36",
] as const;
export const BRAND_MARK_STROKE_WIDTH = 14;

/** Lockup box — `h-7` mark and the wordmark share this pixel size. */
export const BRAND_LOCKUP_MARK_PX = 28;
export const BRAND_LOCKUP_WORDMARK_PX = 28;

export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
    return (
        <svg
            viewBox={BRAND_MARK_VIEWBOX}
            fill="none"
            aria-hidden
            className={className}
        >
            {BRAND_MARK_PATHS.map((d) => (
                <path
                    key={d}
                    d={d}
                    stroke="currentColor"
                    strokeWidth={BRAND_MARK_STROKE_WIDTH}
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                />
            ))}
        </svg>
    );
}

/** Mark + wordmark — the header lockup. Size/weight live here so TopBar,
 *  consent chrome, and email cannot drift. */
export function BrandLockup({ className }: { className?: string }) {
    return (
        <span className={["flex items-center gap-2 text-brand", className].filter(Boolean).join(" ")}>
            <BrandMark className="h-7 w-7 text-current" />
            <span className="font-display text-[28px] leading-none font-black uppercase tracking-tight">
                velai
            </span>
        </span>
    );
}
