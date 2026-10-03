"use client"

import * as React from "react"
// dialog-primitive-exempt: this IS the sheet primitive
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { revealFocusedField } from "@/lib/ui/reveal-focused-field"

const GRAB_ZONE_PX = 48
const DISMISS_THRESHOLD_PX = 80
const DISMISS_THRESHOLD_RATIO = 0.25
const DISMISS_VELOCITY_PX_MS = 0.5
/** A press that moves less than this is a tap, and stays with what it landed on. */
const TAP_SLOP_PX = 8

const SheetDismissContext = React.createContext<(() => void) | null>(null)

function findScrollContainer(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
    const marked = root.querySelector("[data-testid=mobile-detail-scroller]")
    if (marked instanceof HTMLElement) return marked

    let el = target instanceof HTMLElement ? target : null
    while (el && el !== root) {
        const { overflowY } = getComputedStyle(el)
        if (
            (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
            el.scrollHeight > el.clientHeight
        ) {
            return el
        }
        el = el.parentElement
    }
    if (root.scrollHeight > root.clientHeight) return root
    return null
}

function isCenteredBottomSheet(el: HTMLElement): boolean {
    return el.classList.contains("-translate-x-1/2")
}

function applyDragOffset(el: HTMLElement, offsetY: number) {
    if (offsetY <= 0) {
        el.style.transform = ""
        return
    }
    el.style.transform = isCenteredBottomSheet(el)
        ? `translate(-50%, ${offsetY}px)`
        : `translateY(${offsetY}px)`
}

function clearDragOffset(el: HTMLElement | null) {
    if (!el) return
    el.style.transition = ""
    el.style.transform = ""
}

type BottomDragPhase = "grab-zone" | "scroll-pending" | "dragging"

interface BottomDragState {
    phase: BottomDragPhase
    startX: number
    startY: number
    lastY: number
    lastT: number
    scrollContainer: HTMLElement | null
}

/**
 * Swipe down to close. Takes the sheet's element itself, not a ref to it:
 * a sheet that starts closed has no element when it mounts, and an effect
 * keyed on the ref never ran again once it opened, so no phone sheet could
 * be swiped away in production (2026-10-03).
 */
function useBottomSheetSwipeDismiss(
    enabled: boolean,
    dismiss: () => void,
    el: HTMLElement | null,
) {
    const dragRef = React.useRef<BottomDragState | null>(null)
    const dismissRef = React.useRef(dismiss)
    dismissRef.current = dismiss

    React.useEffect(() => {
        if (!enabled || !el) return

        const resetDrag = () => {
            dragRef.current = null
        }

        const snapBack = () => {
            el.style.transition = "transform 200ms ease-out"
            applyDragOffset(el, 0)
            const onEnd = () => {
                clearDragOffset(el)
                el.removeEventListener("transitionend", onEnd)
            }
            el.addEventListener("transitionend", onEnd)
        }

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return
            const rect = el.getBoundingClientRect()
            const inGrabZone = event.clientY - rect.top <= GRAB_ZONE_PX
            const scrollContainer = findScrollContainer(event.target, el)

            if (inGrabZone) {
                // A press on a control in the grab zone (the job sheet's ×) is a
                // tap: capturing the pointer sent its release to the sheet, so
                // the control never got its click (2026-09-30).
                if (event.target instanceof Element && event.target.closest("button, a, [role=button]")) return
                dragRef.current = {
                    phase: "grab-zone",
                    startX: event.clientX,
                    startY: event.clientY,
                    lastY: event.clientY,
                    lastT: event.timeStamp,
                    scrollContainer,
                }
                return
            }

            if (scrollContainer && scrollContainer.scrollTop <= 0) {
                dragRef.current = {
                    phase: "scroll-pending",
                    startX: event.clientX,
                    startY: event.clientY,
                    lastY: event.clientY,
                    lastT: event.timeStamp,
                    scrollContainer,
                }
            }
        }

        const onPointerMove = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return

            if (drag.phase !== "dragging") {
                // The pointer is captured only once the press is clearly a drag
                // down: captured, a tap's release lands on the sheet, so a link or
                // button that a finger nudged a pixel never got its click.
                const deltaY = event.clientY - drag.startY
                if (deltaY < TAP_SLOP_PX) return
                if (Math.abs(event.clientX - drag.startX) > deltaY) {
                    resetDrag()
                    return
                }
                if (drag.phase === "scroll-pending" && drag.scrollContainer && drag.scrollContainer.scrollTop > 0) {
                    resetDrag()
                    return
                }
                drag.phase = "dragging"
                drag.startY += TAP_SLOP_PX
                el.setPointerCapture(event.pointerId)
                el.style.transition = "none"
            }

            applyDragOffset(el, Math.max(0, event.clientY - drag.startY))
            drag.lastY = event.clientY
            drag.lastT = event.timeStamp
        }

        const onPointerUp = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return

            if (el.hasPointerCapture(event.pointerId)) {
                el.releasePointerCapture(event.pointerId)
            }

            if (drag.phase !== "dragging") {
                resetDrag()
                return
            }

            const offsetY = Math.max(0, event.clientY - drag.startY)
            const dt = Math.max(event.timeStamp - drag.lastT, 1)
            const velocity = (event.clientY - drag.lastY) / dt
            const dismissThreshold = Math.max(
                DISMISS_THRESHOLD_PX,
                el.getBoundingClientRect().height * DISMISS_THRESHOLD_RATIO,
            )
            const shouldDismiss = offsetY >= dismissThreshold || velocity >= DISMISS_VELOCITY_PX_MS

            resetDrag()

            if (shouldDismiss && offsetY > 0) {
                clearDragOffset(el)
                dismissRef.current()
                return
            }

            snapBack()
        }

        const onPointerCancel = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return
            if (el.hasPointerCapture(event.pointerId)) {
                el.releasePointerCapture(event.pointerId)
            }
            resetDrag()
            if (drag.phase === "dragging") snapBack()
        }

        const onStateChange = () => {
            if (el.getAttribute("data-state") === "closed") {
                resetDrag()
                clearDragOffset(el)
            }
        }

        const observer = new MutationObserver(onStateChange)
        observer.observe(el, { attributes: true, attributeFilter: ["data-state"] })

        el.addEventListener("pointerdown", onPointerDown)
        el.addEventListener("pointermove", onPointerMove)
        el.addEventListener("pointerup", onPointerUp)
        el.addEventListener("pointercancel", onPointerCancel)

        return () => {
            observer.disconnect()
            el.removeEventListener("pointerdown", onPointerDown)
            el.removeEventListener("pointermove", onPointerMove)
            el.removeEventListener("pointerup", onPointerUp)
            el.removeEventListener("pointercancel", onPointerCancel)
            resetDrag()
            clearDragOffset(el)
        }
    }, [enabled, el])
}

const Sheet = ({ onOpenChange, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) => {
    const dismiss = React.useCallback(() => {
        onOpenChange?.(false)
    }, [onOpenChange])

    return (
        <SheetDismissContext.Provider value={dismiss}>
            <SheetPrimitive.Root onOpenChange={onOpenChange} {...props} />
        </SheetDismissContext.Provider>
    )
}

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Overlay
        className={cn(
            // dialog-primitive-exempt: this IS the sheet primitive
            "fixed inset-0 z-[150] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className
        )}
        {...props}
        ref={ref}
    />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

/** The grab handle on a bottom sheet — token classes only (bg-border, pill
 *  radius), sized h-1.5 w-10 by default. Pass `className` to pick a site's
 *  existing size (e.g. the tracker sheets' h-1 w-9) rather than
 *  hand-copying a hex fill on every sheet that needs one. */
const SheetHandle = ({ className }: { className?: string }) => (
    <span aria-hidden="true" className={cn("h-1.5 w-10 rounded-pill bg-border", className)} />
)
SheetHandle.displayName = "SheetHandle"

/** The one bottom-sheet header: grab handle, title, an optional line under
 *  it, the ×, and a hairline below, kept out of the sheet's scroll region so
 *  the × never sits on top of scrolled content. The job sheets drew this by
 *  hand; the filter and location sheets had none (a bare × floating over the
 *  list, which scrolled under it) and the tracker sheets their own (a thinner
 *  handle, an 18px title, a "×" glyph) — four headers for one kind of sheet
 *  (2026-10-02). Pass `hideCloseButton` to the `SheetContent` it heads. */
const SheetBar = ({
    title,
    description,
    className,
}: {
    title: React.ReactNode
    description?: React.ReactNode
    className?: string
}) => (
    <div className={cn("shrink-0 border-b border-border", className)}>
        <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
            <SheetHandle />
        </div>
        <div className="flex items-center gap-2 px-4 pb-3">
            <div className="min-w-0 flex-1">
                <SheetPrimitive.Title className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
                    {title}
                </SheetPrimitive.Title>
                {description && (
                    <SheetPrimitive.Description className="line-clamp-2 text-sm text-muted-foreground">
                        {description}
                    </SheetPrimitive.Description>
                )}
            </div>
            <SheetPrimitive.Close
                aria-label="Close"
                className="ctl-md ctl-button flex ctl-square shrink-0 items-center justify-center text-faint transition-opacity hover:opacity-80"
            >
                <X size={16} aria-hidden />
            </SheetPrimitive.Close>
        </div>
    </div>
)
SheetBar.displayName = "SheetBar"

const sheetVariants = cva(
    "fixed z-[150] flex flex-col overflow-y-auto overscroll-contain gap-4 bg-background border border-border text-foreground p-6 transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
    {
        variants: {
            side: {
                top: "inset-x-0 top-0 max-h-[var(--overlay-max-h)] rounded-b-panel data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                bottom:
                    "inset-x-0 bottom-0 max-h-[var(--overlay-max-h)] touch-pan-y rounded-t-panel data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                left: "inset-y-0 left-0 h-full w-3/4 rounded-r-panel data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
                right:
                    "inset-y-0 right-0 h-full w-full rounded-l-panel data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-xl lg:max-w-2xl",
            },
        },
        defaultVariants: {
            side: "right",
        },
    }
)

interface SheetContentProps
    extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
    hideCloseButton?: boolean;
    overlayClassName?: string;
    onDismiss?: () => void;
}

const SheetContent = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Content>,
    SheetContentProps
>(({ side = "right", className, children, hideCloseButton = false, overlayClassName, onDismiss, onFocusCapture, ...props }, ref) => {
    const [contentEl, setContentEl] = React.useState<React.ElementRef<typeof SheetPrimitive.Content> | null>(null)
    const setContentRef = React.useCallback(
        (node: React.ElementRef<typeof SheetPrimitive.Content> | null) => {
            setContentEl(node)
            if (typeof ref === "function") ref(node)
            else if (ref) ref.current = node
        },
        [ref],
    )

    const contextDismiss = React.useContext(SheetDismissContext)
    const dismiss = onDismiss ?? contextDismiss ?? (() => {})
    useBottomSheetSwipeDismiss(side === "bottom", dismiss, contentEl)

    return (
        <SheetPortal>
            <SheetOverlay className={overlayClassName} />
            <SheetPrimitive.Content
                ref={setContentRef}
                className={cn(sheetVariants({ side }), className)}
                onFocusCapture={(event) => {
                    onFocusCapture?.(event)
                    revealFocusedField(event)
                }}
                {...props}
            >
                {children}
                {!hideCloseButton && (
                    <SheetPrimitive.Close className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-ctl p-0 opacity-80 ring-offset-background transition-all hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
                        <X size={20} />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

/** The one scroll region between a fixed header and footer — same contract as
 *  `DialogBody` (`min-h-0` so the flex child shrinks and scrolls instead of
 *  being clipped). */
const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)} {...props} />
)
SheetBody.displayName = "SheetBody"

const SheetHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col space-y-2 text-center sm:text-left",
            className
        )}
        {...props}
    />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
            className
        )}
        {...props}
    />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Title
        ref={ref}
        className={cn("text-lg leading-7 font-semibold text-foreground", className)}
        {...props}
    />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Description
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
    />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
    Sheet,
    SheetBar,
    SheetPortal,
    SheetOverlay,
    SheetTrigger,
    SheetClose,
    SheetBody,
    SheetContent,
    SheetHandle,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
}
