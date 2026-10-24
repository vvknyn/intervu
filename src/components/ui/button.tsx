import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

// Calm pass R6: outline / secondary / quiet share ONE borderless shape, so they
// can't drift apart: brand-coloured text, no border, no fill at rest, brand-tint
// hover (rulebook "ghost = accent text", like the green text links). Not
// grey-filled, so button-variants.test.ts rule (a) holds; `ghost` stays the
// foreground-text variant.
const TERTIARY_BUTTON_CLASSES = "bg-transparent text-brand hover:bg-live-tint-bg"

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
        outline: TERTIARY_BUTTON_CLASSES,
        secondary: TERTIARY_BUTTON_CLASSES,
        ghost: "text-brand hover:bg-muted",
        link: "text-brand underline-offset-4 hover:underline",
        // Alias of tertiary — not in the rulebook's own variant set, kept
        // because CompletenessMock.tsx (outside this change's scope) still
        // references it.
        quiet: TERTIARY_BUTTON_CLASSES,
        accent: "bg-brand text-brand-foreground hover:brightness-110 border-transparent",
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
