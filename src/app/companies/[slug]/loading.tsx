import { RouteLoadingFrame } from "@/components/layout/route-loading";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading company page"
            className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
            data-testid="company-truth-page"
        >
            <div className="space-y-4">
                <div className="skeleton-bar h-8 w-48" />
                <div className="skeleton-bar h-5 w-32" />
                <div className="mt-8 border-t border-border pt-6">
                    {[0, 1, 2].map((row) => (
                        <div
                            key={row}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border pb-4 pt-4"
                        >
                            <div className="min-w-0 space-y-2">
                                <div className="skeleton-bar h-5 w-2/3" />
                                <div className="skeleton-bar h-4 w-1/3" />
                            </div>
                            <div className="skeleton-bar h-3 w-12 self-start" />
                        </div>
                    ))}
                </div>
            </div>
        </RouteLoadingFrame>
    );
}
