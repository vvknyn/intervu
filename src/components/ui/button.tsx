import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

// Button hierarchy (docs/design-language.md §5 + @coss/button):
// - Primary (`default` / `brand` / `accent`): one filled `bg-brand` CTA per region
// - Secondary (`secondary`): `border border-border bg-card` neutral surface action
// - Outline (`outline`): `border border-border bg-transparent` crisp hairline action
// - Ghost (`ghost`): borderless neutral action (`hover:bg-muted`)
// - Quiet (`quiet`): soft brand-wash tertiary action
// - Destructive (`destructive` / `destructive-outline`): filled or hairline danger action

const buttonVariants = cva(
  cn(
    // `border-transparent` gives every variant (bordered or not) a
    // border-width for CONTROL_FOCUS_VISIBLE's `focus-visible:border-foreground`
    // to actually paint against — without it, preflight's 0-width border
    // means that focus-visible color swap is a silent no-op.
    // `ctl-button` (globals.css) is the face: the size's step sets the text
    // size (24→12, 32→14, 44→16px), weight 500 and the control corner, so a
    // call site never writes text-* / font-* / rounded-* on a Button
    // (tests/unit/control-type.test.ts).
    "ctl-button inline-flex items-center justify-center gap-2 whitespace-nowrap border border-transparent designed-press disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
    CONTROL_FOCUS_VISIBLE,
  ),
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:bg-brand-hover",
        brand: "bg-brand text-brand-foreground hover:bg-brand-hover",
        destructive: "bg-danger-text text-white hover:opacity-90",
        "destructive-outline": "border border-danger-tint-border bg-transparent text-danger-text hover:bg-danger-wash",
        outline: "border border-border bg-transparent text-foreground hover:bg-muted",
        secondary: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-action",
        quiet: "bg-brand-wash text-brand hover:bg-brand-wash-hover",
        // One filled look: accent was the primary with a brightness hover of its own.
        accent: "bg-brand text-brand-foreground hover:bg-brand-hover",
      },
      // Heights come ONLY from the control scale (globals.css `.ctl-*`); the
      // coarse-pointer hit area is added by the same class, never by a taller
      // visual. A call site picks a size, it never writes h-* / py-*. The
      // step also sets the type. `lg` / `icon-lg` (44px) are for a button in
      // a row with a 44px field — the /jobs Search submit — and need a
      // `control-type-allow: <reason>` at the call site; everything else is md.
      size: {
        default: "ctl-md px-3",
        xs: "ctl-md px-2",
        sm: "ctl-md px-3",
        lg: "ctl-lg px-4 [&_svg]:size-5",
        // Action buttons in an overlay: the 32px step on desktop, the 44px
        // tap minimum below lg (dialog actions, sheet footers).
        touch: "ctl-md px-3 max-lg:ctl-lg max-lg:px-4",
        // Inline text link: sized by its text (no step, so it takes the type
        // around it); the coarse-pointer ::before still grows the hit area.
        link: "h-auto px-0", // control-scale-allow: inline text link, no box
        "icon-sm": "ctl-sm ctl-square",
        icon: "ctl-md ctl-square",
        "icon-lg": "ctl-lg ctl-square [&_svg]:size-5",
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
  const Comp = asChild ? Slot.Root : "button"

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
