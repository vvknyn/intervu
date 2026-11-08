"use client"

import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Compound input container (@coss/input-group adapted to Velai's `.ctl-*` scale).
 * Composes leading/trailing icons, currency prefixes, clear buttons, and `Kbd`
 * shortcuts around a single focus ring without manual absolute positioning.
 */
const inputGroupVariants = cva(
  "relative inline-flex w-full min-w-0 items-center rounded-ctl border border-border bg-card text-foreground transition-colors has-[:focus-visible]:border-foreground has-[[aria-invalid=true]]:border-destructive has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
  {
    variants: {
      size: {
        sm: "ctl-md text-xs",
        default: "ctl-lg text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
)

function InputGroup({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupVariants>) {
  return (
    <div
      data-slot="input-group"
      data-size={size}
      role="group"
      className={cn(inputGroupVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupAddon({
  className,
  align = "inline-start",
  onMouseDown,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "inline-start" | "inline-end"
}) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (event.defaultPrevented) return
        const target = event.target as HTMLElement
        if (target.closest("button,a,input,select,textarea")) return
        const group = event.currentTarget.closest("[data-slot=input-group]")
        const input = group?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          "input,textarea",
        )
        if (input && document.activeElement !== input) {
          event.preventDefault()
          input.focus()
        }
      }}
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-4",
        align === "inline-start" ? "pl-2.5" : "pr-2",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-text"
      className={cn(
        "inline-flex items-center gap-1.5 text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"input"> & { asChild?: boolean }) {
  const sharedClassName = cn(
    "min-w-0 flex-1 bg-transparent px-2.5 text-inherit placeholder:text-placeholder-text selection:bg-brand selection:text-brand-foreground outline-none disabled:cursor-not-allowed",
    className,
  )

  if (asChild) {
    return (
      <Slot.Root
        data-slot="input-group-control"
        className={sharedClassName}
        {...props}
      />
    )
  }

  return (
    <input
      data-slot="input-group-control"
      type={type ?? "text"}
      className={sharedClassName}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  inputGroupVariants,
}
