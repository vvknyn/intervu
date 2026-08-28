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
export const BRAND_MARK_STROKE_WIDTH = 20;

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
