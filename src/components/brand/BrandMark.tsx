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
    "M 52 50 H 30 A 18 18 0 1 1 58 64 C 57.7 56.4 62.4 101.5 64 94 A 20 18 0 0 0 102 90 V 36",
] as const;
export const BRAND_MARK_STROKE_WIDTH = 16;

// Email headers use the raster at public/velai-logo.png (SVG unsupported there);
// that PNG is a display icon, not this stroke geometry.
/** Lockup box — `h-7` mark and the wordmark share this pixel size. */
export const BRAND_LOCKUP_MARK_PX = 28;
export const BRAND_LOCKUP_WORDMARK_PX = 28;

/** Option-1 tile — brand-tint ground + vector mark in `currentColor`. */
export function BrandLockupMark({
    tileClassName = "h-7 w-7 rounded-[6px]",
    markClassName = "h-7 w-7",
}: {
    tileClassName?: string;
    markClassName?: string;
} = {}) {
    return (
        <span
            aria-hidden
            className={[
                "inline-flex shrink-0 items-center justify-center overflow-hidden bg-brand/10 text-brand",
                tileClassName,
            ].join(" ")}
        >
            <BrandMark className={markClassName} />
        </span>
    );
}

export function BrandMark({ className = "h-7 w-7 text-current" }: { className?: string }) {
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
 *  consent chrome, and email cannot drift. Header uses the vector mark in
 *  brand blue; email keeps the dark-ground raster (SVG unsupported there). */
export function BrandLockup({ className }: { className?: string }) {
    return (
        <span className={["flex items-center gap-2 text-brand", className].filter(Boolean).join(" ")}>
            <BrandLockupMark />
            <span className="font-display text-[28px] leading-none font-bold uppercase tracking-tight">
                velai
            </span>
        </span>
    );
}
