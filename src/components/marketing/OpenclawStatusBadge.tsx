import { cn } from "@/lib/utils";
import { OPENCLAW_STATUS_BADGE } from "./openclaw-content";

/**
 * Honest-status qualifier rendered directly above `OPENCLAW_HEADLINE`
 * wherever that headline appears (landing hero, /openclaw hero) — shared
 * so the two placements can never drift apart. Label text stays neutral ink
 * (one-visual-world pass, 2026-08-04 — the site's one accent color is
 * spent scarcely); the single `--brand` dot is the one "small mark" this
 * status line gets, the same role a live-verdict dot plays elsewhere
 * (see `/pricing`'s identical `h-[9px] w-[9px] bg-brand` dot).
 */
export function OpenclawStatusBadge({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
    >
      <span className="h-[7px] w-[7px] shrink-0 bg-brand" aria-hidden="true" />
      {OPENCLAW_STATUS_BADGE}
    </p>
  );
}
