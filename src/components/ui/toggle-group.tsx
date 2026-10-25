"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { chipVariants } from "@/components/ui/chip"
import { cn } from "@/lib/utils"

/**
 * A single-choice chip group (WAI-ARIA radio-group pattern, roving focus: one
 * Tab stop, arrow keys move between chips). Items read as `ToggleChip` does: a
 * tonal fill at rest, a brand tint plus a leading check when chosen (never
 * colour alone). Clicking the chosen chip clears the choice (value "").
 * Pass `role="radiogroup"` + an `aria-label` on the group.
 */
export function ToggleGroup(props: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type">) {
  return <ToggleGroupPrimitive.Root type="single" {...props} />
}

export function ToggleGroupItem({
  className,
  children,
  ...props
}: ToggleGroupPrimitive.ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        chipVariants({ interactive: true }),
        "group data-[state=on]:bg-live-tint-bg data-[state=on]:text-brand data-[state=on]:hover:bg-muted data-[state=on]:hover:text-foreground",
        className
      )}
      {...props}
    >
      <Check weight="bold" aria-hidden className="hidden group-data-[state=on]:block" />
      {children}
    </ToggleGroupPrimitive.Item>
  )
}
