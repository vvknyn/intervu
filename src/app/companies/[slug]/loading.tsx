export default function Loading() {
    return (
        <main
            data-testid="company-truth-page"
            className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading company page</span>
            <div aria-hidden className="space-y-4">
                <div className="skeleton-bar h-8 w-48" />
                <div className="skeleton-bar h-4 w-32" />
                <div className="mt-8 space-y-2.5 border-t border-border pt-6">
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="border border-border bg-card px-5 py-4">
                            <div className="skeleton-bar h-4 w-2/3" />
                            <div className="mt-2.5 skeleton-bar h-3 w-1/3" />
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
