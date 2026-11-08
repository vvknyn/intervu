"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

/**
 * Accessible radio group (@coss/radio-group adapted to Radix + Velai tokens).
 * Also exports `RadioChoice` for `<label>` choice rows (`SerpFilters`, `ChoicePopover`)
 * that rely on a native `<input type="radio">` target for keyboard/sheet dismissal.
 */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-pill border border-border-strong bg-card text-brand-foreground transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        CONTROL_FOCUS_VISIBLE,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="size-1.5 rounded-pill bg-brand-foreground" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

function RadioChoice({
  checked,
  onClick,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "checked" | "onClick"> & {
  checked: boolean
  onClick?: () => void
}) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0 items-center justify-center", className)}>
      <input
        type="radio"
        checked={checked}
        readOnly
        onClick={onClick}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        data-slot="radio-choice-circle"
        className={cn(
          "pointer-events-none inline-flex size-4 items-center justify-center rounded-pill border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground",
          checked
            ? "border-brand bg-brand"
            : "border-border-strong bg-card",
        )}
      >
        {checked && <span className="size-1.5 rounded-pill bg-brand-foreground" />}
      </span>
    </span>
  )
}

export { RadioGroup, RadioGroupItem, RadioChoice }
