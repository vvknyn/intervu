import { cva } from "class-variance-authority"

/**
 * Carbon field chip — sharp 0px geometry, 1px hairline border. Active state
 * mirrors job-row selection: 3px brand blade + tinted fill + brand text
 * (brand is a sparing accent, not a filled loud control).
 *
 * Lives in a Phosphor-free module so Server Components (e.g. `/co/[slug]`)
 * can apply the same classes without evaluating `@phosphor-icons/react`,
 * whose IconContext calls `createContext` and crashes RSC.
 */
export const chipVariants = cva(
  // A chip carries a label, never code, so it takes the sans — with tabular
  // figures, since chips routinely hold counts that sit in a row and should
  // not jitter as the numbers change.
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-none border border-border bg-background px-3 text-sm tabular-nums text-foreground transition-colors motion-reduce:transition-none hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      active: {
        true: "border-brand border-l-[3px] border-l-brand bg-brand/[0.06] pl-2.5 text-brand",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
)

/** Shared count badge for filter toolbars — squared, brand-accented. */
export const filterCountBadgeClass =
  "inline-flex min-w-4 items-center justify-center rounded-none border border-brand bg-muted px-1 text-xs font-semibold tabular-nums text-brand"
