import { X } from "@phosphor-icons/react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Carbon field chip — sharp 0px geometry, 1px hairline border, no fill even
 * when selected (a chip is never the one filled control in its region).
 * Active state uses a squared brand left blade plus brand border/text — never
 * a filled `bg-brand` inversion.
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-none border border-border bg-background px-3 text-sm tabular-nums text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-brand border-l-[3px] text-brand bg-background",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
)

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
