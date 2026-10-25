"use client"

import * as React from "react"

import { useIsCompact } from "@/hooks/use-media-query"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetBar, SheetBody, SheetContent, SheetTrigger } from "@/components/ui/sheet"

/**
 * A choice list opened from a control: a popover beside the trigger, and at
 * compact width the house bottom sheet with 44px rows (the standard phone
 * pattern; a 224px popover over the chips was a thumb-sized miss). Every
 * popover that presents a choice list mounts this, not Popover directly.
 */
function ChoicePopover({
    title,
    trigger,
    children,
}: {
    title: string
    trigger: React.ReactElement
    children: React.ReactNode
}) {
    const compact = useIsCompact()

    if (compact) {
        return (
            <Sheet>
                <SheetTrigger asChild>{trigger}</SheetTrigger>
                <SheetContent side="bottom" hideCloseButton className="mx-auto w-full max-w-[720px] gap-0 border-b-0 p-0">
                    <SheetBar title={title} />
                    <SheetBody className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] [&_label]:min-h-11 [&_label]:text-sm">
                        {children}
                    </SheetBody>
                </SheetContent>
            </Sheet>
        )
    }

    return (
        <Popover>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="flex w-56 flex-col gap-0.5 rounded-panel border border-border bg-surface p-2">
                {children}
            </PopoverContent>
        </Popover>
    )
}

export { ChoicePopover }
