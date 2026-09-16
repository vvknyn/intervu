/** Locked logo #3 — bracket gate [ · ]: structured boundary holding a live
 *  signal. Brackets follow currentColor so the mark adapts to light/dark
 *  surfaces. Restored 2026-09-03 (reverts the 2026-08-27 "va" ligature
 *  rebrand's mark; the Velai wordmark rename itself stays). */

// Canonical geometry — the ONLY place the bracket-gate path data is allowed
// to live. Every other rendering of the mark (Satori/next-og OG cards, the
// error/not-found fallbacks, anything that can't use this component directly)
// must import these instead of hand-copying path strings, so a future
// brand-mark change is a one-file edit, not a repo-wide find-and-replace.
export const BRAND_MARK_VIEWBOX = "0 0 64 64";
export const BRAND_MARK_BRACKETS = [
    "M22 16H10v32h12v-6h-6V22h6z",
    "M42 16h12v32H42v-6h6V22h-6z",
] as const;
export const BRAND_MARK_DOT = { cx: 32, cy: 32, r: 7 } as const;

// The dot's FILL belongs to that same canon: it's a literal, not
// rgb(var(--live)), because Satori (next/og) renders these same constants
// with no CSS custom properties available — an OG card has no theme to
// follow, so it takes the light-mode value. In-app the component below uses
// `fill-live` instead, which resolves the SAME token per theme.
export const BRAND_MARK_DOT_FILL = "#0E9F4E";

/** Lockup box — `h-7` mark and the wordmark share this pixel size. */
export const BRAND_LOCKUP_MARK_PX = 28;
export const BRAND_LOCKUP_WORDMARK_PX = 28;

export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
    return (
        <svg viewBox={BRAND_MARK_VIEWBOX} aria-hidden className={className}>
            {BRAND_MARK_BRACKETS.map((d) => (
                <path key={d} d={d} fill="currentColor" />
            ))}
            <circle cx={BRAND_MARK_DOT.cx} cy={BRAND_MARK_DOT.cy} r={BRAND_MARK_DOT.r} className="fill-live" />
        </svg>
    );
}

export function BrandLockupMark({
    tileClassName = "h-7 w-7",
}: {
    tileClassName?: string;
    markClassName?: string;
} = {}) {
    return <BrandMark className={tileClassName} />;
}

/** Mark + wordmark — the header lockup. Size/weight live here so TopBar,
 *  consent chrome, and email cannot drift. Email hosts a raster of this same
 *  geometry (`public/velai-logo.png`, regenerated from BRAND_MARK_* — SVG
 *  masks/currentColor don't render in Gmail/Outlook).
 *
 *  `markClassName` overrides just the mark's tile size (e.g. TopBar's 32px
 *  lockup) without touching the default `h-7 w-7` every other call site
 *  (error/not-found chrome, ConsentCards) relies on. */
export function BrandLockup({ className, markClassName }: { className?: string; markClassName?: string }) {
    return (
        <span className={["flex items-center gap-2 text-brand", className].filter(Boolean).join("")}>
            <BrandLockupMark tileClassName={markClassName} />
            {/* Wordmark is the one rulebook exception: Libre Franklin 700,
                caps, tight tracking. `--font-display` was retired to the sans
                stack site-wide (rulebook v2 CORRECTIONS #2), so this reads
                `--font-display-face` (the Libre Franklin next/font variable
                from app/layout.tsx) directly instead of through that token —
                the one call site still allowed to. font-[700] (not
                font-bold, now 600) + data-rulebook-exempt covers the runtime
                probe; design-lint-allow covers the static gate. */}
            {/* design-lint-allow */}
            <span
                data-rulebook-exempt
                className="font-[family-name:var(--font-display-face)] text-[28px] leading-none font-[700] uppercase tracking-tight"
            >
                velai
            </span>
        </span>
    );
}
