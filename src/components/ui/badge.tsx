import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Same rule as Chip: a badge is a label, so sans — with tabular figures for
  // the counts badges often carry.
  "inline-flex items-center justify-center rounded-none border border-transparent px-2 py-0.5 text-xs tabular-nums w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary border border-border",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive dark:bg-destructive",
        outline:
          "border-border bg-background text-foreground [a&]:hover:bg-muted",
        ghost: "[a&]:hover:bg-muted text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        brand: "bg-muted text-brand border-brand [a&]:hover:bg-muted",
        // Status variants — design-token backed, dark-mode correct (see lib/ui/status-tokens.ts).
        "st-saved": "bg-st-saved-soft text-st-saved border-st-saved",
        "st-applied": "bg-st-applied-soft text-st-applied border-st-applied",
        "st-intv": "bg-st-intv-soft text-st-intv border-st-intv",
        "st-offer": "bg-st-offer-soft text-st-offer border-st-offer",
        "st-closed": "bg-st-closed-soft text-st-closed border-st-closed",
        // Verdict variants — same soft-fill/ink/hairline shape as the st-*
        // set above, backed by the verdict-* tokens (globals.css) that every
        // favorable/caution signal on the site already reads from.
        "verdict-good": "bg-verdict-good-bg text-verdict-good border-verdict-good",
        "verdict-caution": "bg-verdict-caution-bg text-verdict-caution border-verdict-caution",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
