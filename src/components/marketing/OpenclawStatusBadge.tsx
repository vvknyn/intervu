import { cn } from "@/lib/utils";
import { OPENCLAW_STATUS_BADGE } from "./openclaw-content";

/**
 * Honest-status qualifier rendered directly above `OPENCLAW_HEADLINE`.
 * Label text stays neutral ink (one-visual-world pass, 2026-08-04 — the
 * site's one accent color is spent scarcely). Words only, no decorative
 * dot (rulebook: status words are text, never a colored mark).
 */
export function OpenclawStatusBadge({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {OPENCLAW_STATUS_BADGE}
    </p>
  );
}
