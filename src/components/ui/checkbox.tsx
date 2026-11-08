"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "@phosphor-icons/react"

import { cn, CONTROL_FOCUS_VISIBLE } from "@/lib/utils"

/**
 * Accessible checkbox (@coss/checkbox adapted to Radix + Velai tokens).
 * Also exports `CheckboxChoice` for `<label>` choice rows that need a real
 * `<input type="checkbox">` in the DOM (e.g. SerpFilters & ChoicePopover).
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer ctl-check inline-flex size-4 shrink-0 items-center justify-center border border-border-strong bg-card text-brand-foreground transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        CONTROL_FOCUS_VISIBLE,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check size={16} weight="bold" className="p-0.5" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

function CheckboxChoice({
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
        type="checkbox"
        checked={checked}
        readOnly
        onClick={onClick}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        data-slot="checkbox-choice-box"
        className={cn(
          "ctl-check pointer-events-none inline-flex size-4 items-center justify-center border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground",
          checked
            ? "border-brand bg-brand text-brand-foreground"
            : "border-border-strong bg-card text-transparent",
        )}
      >
        {checked && <Check size={16} weight="bold" className="p-0.5" aria-hidden />}
      </span>
    </span>
  )
}

export { Checkbox, CheckboxChoice }
