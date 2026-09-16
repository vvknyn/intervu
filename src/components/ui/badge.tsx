import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Badges are words, not chips: no fill, no border, no container — a
  // badge's entire signal is its text colour. Same rule as Chip on typeface:
  // a badge is a label, so sans — with tabular figures for the counts
  // badges often carry.
  "inline-flex items-center p-0 border-0 bg-transparent text-xs font-semibold tabular-nums w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
  {
    variants: {
      variant: {
        default: "text-muted-foreground",
        secondary: "text-muted-foreground",
        destructive: "text-danger-text",
        outline: "text-muted-foreground",
        ghost: "text-muted-foreground",
        link: "text-brand underline-offset-4 [a&]:hover:underline",
        brand: "text-brand",
        // Status variants — text colour only now; the soft-fill/hairline
        // container is gone, but the hue still comes from the same
        // design-token set (dark-mode correct, see lib/ui/status-tokens.ts).
        "st-saved": "text-st-saved",
        "st-applied": "text-st-applied",
        "st-intv": "text-st-intv",
        "st-offer": "text-st-offer",
        "st-closed": "text-st-closed",
        // Verdict variants — same text-only treatment, backed by the
        // verdict-* tokens (globals.css) that every favorable/caution
        // signal on the site already reads from.
        "verdict-good": "text-verdict-good",
        "verdict-caution": "text-verdict-caution",
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
