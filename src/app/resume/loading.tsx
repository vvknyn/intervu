import { WaitBar, WaitState } from "@/components/ui/wait-state";

export default function Loading() {
    return (
        <WaitState
            label="Loading resume page"
            className="shell-row pb-16 pt-6"
            skeleton={
                <>
                    <div className="space-y-6">
                        <WaitBar className="h-7 w-32" />
                        <WaitBar className="h-5 w-full max-w-md" />
                        <div className="rounded-panel border border-border bg-surface p-8 shadow-[var(--shadow-bevel-highlight)]">
                            <div className="mx-auto max-w-sm space-y-3">
                                <WaitBar className="mx-auto h-12 w-12" />
                                <WaitBar className="mx-auto h-4 w-48" />
                                <WaitBar className="mx-auto h-3 w-full" />
                            </div>
                        </div>
                    </div>
                </>
            }
        />
    );
}
