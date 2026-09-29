import { WaitBar, WaitState } from "@/components/ui/wait-state";

export default function Loading() {
    return (
        <WaitState
            label="Loading agents page"
            className="shell-row py-10"
            data-testid="connect-page"
            skeleton={
                <>
                    <div className="space-y-6">
                        <WaitBar className="h-7 w-56" />
                        <WaitBar className="h-10 w-full max-w-2xl" />
                        <WaitBar className="h-5 w-full max-w-3xl" />
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            <WaitBar className="h-64 w-full rounded-panel border border-border" />
                            <WaitBar className="h-64 w-full rounded-panel border border-border" />
                        </div>
                    </div>
                </>
            }
        />
    );
}
