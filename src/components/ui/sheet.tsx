"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

const GRAB_ZONE_PX = 48
const DISMISS_THRESHOLD_PX = 80
const DISMISS_THRESHOLD_RATIO = 0.25
const DISMISS_VELOCITY_PX_MS = 0.5

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
    startY: number
    lastY: number
    lastT: number
    scrollContainer: HTMLElement | null
}

function useBottomSheetSwipeDismiss(
    enabled: boolean,
    dismiss: () => void,
    contentRef: React.RefObject<HTMLElement | null>,
) {
    const dragRef = React.useRef<BottomDragState | null>(null)
    const dismissRef = React.useRef(dismiss)
    dismissRef.current = dismiss

    React.useEffect(() => {
        if (!enabled) return
        const el = contentRef.current
        if (!el) return

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
                dragRef.current = {
                    phase: "grab-zone",
                    startY: event.clientY,
                    lastY: event.clientY,
                    lastT: event.timeStamp,
                    scrollContainer,
                }
                el.setPointerCapture(event.pointerId)
                el.style.transition = "none"
                return
            }

            if (scrollContainer && scrollContainer.scrollTop <= 0) {
                dragRef.current = {
                    phase: "scroll-pending",
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

            const deltaY = event.clientY - drag.startY

            if (drag.phase === "scroll-pending") {
                if (deltaY <= 0) return
                if (drag.scrollContainer && drag.scrollContainer.scrollTop > 0) {
                    resetDrag()
                    return
                }
                drag.phase = "dragging"
                el.setPointerCapture(event.pointerId)
                el.style.transition = "none"
            }

            if (drag.phase !== "grab-zone" && drag.phase !== "dragging") return

            applyDragOffset(el, Math.max(0, deltaY))
            drag.lastY = event.clientY
            drag.lastT = event.timeStamp
        }

        const onPointerUp = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return

            if (el.hasPointerCapture(event.pointerId)) {
                el.releasePointerCapture(event.pointerId)
            }

            if (drag.phase !== "grab-zone" && drag.phase !== "dragging") {
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
            if (!dragRef.current) return
            if (el.hasPointerCapture(event.pointerId)) {
                el.releasePointerCapture(event.pointerId)
            }
            resetDrag()
            snapBack()
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
    }, [enabled, contentRef])
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
            "fixed inset-0 z-[150] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className
        )}
        {...props}
        ref={ref}
    />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

/** The grab handle on a bottom sheet — token classes only (bg-border, no
 *  border, radius 0), sized h-1.5 w-10 by default. Pass `className` to pick
 *  a site's existing size (e.g. the tracker sheets' h-1 w-9) rather than
 *  hand-copying a hex fill on every sheet that needs one. */
const SheetHandle = ({ className }: { className?: string }) => (
    <span aria-hidden="true" className={cn("h-1.5 w-10 rounded-none bg-border", className)} />
)
SheetHandle.displayName = "SheetHandle"

const sheetVariants = cva(
    "fixed z-[150] gap-4 bg-background border border-border text-foreground p-6 transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
    {
        variants: {
            side: {
                top: "inset-x-0 top-0 data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                bottom:
                    "inset-x-0 bottom-0 touch-pan-y data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                left: "inset-y-0 left-0 h-full w-3/4 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
                right:
                    "inset-y-0 right-0 h-full w-full data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-xl lg:max-w-2xl",
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
>(({ side = "right", className, children, hideCloseButton = false, overlayClassName, onDismiss, ...props }, ref) => {
    const contentRef = React.useRef<React.ElementRef<typeof SheetPrimitive.Content> | null>(null)
    const setContentRef = React.useCallback(
        (node: React.ElementRef<typeof SheetPrimitive.Content> | null) => {
            contentRef.current = node
            if (typeof ref === "function") ref(node)
            else if (ref) ref.current = node
        },
        [ref],
    )

    const contextDismiss = React.useContext(SheetDismissContext)
    const dismiss = onDismiss ?? contextDismiss ?? (() => {})
    useBottomSheetSwipeDismiss(side === "bottom", dismiss, contentRef)

    return (
        <SheetPortal>
            <SheetOverlay className={overlayClassName} />
            <SheetPrimitive.Content
                ref={setContentRef}
                className={cn(sheetVariants({ side }), className)}
                {...props}
            >
                {children}
                {!hideCloseButton && (
                    <SheetPrimitive.Close className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-none p-0 opacity-80 ring-offset-background transition-all hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
                        <X size={20} />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

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
    SheetPortal,
    SheetOverlay,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHandle,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
}
