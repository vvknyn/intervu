export default function Loading() {
    return (
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8 xl:max-w-7xl xl:px-10" role="status" aria-busy="true">
            <span className="sr-only">Loading resume page</span>
            <div aria-hidden className="space-y-6">
                <div className="skeleton-bar h-9 w-32" />
                <div className="skeleton-bar h-4 w-full max-w-md" />
                <div className="rounded-none border border-border bg-card p-8">
                    <div className="mx-auto max-w-sm space-y-3">
                        <div className="skeleton-bar mx-auto h-12 w-12" />
                        <div className="skeleton-bar mx-auto h-4 w-48" />
                        <div className="skeleton-bar mx-auto h-3 w-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}
