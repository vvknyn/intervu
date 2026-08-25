import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Carbon-Glass chip geometry — sharp 0px rectangular geometry, 1px border,
 * frosted backdrop blur and specular top highlight.
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border px-2 text-xs tabular-nums tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-brand/90 bg-brand/10 text-brand font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] dark:bg-brand/15",
        false: "border-border/70 bg-card/40 text-muted-foreground hover:border-brand/60 hover:text-brand",
      },
    },
    defaultVariants: { active: false },
  },
)

/** The chip's own dismiss "×" — shared so every chip's remove affordance is
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
      ×
    </button>
  )
}
