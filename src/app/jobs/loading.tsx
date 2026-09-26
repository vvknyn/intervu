import { RouteLoadingFrame } from "@/components/layout/route-loading";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading jobs"
            className="mx-auto w-full max-w-[var(--shell-max)] px-[var(--list-inset)] pb-16 pt-6"
        >
            <div className="space-y-6">
                <div className="skeleton-bar h-10 w-full max-w-md" />
                <div className="skeleton-bar h-6 w-48" />
                <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="rounded-panel border border-border bg-surface p-4 shadow-[var(--shadow-bevel-highlight)]"
                        >
                            <div className="skeleton-bar h-5 w-3/4 max-w-sm" />
                            <div className="skeleton-bar mt-2 h-4 w-1/2 max-w-xs" />
                            <div className="skeleton-bar mt-3 h-3 w-full max-w-lg" />
                        </div>
                    ))}
                </div>
            </div>
        </RouteLoadingFrame>
    );
}
