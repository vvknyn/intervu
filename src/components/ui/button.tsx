import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

// Rulebook (docs/design/rulebook-2026-09/RULEBOOK.md line 15) tertiary shape:
// a 1px Klein outline on a transparent fill, blue text. `outline`,
// `secondary` and `quiet` were three separate strings for this one shape
// (secondary's grey fill and outline/quiet's ink border were the rulebook
// violations) — one shared constant so they can't drift apart again.
const TERTIARY_BUTTON_CLASSES = "border border-brand bg-transparent text-brand hover:bg-muted"

const buttonVariants = cva(
  cn(
    // `border-transparent` gives every variant (bordered or not) a
    // border-width for CONTROL_FOCUS_VISIBLE's `focus-visible:border-foreground`
    // to actually paint against — without it, preflight's 0-width border
    // means that focus-visible color swap is a silent no-op.
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl border border-transparent text-sm font-normal transition-colors disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
    CONTROL_FOCUS_VISIBLE,
  ),
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:bg-brand-hover",
        brand: "bg-brand text-brand-foreground hover:bg-brand-hover",
        destructive: "bg-danger-text text-white hover:opacity-90",
        outline: TERTIARY_BUTTON_CLASSES,
        secondary: TERTIARY_BUTTON_CLASSES,
        ghost: "text-brand hover:bg-muted",
        link: "text-brand underline-offset-4 hover:underline h-auto px-0",
        // Alias of tertiary — not in the rulebook's own variant set, kept
        // because CompletenessMock.tsx (outside this change's scope) still
        // references it.
        quiet: TERTIARY_BUTTON_CLASSES,
        accent: "bg-brand text-brand-foreground hover:brightness-110 border-transparent",
      },
      size: {
        default: "h-8 px-3",
        xs: "h-8 px-2",
        sm: "h-8 px-3",
        lg: "h-11 px-4 [&_svg]:size-5",
        accent: "h-12 sm:h-[52px] px-7 sm:px-8 rounded-pill text-sm sm:text-base font-semibold",
        icon: "size-8",
        "icon-lg": "size-10 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
