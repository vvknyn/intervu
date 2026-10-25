/** Locked Velai product mark — soft paper card, navy brackets, ONE bigger
 *  green live dot (1e5d7f11 / velai-icon-exports). Raster is the source of truth
 *  (`public/velai-logo.png`, derived from the locked master in
 *  `.velai-icon-imports/velai-icon-exports/`). Do not invent a second mark.
 *
 *  Landing and other BrandMark call sites render that raster. The header
 *  lockup (BrandLockup) uses HEADER_MARK_SRC — the same paper tile the
 *  Chrome extension shows, cut out of the raster's white canvas so it sits
 *  on the charcoal header. Email's charcoal band hosts the same tile.
 *  Favicon / PWA / apple-touch are regenerated from it via
 *  `scripts/generate-favicons.mjs`. Edge OG cards embed
 *  `LOCKED_MARK_DATA_URI` (128px) because Satori cannot fetch local files.
 */

import Link from "next/link";
import type { ComponentProps } from "react";
import { LOCKED_MARK_SRC } from "@/lib/brand/locked-mark-data-uri";

/** Header lockup only. The locked paper tile, brackets and live dot exactly
 *  as the Chrome extension shows them (`extension/icons/*` are the same
 *  pixels as `public/icons/velai-icon-*`), with the white canvas and drop
 *  shadow around the tile made transparent so it sits on the charcoal
 *  header. Made by `scripts/generate-header-tile.mjs` from
 *  `public/icons/velai-icon-1024.png`. */
export const HEADER_MARK_SRC = "/velai-tile.png" as const;

/** HEADER_MARK_SRC at 96px (3x the 32px TopBar tile), written by the same
 *  script. Offered via srcSet so the header paints this ~12 KB file instead
 *  of the 512px original, which every page would fetch beside its first
 *  JavaScript and slow it on a phone connection. */
export const HEADER_MARK_SMALL_SRC = "/velai-tile-96.png" as const;

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
            srcSet={src === HEADER_MARK_SRC ? `${HEADER_MARK_SMALL_SRC} 96w` : undefined}
            sizes={src === HEADER_MARK_SRC ? `${px}px` : undefined}
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
 *  consent chrome, and email cannot drift. The mark is the cut-out paper
 *  tile; email's header band hosts the same tile file.
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

/** The lockup as a link home. `hit-band` gives the 28-32px lockup the 44px tap
 *  band on a coarse pointer, so every lockup link (TopBar, auth card) has it
 *  by construction rather than by remembering the class. */
export function BrandHomeLink({ className, markClassName, ...link }: ComponentProps<typeof Link> & { markClassName?: string }) {
    return (
        <Link className={["hit-band inline-flex w-fit shrink-0 transition-opacity hover:opacity-90", className].filter(Boolean).join(" ")} data-rulebook-exempt {...link}>
            <BrandLockup markClassName={markClassName} />
        </Link>
    );
}
