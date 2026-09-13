"use client"

import { X } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

export { chipVariants, filterCountBadgeClass } from "@/components/ui/chip-variants"

/** The chip's own dismiss icon — shared so every chip's remove affordance is
 *  the same tap target/hover treatment instead of an inline one-off button. */
export function ChipDismiss({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("inline-flex items-center justify-center leading-none opacity-70 hover:opacity-100 cursor-pointer", className)}
    >
      <X />
    </button>
  )
}
