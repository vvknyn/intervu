export default function Loading() {
    return (
        <main
            data-testid="connect-page"
            className="mx-auto max-w-6xl xl:max-w-7xl px-4 sm:px-8 py-10"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading agents page</span>
            <div aria-hidden className="space-y-6">
                <div className="skeleton-bar h-6 w-56" />
                <div className="skeleton-bar h-10 w-full max-w-2xl" />
                <div className="skeleton-bar h-4 w-full max-w-3xl" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="skeleton-bar h-64 w-full border border-border" />
                    <div className="skeleton-bar h-64 w-full border border-border" />
                </div>
            </div>
        </main>
    );
}
