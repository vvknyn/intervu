import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Same rule as Chip: a badge is a label, so sans — with tabular figures for
  // the counts badges often carry.
  "inline-flex items-center justify-center rounded-none border border-transparent px-2 py-0.5 text-[11px] tabular-nums font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none backdrop-blur-md shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/90 text-primary-foreground [a&]:hover:bg-primary",
        secondary:
          "bg-secondary/70 text-secondary-foreground [a&]:hover:bg-secondary/90 border border-border/50",
        destructive:
          "bg-destructive/80 text-white [a&]:hover:bg-destructive dark:bg-destructive/60",
        outline:
          "border-border/80 bg-background/50 text-foreground [a&]:hover:bg-muted/70",
        ghost: "[a&]:hover:bg-muted/60 text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        brand: "bg-brand/15 text-brand border-brand/25 [a&]:hover:bg-brand/25",
        // Status variants — design-token backed, dark-mode correct (see lib/ui/status-tokens.ts).
        "st-saved": "bg-st-saved-soft/80 text-st-saved border-st-saved/30",
        "st-applied": "bg-st-applied-soft/80 text-st-applied border-st-applied/30",
        "st-intv": "bg-st-intv-soft/80 text-st-intv border-st-intv/30",
        "st-offer": "bg-st-offer-soft/80 text-st-offer border-st-offer/30",
        "st-closed": "bg-st-closed-soft/80 text-st-closed border-st-closed/30",
        // Verdict variants — same soft-fill/ink/hairline shape as the st-*
        // set above, backed by the verdict-* tokens (globals.css) that every
        // favorable/caution signal on the site already reads from.
        "verdict-live": "bg-verdict-live-bg/80 text-verdict-live border-verdict-live/30",
        "verdict-caution": "bg-verdict-caution-bg/80 text-verdict-caution border-verdict-caution/30",
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
