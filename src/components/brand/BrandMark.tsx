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
    "M 48 50 H 28 A 20 20 0 1 1 56 70 C 58 80 62 90 68 98 A 22 18 0 0 0 100 92 V 38",
] as const;
export const BRAND_MARK_STROKE_WIDTH = 16;

// Email headers use the raster at public/velai-logo.png (SVG unsupported there);
// that PNG is a display icon, not this stroke geometry.
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
                    strokeLinecap="round"
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
            <span className="font-display text-[28px] leading-none font-bold uppercase tracking-tight">
                velai
            </span>
        </span>
    );
}
