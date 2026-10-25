"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { dialogContentClass, dialogDescriptionClass, dialogOverlayClass, dialogTitleClass, DialogFooter, DialogHeader } from "@/components/ui/dialog"
import { revealFocusedField } from "@/lib/ui/reveal-focused-field"

/**
 * The confirm modal (WAI-ARIA alertdialog): a question with a Cancel and one
 * action. Same look as ui/dialog; unlike Dialog it has no close X, a click
 * outside does not dismiss it, and focus starts on Cancel. Anything with form
 * fields to fill in is a Dialog, not this.
 */
function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogContent({
  className,
  onFocusCapture,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className={dialogOverlayClass} />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(dialogContentClass, className)}
        onFocusCapture={(event) => {
          onFocusCapture?.(event)
          revealFocusedField(event)
        }}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

// control-type-allow: dialog actions are the only buttons that must reach the 44px tap minimum on phone; type still comes from the step
const PHONE_TAP_TARGET = "max-lg:ctl-lg"

/** Dismisses with no action. Closing by Esc or Cancel both reach the root's `onOpenChange(false)`. */
function AlertDialogCancel({
  variant = "outline",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button variant={variant} {...props} className={cn(PHONE_TAP_TARGET, props.className)} />
    </AlertDialogPrimitive.Cancel>
  )
}

/** The confirming action. It closes the dialog on click; `event.preventDefault()` in `onClick` keeps it open (async work that can fail). */
function AlertDialogAction({
  variant,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & Pick<React.ComponentProps<typeof Button>, "variant">) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button variant={variant} {...props} className={cn(PHONE_TAP_TARGET, props.className)} />
    </AlertDialogPrimitive.Action>
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn(dialogTitleClass, className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter as AlertDialogFooter,
  DialogHeader as AlertDialogHeader,
}
