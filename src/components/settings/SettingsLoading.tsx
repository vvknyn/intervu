import { PageLayout } from "@/components/layout/PageLayout";

/**
 * Settings' one loading state — used both as the Suspense fallback
 * (app/settings/page.tsx, while useSearchParams resolves) and as
 * SettingsContainer's own gate while the async auth check is in flight.
 * Both used to render their own near-duplicate spinner block; this is the
 * single markup either site imports, so there is nothing left to drift
 * between them.
 */
export function SettingsLoading() {
    return (
        <PageLayout fullWidth>
            <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-8">
                <div
                    className="flex flex-col items-center justify-center gap-3 rounded-panel border border-border bg-surface p-10 text-muted-foreground shadow-[var(--shadow-bevel-highlight)]"
                    role="status"
                    aria-busy="true"
                >
                    <div className="h-5 w-5 animate-spin rounded-pill border-2 border-live border-t-transparent" />
                    <p className="text-sm">Loading account…</p>
                </div>
            </div>
        </PageLayout>
    );
}
