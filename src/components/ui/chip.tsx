import { X } from "@phosphor-icons/react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Carbon field chip — sharp 0px geometry, 1px hairline border. Active state
 * mirrors job-row selection: 3px brand blade + tinted fill + brand text
 * (brand is a sparing accent, not a filled loud control).
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-none border border-border bg-background px-3 text-sm tabular-nums text-foreground transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-brand border-l-[3px] border-l-brand bg-brand/[0.06] pl-2.5 text-brand",
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

/** Shared count badge for filter toolbars — squared, brand-accented. */
export const filterCountBadgeClass =
  "inline-flex min-w-4 items-center justify-center rounded-none border border-brand bg-muted px-1 text-xs font-semibold tabular-nums text-brand"

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
      className={cn("inline-flex items-center justify-center leading-none opacity-70 hover:opacity-100 cursor-pointer", className)}
    >
      <X />
    </button>
  )
}
