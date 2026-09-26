import { RouteLoadingFrame } from "@/components/layout/route-loading";

export default function Loading() {
    return (
        <RouteLoadingFrame
            label="Loading agents page"
            className="mx-auto max-w-6xl px-4 py-10 sm:px-8 xl:max-w-7xl"
            data-testid="connect-page"
        >
            <div className="space-y-6">
                <div className="skeleton-bar h-7 w-56" />
                <div className="skeleton-bar h-10 w-full max-w-2xl" />
                <div className="skeleton-bar h-5 w-full max-w-3xl" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="skeleton-bar h-64 w-full rounded-panel border border-border" />
                    <div className="skeleton-bar h-64 w-full rounded-panel border border-border" />
                </div>
            </div>
        </RouteLoadingFrame>
    );
}
