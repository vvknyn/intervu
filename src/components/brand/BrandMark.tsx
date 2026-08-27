/** Locked logo #3 — bracket gate [ · ]: structured boundary holding a live signal. Brackets follow currentColor so the mark adapts to light/dark surfaces. */

// Canonical geometry — the ONLY place the bracket-gate path data is allowed to
// live. Every other rendering of the mark (Satori/next-og OG cards, the
// error/not-found fallbacks, anything that can't use this component directly)
// must import these instead of hand-copying path strings, so a future
// brand-mark change is a one-file edit, not a repo-wide find-and-replace.
export const BRAND_MARK_VIEWBOX = "0 0 64 64";
export const BRAND_MARK_BRACKETS = [
    "M22 16H10v32h12v-6h-6V22h6z",
    "M42 16h12v32H42v-6h6V22h-6z",
] as const;
export const BRAND_MARK_DOT = { cx: 32, cy: 32, r: 7 } as const;

// The dot's FILL belongs to that same canon, and until now it did not: the
// comment above centralised geometry only, so the colour was hand-copied into
// opengraph-image.tsx and lib/og/page-card.tsx and drifted independently in
// public/mark.svg. Four renderings of one mark carried two different greens
// (#7cb87a, #6fad6d) — and after the accent moved from emerald to
// International Klein Blue, neither of them was the brand colour any more.
//
// This is `--live` (globals.css `--live: 14 159 78`), not `--brand`, on purpose:
// the docstring above defines the dot as the live signal the brackets hold, and
// --live is the token for that. Ledger palette (2026-08-27): Klein blue keeps
// every interactive/brand job, green joins with exactly one meaning — "this
// fact is live/verified" — so the dot moved off --brand's blue onto that
// green, keying off the meaning it always had rather than the value it used
// to share with --brand.
//
// It is a literal, not rgb(var(--live)), because Satori (next/og) renders these
// same constants with no CSS custom properties available — an OG card has no
// theme to follow, so it takes the light-mode value. In-app the component below
// uses `fill-live` instead, which resolves the SAME token per theme; a frozen
// #0E9F4E dot would all but vanish against dark's #0A0A0A ground — dark mode
// uses --live's own dark value (#2FBF71) via the cascade, not this constant.
// One meaning, two mechanisms, because only one of the two renderers has a
// cascade.
export const BRAND_MARK_DOT_FILL = "#0E9F4E";

export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
    return (
        <svg
            viewBox={BRAND_MARK_VIEWBOX}
            aria-hidden
            className={className}
        >
            {BRAND_MARK_BRACKETS.map((d) => (
                <path key={d} d={d} fill="currentColor" />
            ))}
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} className="fill-live" />
        </svg>
    );
}
