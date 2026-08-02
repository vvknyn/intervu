import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Squared chip geometry — the ONE shared shape for a toggle/filter/tag
 * affordance (docs-mockup.html "THE RULES" #1 — pills retired; #5 — green
 * tint marks the active/verified state only). Before this, the SERP's
 * filter-chip row (FilterChipsRow.tsx) and the active-filter pill strip
 * (app/page.tsx) each hand-rolled their own `rounded-full border …` class
 * string, which is exactly how the two drifted from each other and from
 * the mock's squared chip.
 *
 * Exported as a `cva` class function rather than a wrapping component
 * because the two real call sites need different elements — a whole chip
 * that IS a `<button>` (FilterChipsRow's cycling quick-filter), and a
 * `<span>` label with a separate dismiss `<button>` inside it (page.tsx's
 * active-filter chip, JobDetail's cluster/"also in" chip) — so the shared
 * contract is the CLASS, not the element.
 */
export const chipVariants = cva(
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-brand bg-green-tint-bg text-brand",
        false: "border-border bg-card text-muted-foreground hover:border-foreground/30",
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
      className={cn("leading-none opacity-70 hover:opacity-100", className)}
    >
      ×
    </button>
  )
}
