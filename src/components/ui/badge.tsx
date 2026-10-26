import * as React from "react"
import { Slot } from "radix-ui"
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
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * The solid counter/label chip — the one filled badge on the site (`Badge`
 * above is for words; this is for a count or a one-word flag that has to stand
 * out on a control: the bell, a tab, a corner "New").
 *
 * 16px high (`size="sm"`: a 14px box with the same 12px text, for a badge on a 20px icon), square (rulebook radius 0), 12/600 text. Pin it to a corner with
 * `className` (e.g. `absolute right-0 top-1`) — never restyle its shape, and
 * never hand-roll a rounded count pill (tests/unit/tab-primitive-gate.test.ts).
 */
const solidBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-none font-semibold leading-none tabular-nums",
  {
    variants: {
      tone: {
        brand: "bg-brand text-brand-foreground",
        warn: "bg-warn text-brand-foreground",
        muted: "bg-muted text-foreground",
      },
      // "sm" rides on a 20px icon (the bell): a 14px box, the text stays 12px.
      size: {
        default: "h-4 min-w-4 px-1 text-xs", // control-scale-allow: a count chip, not a control; its height is the chip's
        sm: "h-3.5 min-w-3.5 px-0.5 text-xs", // control-scale-allow: same chip, 14px box
      },
    },
    defaultVariants: { tone: "brand", size: "default" },
  }
)

/** Past nine reads "9+": a 16px chip stays 16px wide. */
function formatBadgeCount(count: number): string {
  return count > 9 ? "9+" : String(count)
}

function SolidBadge({
  tone,
  size,
  className,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof solidBadgeVariants>) {
  return (
    <span
      data-slot="solid-badge"
      className={cn(solidBadgeVariants({ tone, size }), className)}
      {...props}
    />
  )
}

function CountBadge({
  count,
  ...props
}: Omit<React.ComponentProps<typeof SolidBadge>, "children"> & { count: number }) {
  return <SolidBadge {...props}>{formatBadgeCount(count)}</SolidBadge>
}

export { Badge, badgeVariants, SolidBadge, CountBadge, solidBadgeVariants, formatBadgeCount }
