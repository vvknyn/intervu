import { X } from "@phosphor-icons/react"
import { cva } from "class-variance-authority"

import { solidBadgeVariants } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Soft-surfaces pill chip (A1). Selected/unselected both carry `text-foreground`
 * — the only difference is border weight (`border-foreground` vs `border-border`),
 * never brand color: brand navy is reserved for the 3 named filled controls
 * elsewhere on the page (header Sign in, Search, résumé Upload), not chips.
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "ctl-md inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill border border-border bg-background px-3 text-sm tabular-nums text-foreground transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-foreground text-foreground",
        false: "",
      },
      /**
       * Hover affordance is opt-IN, not opt-out. Most chips in the app are
       * plain facts/tags with no click target anywhere in them — those must
       * default to no hover feedback, or they visually promise a control
       * that isn't there. Pass `interactive: true` only when the chip itself
       * is a real control (button/trigger) or embeds one (e.g. ChipDismiss).
       */
      interactive: {
        true: "hover:bg-muted cursor-pointer",
        false: "",
      },
    },
    defaultVariants: { active: false, interactive: false },
  },
)

/** Shared count badge for filter toolbars — neutral, not brand-accented
 *  (ACCENT DISCIPLINE: brand navy is reserved for the 3 named filled
 *  controls, not a filter count badge). */
export const filterCountBadgeClass = solidBadgeVariants({ tone: "muted" })

/** The chip's own dismiss icon — shared so every chip's remove affordance is
 *  the same tap target/hover treatment instead of an inline one-off button. */
export function ChipDismiss({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("ctl-sm ctl-button ctl-square inline-flex items-center justify-center leading-none opacity-70 hover:opacity-100 cursor-pointer", className)}
    >
      <X />
    </button>
  )
}
