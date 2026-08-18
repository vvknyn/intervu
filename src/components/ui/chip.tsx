import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Carbon-Glass chip geometry — sharp 0px rectangular geometry, 1px border,
 * frosted backdrop blur and specular top highlight.
 */
export const chipVariants = cva(
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none border px-2 text-[11px] font-mono tracking-tight transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-foreground/90 bg-foreground/10 text-foreground font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] dark:bg-foreground/15",
        false: "border-border/70 bg-card/40 text-muted-foreground hover:border-foreground/60 hover:text-foreground",
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
      className={cn("leading-none opacity-70 hover:opacity-100 cursor-pointer", className)}
    >
      ×
    </button>
  )
}
