"use client";

/**
 * Setup opened from the welcome strip or the account menu: a bottom sheet,
 * full height on a phone. Closing it before the last step (×, the overlay,
 * a swipe down) counts as Later.
 */
import dynamic from "next/dynamic";
import { Sheet, SheetBar, SheetBody, SheetContent } from "@/components/ui/sheet";
import { closeSetupSheet, putSetupOff, useOnboarding } from "@/hooks/use-onboarding";
import { toast } from "@/lib/toast";

// Loaded when the sheet first opens: most visits never open it.
const SetupSteps = dynamic(() => import("./SetupSteps").then((m) => m.SetupSteps), { ssr: false });

export const SETUP_DONE_MESSAGE = "Setup done. Change any of it in Settings › Preferences.";

export function SetupSheet() {
    const { sheet, open } = useOnboarding();
    return (
        <Sheet
            open={sheet !== null && open}
            onOpenChange={(next) => {
                if (next) return;
                if (open) putSetupOff();
                closeSetupSheet();
            }}
        >
            <SheetContent
                side="bottom"
                hideCloseButton
                data-testid="setup-sheet"
                className="mx-auto max-h-[min(760px,var(--overlay-max-h))] max-w-[640px] gap-0 rounded-t-panel border-b-0 p-0 max-sm:h-[var(--overlay-max-h)]"
            >
                <SheetBar title="Set up Velai" description="Three steps. Skip any of them. Settings › Preferences keeps the same answers." />
                <SheetBody className="px-4 py-4 pb-7">
                    <SetupSteps
                        variant="sheet"
                        onFinished={() => {
                            closeSetupSheet();
                            toast.success(SETUP_DONE_MESSAGE);
                        }}
                    />
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}
