import { cn } from "@/lib/utils";
import { OPENCLAW_STATUS_BADGE } from "./openclaw-content";

/**
 * Honest-status qualifier rendered directly above `OPENCLAW_HEADLINE`
 * wherever that headline appears (landing hero, /openclaw hero) — shared
 * so the two placements can never drift apart. Styled to match the rest of
 * /openclaw's mono/uppercase section labels; `text-[rgb(var(--oc-coral))]`
 * resolves against the `.openclaw` scope's `--oc-coral`, which is declared
 * identically in both light and dark blocks of openclaw-marketing.css, so
 * it reads on both site themes without a separate dark-mode override.
 */
export function OpenclawStatusBadge({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--oc-coral))]",
        className,
      )}
    >
      {OPENCLAW_STATUS_BADGE}
    </p>
  );
}
