/** Locked Velai product mark — soft paper card, navy brackets, ONE bigger
 *  green live dot (1e5d7f11 / velai-icon-exports). Raster is the source of truth
 *  (`public/velai-logo.png`, derived from the locked master in
 *  `.velai-icon-imports/velai-icon-exports/`). Do not invent a second mark.
 *
 *  Landing and other BrandMark call sites render that raster. The header
 *  lockup (BrandLockup) uses HEADER_MARK_SRC — the same brackets and live
 *  dot with the paper plate removed — because the plate is opaque pixels
 *  in the PNG, not a CSS background. Email hosts `public/velai-logo.png`.
 *  Favicon / PWA / apple-touch are regenerated from it via
 *  `scripts/generate-favicons.mjs`. Edge OG cards embed
 *  `LOCKED_MARK_DATA_URI` (128px) because Satori cannot fetch local files.
 */

import { LOCKED_MARK_SRC } from "@/lib/brand/locked-mark-data-uri";

/** Header lockup only. Same locked brackets and live dot as
 *  `public/velai-logo.png`, with the baked-in paper plate removed so the
 *  mark sits on the charcoal header. The plate is opaque pixels in that
 *  raster — this component does not paint a background behind the mark. */
export const HEADER_MARK_SRC = "/velai-mark-on-dark.png" as const;

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

/** Warm-white lockup text — matches landing poster foreground, never brand green. */
export const BRAND_LOCKUP_WORDMARK_CLASS = "text-wordmark";

export function BrandMark({
    className = "h-7 w-7",
    pixelSize,
    priority = false,
    src = LOCKED_MARK_SRC,
}: {
    className?: string;
    /** Intrinsic width/height — must match rendered CSS size to avoid CLS. */
    pixelSize?: number;
    priority?: boolean;
    /** Defaults to the locked paper-card raster. Header lockup passes HEADER_MARK_SRC. */
    src?: typeof LOCKED_MARK_SRC | typeof HEADER_MARK_SRC;
}) {
    const px = pixelSize ?? BRAND_LOCKUP_MARK_PX;
    return (
        // eslint-disable-next-line @next/next/no-img-element -- brand lockup must match email/favicon raster exactly; next/image would re-encode
        <img
            src={src}
            alt=""
            aria-hidden
            width={px}
            height={px}
            fetchPriority={priority ? "high" : undefined}
            decoding={priority ? "sync" : "async"}
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
    return <BrandMark className={tileClassName} src={HEADER_MARK_SRC} />;
}

/** Mark + wordmark — the header lockup. Size/weight live here so TopBar,
 *  consent chrome, and email cannot drift. The mark is the plate-free
 *  header raster; email still hosts `public/velai-logo.png`.
 *
 *  `markClassName` overrides just the mark's tile size (e.g. TopBar's 32px
 *  lockup) without touching the default `h-7 w-7` every other call site
 *  (error/not-found chrome, ConsentCards) relies on. */
export function BrandLockup({ className, markClassName }: { className?: string; markClassName?: string }) {
    return (
        <span className={["flex items-center gap-2", className].filter(Boolean).join(" ")}>
            <BrandLockupMark tileClassName={markClassName} />
            <span
                data-rulebook-exempt
                className={[BRAND_LOCKUP_WORDMARK_CLASS, "text-title-sm leading-none font-semibold"].join(" ")}
            >
                Velai
            </span>
        </span>
    );
}
