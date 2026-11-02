"use client"

import * as React from "react"
// dialog-primitive-exempt: this IS the dialog primitive
import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { COMPACT_SHEET_QUERY, SheetHandle, useBottomSheetSwipeDismiss } from "@/components/ui/sheet"
import { revealFocusedField } from "@/lib/ui/reveal-focused-field"

/** The scrim and panel look, shared with ui/alert-dialog.tsx so the two modals cannot drift. */
export const dialogOverlayClass =
  // dialog-primitive-exempt: this IS the dialog primitive
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[var(--z-dialog-scrim)] bg-black/50"
export const dialogContentClass =
  // dialog-primitive-exempt: this IS the dialog primitive
  "material-glass data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-[var(--z-dialog)] flex flex-col w-full max-w-[calc(100%-2rem)] max-h-[var(--overlay-max-h)] overflow-y-auto overscroll-contain translate-x-[-50%] translate-y-[-50%] gap-6 rounded-panel p-6 duration-200 outline-none sm:max-w-lg"
export const dialogTitleClass = "text-lg leading-7 font-semibold"
export const dialogDescriptionClass = "text-muted-foreground text-sm"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        dialogOverlayClass,
        className
      )}
      {...props}
    />
  )
}

/** Whether the viewport is the compact width where a Dialog is drawn as a bottom sheet. */
function useCompactSheet(): boolean {
  const [compact, setCompact] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia(COMPACT_SHEET_QUERY)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return compact
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onFocusCapture,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // On a phone a Dialog is a bottom sheet, so it behaves like one (HIG Sheets: "Include a grabber",
  // "Support swiping to dismiss a sheet"): the same grabber and swipe-down the Sheet primitive has.
  // The swipe closes it the way Escape does, so a dialog that refuses Escape refuses the swipe too,
  // and an uncontrolled dialog closes without the call site wiring anything.
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null)
  const setContentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContentEl(node)
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )
  const compact = useCompactSheet()
  const dismiss = React.useCallback(() => {
    contentEl?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  }, [contentEl])
  useBottomSheetSwipeDismiss(compact, dismiss, contentEl)

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setContentRef}
        data-slot="dialog-content"
        className={cn(
          dialogContentClass,
          // Compact width: a bottom sheet that floats like iOS 26's (inset from the sides and the bottom edge,
          // every corner rounded), with room above the content for the grabber. Only Dialog does this;
          // AlertDialog shares dialogContentClass and stays centred.
          "max-sm:inset-x-[var(--sheet-inset)] max-sm:top-auto max-sm:bottom-[var(--sheet-inset)] max-sm:left-[var(--sheet-inset)] max-sm:w-auto max-sm:max-w-none max-sm:max-h-[calc(var(--overlay-max-h)-var(--sheet-inset))] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:touch-pan-y max-sm:rounded-[var(--radius-sheet)] max-sm:pt-8 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
          className
        )}
        onFocusCapture={(event) => {
          onFocusCapture?.(event)
          revealFocusedField(event)
        }}
        {...props}
      >
        <SheetHandle className="absolute top-2.5 left-1/2 -translate-x-1/2 sm:hidden" />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-muted absolute top-3 right-3 z-20 rounded-ctl p-1.5 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <X />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

/** The one scroll region between a fixed header and footer. `min-h-0` lets the
 *  flex child shrink below its content height — without it the body grows past
 *  the dialog's max-height and gets clipped instead of scrolling. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(dialogTitleClass, className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(dialogDescriptionClass, className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
