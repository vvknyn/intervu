/** Locked Velai product mark — soft paper card, thick navy brackets, ONE bigger
 *  green live dot, soft drop shadow. Raster is the source of truth
 *  (`public/velai-logo.png`, derived from the locked master in
 *  `.velai-icon-imports/velai-icon-exports/`). Do not invent a second mark.
 *
 *  In-app chrome (TopBar, auth, consent, error) renders that raster. Email
 *  hosts the same file. Favicon / PWA / apple-touch are regenerated from it
 *  via `scripts/generate-favicons.mjs`. Edge OG cards embed
 *  `LOCKED_MARK_DATA_URI` (128px) because Satori cannot fetch local files.
 */

import { LOCKED_MARK_SRC } from "@/lib/brand/locked-mark-data-uri";

// Legacy SVG geometry retained only for compare fixtures (LockupMock) that
// intentionally show non-product variants. Product surfaces must use BrandMark /
// LOCKED_MARK_* — never these paths as the live mark.
export const BRAND_MARK_VIEWBOX = "0 0 64 64";
export const BRAND_MARK_BRACKETS = [
    "M22 16H10v32h12v-6h-6V22h6z",
    "M42 16h12v32H42v-6h6V22h-6z",
] as const;
export const BRAND_MARK_DOT = { cx: 32, cy: 32, r: 10 } as const;
export const BRAND_MARK_DOT_FILL = "#0E9F4E";

/** Lockup box — `h-7` mark and the wordmark share this pixel size. */
export const BRAND_LOCKUP_MARK_PX = 28;
export const BRAND_LOCKUP_WORDMARK_PX = 28;

export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
    return (
        // eslint-disable-next-line @next/next/no-img-element -- brand lockup must match email/favicon raster exactly; next/image would re-encode
        <img
            src={LOCKED_MARK_SRC}
            alt=""
            aria-hidden
            width={BRAND_LOCKUP_MARK_PX}
            height={BRAND_LOCKUP_MARK_PX}
            className={["shrink-0 object-contain", className].filter(Boolean).join(" ")}
            draggable={false}
        />
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
 *  consent chrome, and email cannot drift. Email hosts the same raster
 *  (`public/velai-logo.png`).
 *
 *  `markClassName` overrides just the mark's tile size (e.g. TopBar's 32px
 *  lockup) without touching the default `h-7 w-7` every other call site
 *  (error/not-found chrome, ConsentCards) relies on. */
export function BrandLockup({ className, markClassName }: { className?: string; markClassName?: string }) {
    return (
        <span className={["flex items-center gap-2 text-brand", className].filter(Boolean).join(" ")}>
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
