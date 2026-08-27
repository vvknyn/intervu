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
            <div className="mx-auto flex max-w-[720px] flex-col items-center justify-center gap-3 px-4 py-16 text-muted-foreground sm:px-8">
                <div className="h-5 w-5 animate-spin rounded-full border border-border border-t-foreground" />
                <p className="text-sm">Loading account…</p>
            </div>
        </PageLayout>
    );
}
