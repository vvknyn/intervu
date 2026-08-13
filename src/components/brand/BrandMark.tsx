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
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} fill="#7cb87a" />
        </svg>
    );
}
