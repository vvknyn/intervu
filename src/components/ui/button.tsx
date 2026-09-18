import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Rulebook (docs/design/rulebook-2026-09/RULEBOOK.md line 15) tertiary shape:
// a 1px Klein outline on a transparent fill, blue text. `outline`,
// `secondary` and `quiet` were three separate strings for this one shape
// (secondary's grey fill and outline/quiet's ink border were the rulebook
// violations) — one shared constant so they can't drift apart again.
const TERTIARY_BUTTON_CLASSES = "border border-brand bg-transparent text-brand hover:bg-muted"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl text-sm font-normal transition-colors focus-visible:outline-2 focus-visible:outline-brand focus-visible:-outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
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
      },
      size: {
        default: "h-8 px-3",
        xs: "h-8 px-2",
        sm: "h-8 px-3",
        lg: "h-11 px-4 [&_svg]:size-5",
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
