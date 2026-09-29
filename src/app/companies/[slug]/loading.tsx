import { WaitBar, WaitState } from "@/components/ui/wait-state";

export default function Loading() {
    return (
        <WaitState
            label="Loading company page"
            className="shell-row py-10"
            data-testid="company-truth-page"
            skeleton={
                <>
                    <div className="max-w-3xl space-y-4">
                        <WaitBar className="h-8 w-48" />
                        <WaitBar className="h-5 w-32" />
                        <div className="mt-8 border-t border-border pt-6">
                            {[0, 1, 2].map((row) => (
                                <div
                                    key={row}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border pb-4 pt-4"
                                >
                                    <div className="min-w-0 space-y-2">
                                        <WaitBar className="h-5 w-2/3" />
                                        <WaitBar className="h-4 w-1/3" />
                                    </div>
                                    <WaitBar className="h-3 w-12 self-start" />
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            }
        />
    );
}
