import { Check, X } from "@phosphor-icons/react"
import { cva } from "class-variance-authority"

import { solidBadgeVariants } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Calm-pass chip (R5): a borderless tonal fill (surface-2, muted text) at rest;
 * a selected/active chip is a brand-tint fill with brand text. No outline in
 * either state.
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "ctl-md inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill bg-surface-2 px-3 text-sm tabular-nums text-muted-foreground transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "bg-live-tint-bg text-brand",
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
        true: "hover:bg-muted hover:text-foreground cursor-pointer",
        false: "",
      },
    },
    defaultVariants: { active: false, interactive: false },
  },
)

/**
 * A chip that is a boolean toggle (on/off, no value in its label). Selected is
 * never colour alone (WCAG 1.4.1): the state is announced (`aria-pressed`, or
 * `aria-checked` when the chip is a `role="radio"`) and a leading check
 * shows it (the Material filter-chip pattern). A chip whose label already
 * states its value (it has a remove X or a dropdown chevron) is not a toggle
 * and stays on plain `chipVariants`.
 */
export function ToggleChip({
  selected,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-pressed"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(chipVariants({ active: selected, interactive: true }), className)}
      {...props}
    >
      {selected && <Check weight="bold" aria-hidden />}
      {children}
    </button>
  )
}

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
