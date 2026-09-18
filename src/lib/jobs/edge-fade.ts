import type { OverflowEdges } from "@/hooks/use-overflow-edges";

/** How far the fade reaches in from each clipped edge. */
const EDGE_FADE_PX = 24;

/**
 * Pure decision: given which edge(s) of a scroller currently hide content,
 * what `mask-image` (if any) fades that content toward transparent at the
 * hidden edge(s). Luminance masking — `white` = fully visible, `transparent`
 * = fully invisible; this is content masking, not a color-matched overlay,
 * so it fades correctly regardless of the scroller's own background (it
 * differs between the toolbar's at-rest and active states) or the color
 * behind it. `undefined` means "no mask" — the caller must not apply one,
 * since an identity mask is not the same as none (mobile layout audit,
 * 2026-09-18: class D "cut scroll row" wants zero affordance at 1440,
 * where nothing overflows).
 */
export function edgeFadeMaskImage(edges: OverflowEdges): string | undefined {
    if (!edges.left && !edges.right) return undefined;
    const left = edges.left ? "transparent 0, white " + EDGE_FADE_PX + "px" : "white 0";
    const right = edges.right
        ? "white calc(100% - " + EDGE_FADE_PX + "px), transparent 100%"
        : "white 100%";
    return "linear-gradient(to right, " + left + ", " + right + ")";
}
